using System.Text;
using System.Text.Json;
using System.Threading.RateLimiting;
using KargoPazar.Controllers;
using KargoPazar.Data;
using KargoPazar.Middleware;
using KargoPazar.Models.Enums;
using KargoPazar.Services.Implementations;
using KargoPazar.Services.Interfaces;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.ResponseCompression;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Microsoft.OpenApi.Models;
using Serilog;

var builder = WebApplication.CreateBuilder(args);
// App Runner expects the app on 8080. ASPNETCORE_URLS / --urls still override for local runs.
if (string.IsNullOrEmpty(builder.Configuration["ASPNETCORE_URLS"]) && string.IsNullOrEmpty(builder.Configuration["urls"]))
    builder.WebHost.UseUrls("http://*:8080");
builder.WebHost.ConfigureKestrel(o => o.Limits.MaxRequestBodySize = 50_000_000);

// ── Serilog ─────────────────────────────────────────────────────────────────
Log.Logger = new LoggerConfiguration()
    .ReadFrom.Configuration(builder.Configuration)
    .Enrich.FromLogContext()
    .WriteTo.Console()
    .CreateLogger();
builder.Host.UseSerilog();

// ── Database ────────────────────────────────────────────────────────────────
var connStr = builder.Configuration.GetConnectionString("Default");
if (string.IsNullOrWhiteSpace(connStr))
    throw new InvalidOperationException("ConnectionStrings:Default is not configured (env ConnectionStrings__Default).");
var serverVersion = ServerVersion.Parse(builder.Configuration["Db:ServerVersion"] ?? "8.0.36-mysql");
builder.Services.AddDbContext<AppDbContext>(opt =>
    opt.UseMySql(connStr, serverVersion,
            mySql => mySql.EnableRetryOnFailure(
                maxRetryCount: 5,
                maxRetryDelay: TimeSpan.FromSeconds(10),
                errorNumbersToAdd: null))
        .UseSnakeCaseNamingConvention());

// ── Authentication ──────────────────────────────────────────────────────────
// No fallback key: Jwt:SigningKey must come from configuration (App Runner env Jwt__SigningKey).
// appsettings.Development.json carries a clearly dev-only key for local runs.
var jwtKey = builder.Configuration["Jwt:SigningKey"];
if (string.IsNullOrWhiteSpace(jwtKey) || jwtKey.Length < 32)
    throw new InvalidOperationException("Jwt:SigningKey is missing or shorter than 32 characters (env Jwt__SigningKey).");
builder.Configuration["Jwt:Issuer"] ??= "kargopazar-api";
builder.Configuration["Jwt:Audience"] ??= "kargopazar-panel";

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(opt =>
    {
        opt.MapInboundClaims = false;
        opt.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true, ValidateAudience = true, ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ValidIssuer = builder.Configuration["Jwt:Issuer"],
            ValidAudience = builder.Configuration["Jwt:Audience"],
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtKey)),
            ClockSkew = TimeSpan.FromMinutes(1)
        };
        opt.Events = new JwtBearerEvents
        {
            OnChallenge = async ctx =>
            {
                ctx.HandleResponse();
                ctx.Response.StatusCode = 401;
                ctx.Response.ContentType = "application/json";
                await ctx.Response.WriteAsync(JsonSerializer.Serialize(
                    new { code = ErrorCodes.Unauthorized, message = "Sign in required or session expired" },
                    new JsonSerializerOptions(JsonSerializerDefaults.Web)));
            }
        };
    });
builder.Services.AddAuthorization();

// ── Services ────────────────────────────────────────────────────────────────
builder.Services.AddSingleton<ICollectionRegistry>(CollectionRegistry.Default);
builder.Services.AddScoped<StateStore>();
builder.Services.AddScoped<IStateStore>(sp => sp.GetRequiredService<StateStore>());
builder.Services.AddScoped<ISeedService, SeedService>();
builder.Services.AddScoped<IAuthService, AuthService>();
builder.Services.AddScoped<IPublicService, PublicService>();
builder.Services.AddHostedService<SeedOnStartupService>();

// ── Rate limiting (per IP, honours X-Forwarded-For behind App Runner) ────────
static RateLimitPartition<string> PerIp(HttpContext ctx, int permits, TimeSpan window) =>
    RateLimitPartition.GetFixedWindowLimiter(ctx.ClientIp() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = permits, Window = window, QueueLimit = 0 });

builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = 429;
    options.AddPolicy("AuthRateLimit", ctx => PerIp(ctx, builder.Configuration.GetValue("RateLimit:LoginPerWindow", 10), TimeSpan.FromMinutes(5)));
    options.AddPolicy("LeadRateLimit", ctx => PerIp(ctx, 10, TimeSpan.FromMinutes(10)));
    options.AddPolicy("PublicRateLimit", ctx => PerIp(ctx, 120, TimeSpan.FromMinutes(1)));
    options.OnRejected = async (ctx, ct) =>
    {
        var isLogin = ctx.HttpContext.Request.Path.StartsWithSegments("/api/auth/login");
        if (ctx.Lease.TryGetMetadata(MetadataName.RetryAfter, out var retry))
            ctx.HttpContext.Response.Headers.RetryAfter = ((int)retry.TotalSeconds).ToString();
        ctx.HttpContext.Response.ContentType = "application/json";
        await ctx.HttpContext.Response.WriteAsync(JsonSerializer.Serialize(new
        {
            code = isLogin ? ErrorCodes.Locked : ErrorCodes.RateLimited,
            message = isLogin ? "Too many sign-in attempts. Try again in a few minutes." : "Too many requests. Try again later."
        }, new JsonSerializerOptions(JsonSerializerDefaults.Web)), ct);
    };
});

// ── CORS ────────────────────────────────────────────────────────────────────
var origins = builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>()?
    .Where(o => !string.IsNullOrWhiteSpace(o)).Select(o => o.Trim().TrimEnd('/')).ToArray() ?? Array.Empty<string>();
if (origins.Length == 0)
    origins = builder.Environment.IsDevelopment()
        ? new[] { "http://localhost:5173", "http://localhost:5180", "http://localhost:5181", "http://localhost:4173" }
        : new[] { "https://kargopazar.com", "https://www.kargopazar.com" };
builder.Services.AddCors(options =>
{
    options.AddPolicy("Panel", policy => policy
        .WithOrigins(origins)
        .AllowAnyHeader()
        .AllowAnyMethod()
        .WithExposedHeaders("Retry-After")
        .SetPreflightMaxAge(TimeSpan.FromHours(1)));
});

// ── Controllers, compression & Swagger ──────────────────────────────────────
builder.Services.AddResponseCompression(o =>
{
    o.EnableForHttps = true;
    o.Providers.Add<BrotliCompressionProvider>();
    o.Providers.Add<GzipCompressionProvider>();
});
builder.Services.AddControllers();
builder.Services.Configure<ApiBehaviorOptions>(o =>
{
    o.InvalidModelStateResponseFactory = ctx =>
    {
        var first = ctx.ModelState.Where(e => e.Value?.Errors.Count > 0)
            .Select(e => $"{e.Key}: {e.Value!.Errors[0].ErrorMessage}").FirstOrDefault() ?? "Invalid request";
        return new BadRequestObjectResult(new { code = ErrorCodes.Validation, message = first });
    };
});
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(c =>
{
    c.SwaggerDoc("v1", new OpenApiInfo { Title = "KargoPazar API", Version = "v1" });
    c.AddSecurityDefinition("Bearer", new OpenApiSecurityScheme
    {
        Name = "Authorization", Type = SecuritySchemeType.Http, Scheme = "bearer", BearerFormat = "JWT",
        In = ParameterLocation.Header, Description = "JWT from POST /api/auth/login"
    });
    c.AddSecurityRequirement(new OpenApiSecurityRequirement
    {
        { new OpenApiSecurityScheme { Reference = new OpenApiReference { Type = ReferenceType.SecurityScheme, Id = "Bearer" } }, Array.Empty<string>() }
    });
});

var app = builder.Build();

// ── Middleware pipeline ─────────────────────────────────────────────────────
app.UseMiddleware<ExceptionMiddleware>();
app.UseResponseCompression();

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.MapGet("/health", () => Results.Ok(new { status = "ok", timestamp = DateTime.UtcNow }));
app.MapGet("/healthz", () => Results.Ok(new { status = "ok" }));

app.UseCors("Panel");
app.UseAuthentication();
app.UseAuthorization();
app.UseRateLimiter();   // must be before MapControllers for [EnableRateLimiting] to bind
app.MapControllers();

// The schema is created with database/001_InitialSchema.sql (setup-database.bat); no EF migrations.
// An empty database (no users) is seeded in the background by SeedOnStartupService.
app.Run();

public partial class Program { }
