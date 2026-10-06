using System.Reflection;
using System.Text.Json;
using System.Text.Json.Nodes;
using KargoPazar.Data;
using KargoPazar.Models.Domain;
using KargoPazar.Services.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace KargoPazar.Services.Implementations;

/// <summary>
/// Loads the embedded seed (frontend/src/app/data/seed/*.json, linked into the assembly),
/// resolves relative dates against "now" like resolveDates() in the panel's db.js, and
/// (re)seeds the database in one transaction. The demo password is stored as a BCrypt hash.
/// </summary>
public class SeedService : ISeedService
{
    public const string DefaultSeedVersion = "2026.10.3";
    public const string DefaultPassword = "Demo123!";
    public const string DefaultTimeZone = "Europe/Istanbul";
    private const string ResourcePrefix = "KargoPazar.Seed.";

    private static readonly Lazy<IReadOnlyDictionary<string, string>> RawSeed = new(LoadRaw);
    private static readonly SemaphoreSlim SeedLock = new(1, 1);

    private readonly AppDbContext _db;
    private readonly StateStore _store;
    private readonly ILogger<SeedService> _logger;
    private readonly TimeZoneInfo _tz;
    private readonly string _adminPassword;

    public SeedService(AppDbContext db, StateStore store, IConfiguration config, ILogger<SeedService> logger)
    {
        _db = db;
        _store = store;
        _logger = logger;
        SeedVersion = ConfiguredSeedVersion(config);
        _adminPassword = string.IsNullOrWhiteSpace(config["Seed:AdminPassword"]) ? PlatformAdmin.DefaultPassword : config["Seed:AdminPassword"]!;
        _tz = StateMapper.FindTimeZone(config["Seed:TimeZone"] ?? DefaultTimeZone);
    }

    public string SeedVersion { get; }

    public static string ConfiguredSeedVersion(IConfiguration config) =>
        string.IsNullOrWhiteSpace(config["Seed:Version"]) ? DefaultSeedVersion : config["Seed:Version"]!;

    /// <summary>Raw seed file text by collection name (file name without .json).</summary>
    public static IReadOnlyDictionary<string, string> Raw => RawSeed.Value;

    private static IReadOnlyDictionary<string, string> LoadRaw()
    {
        var asm = Assembly.GetExecutingAssembly();
        var result = new SortedDictionary<string, string>(StringComparer.Ordinal);
        foreach (var res in asm.GetManifestResourceNames())
        {
            if (!res.StartsWith(ResourcePrefix, StringComparison.Ordinal) || !res.EndsWith(".json", StringComparison.Ordinal)) continue;
            var name = res[ResourcePrefix.Length..^".json".Length];
            using var s = asm.GetManifestResourceStream(res)!;
            using var r = new StreamReader(s);
            result[name] = r.ReadToEnd();
        }
        if (result.Count == 0) throw new InvalidOperationException("No embedded seed files found");
        return result;
    }

    public IReadOnlyDictionary<string, string> ResolvedSeed(DateTimeOffset now) => Resolve(now, _tz);

    public static IReadOnlyDictionary<string, string> Resolve(DateTimeOffset now, TimeZoneInfo tz)
    {
        var result = new SortedDictionary<string, string>(StringComparer.Ordinal);
        foreach (var (name, raw) in Raw)
        {
            var node = JsonNode.Parse(raw, documentOptions: new JsonDocumentOptions { AllowTrailingCommas = false });
            result[name] = StateMapper.ToJson(StateMapper.ResolveDates(node, now, tz));
        }
        return result;
    }

    public async Task EnsureSeededAsync(CancellationToken ct = default)
    {
        if (await _db.Users.AnyAsync(u => u.Role != PlatformAdmin.Role, ct) && await PlatformAdminExistsAsync(ct)
            && !NeedsReseed(await StoredSeedVersionAsync(ct))) return;
        await SeedLock.WaitAsync(ct);
        try
        {
            if (!await _db.Users.AnyAsync(u => u.Role != PlatformAdmin.Role, ct))
            {
                _logger.LogInformation("Database has no demo user: seeding demo data");
                await ReseedAsync(null, ct);
            }
            else
            {
                // A new seed version (e.g. after a deploy that changed the demo data) replaces the demo
                // data. ReplaceAllAsync keeps the platform admin user.
                var stored = await StoredSeedVersionAsync(ct);
                if (NeedsReseed(stored))
                {
                    _logger.LogInformation("Seed version changed ({Stored} -> {Version}): reseeding demo data", stored ?? "none", SeedVersion);
                    await ReseedAsync(null, ct);
                }
            }
            if (!await PlatformAdminExistsAsync(ct))
            {
                _logger.LogInformation("Creating the platform administrator account");
                _db.Users.Add(PlatformAdmin.CreateUser(_adminPassword));
                await _db.SaveChangesAsync(ct);
                _db.ChangeTracker.Clear();
            }
        }
        finally
        {
            SeedLock.Release();
        }
    }

    /// <summary>
    /// True when the stored seed version differs from the configured one. A stored version that is
    /// newer than ours is left alone, so an old instance still running during a rolling deploy does
    /// not reseed back to its older data.
    /// </summary>
    private bool NeedsReseed(string? stored)
    {
        if (string.Equals(stored, SeedVersion, StringComparison.Ordinal)) return false;
        if (stored is not null && Version.TryParse(stored, out var s) && Version.TryParse(SeedVersion, out var c) && s > c) return false;
        return true;
    }

    private Task<string?> StoredSeedVersionAsync(CancellationToken ct) =>
        _db.AppMeta.AsNoTracking().Where(m => m.Name == StateStore.MetaSeedVersion).Select(m => m.Value).FirstOrDefaultAsync(ct);

    private Task<bool> PlatformAdminExistsAsync(CancellationToken ct) =>
        _db.Users.AnyAsync(u => u.Id == PlatformAdmin.UserId || u.Username == PlatformAdmin.Username, ct);

    public async Task ReseedAsync(DateTimeOffset? now = null, CancellationToken ct = default)
    {
        var resolved = ResolvedSeed(now ?? DateTimeOffset.UtcNow);
        var docs = new List<JsonDocument>();
        try
        {
            var data = new Dictionary<string, JsonElement>(StringComparer.Ordinal);
            foreach (var (name, json) in resolved)
            {
                var d = JsonDocument.Parse(json);
                docs.Add(d);
                data[name] = d.RootElement;
            }

            string userId = "USR-001";
            string password = DefaultPassword;
            if (data.TryGetValue(CollectionRegistry.UserDoc, out var user) && user.ValueKind == JsonValueKind.Object)
            {
                if (user.TryGetProperty("id", out var id) && id.ValueKind == JsonValueKind.String) userId = id.GetString()!;
                if (user.TryGetProperty("password", out var pw) && pw.ValueKind == JsonValueKind.String && pw.GetString()!.Length > 0)
                    password = pw.GetString()!;
            }

            var hash = BCrypt.Net.BCrypt.HashPassword(password, workFactor: 11);
            await _store.ReplaceAllAsync(data, userId, hash, SeedVersion);
            _logger.LogInformation("Seeded {Count} collections (seed {Version})", data.Count, SeedVersion);
        }
        finally
        {
            foreach (var d in docs) d.Dispose();
        }
    }
}

/// <summary>
/// The platform administrator: sees only the Yönetim (admin) module, has no company or wallet,
/// and survives demo resets (ReplaceAllAsync keeps users with this role).
/// </summary>
public static class PlatformAdmin
{
    public const string Role = "platform_admin";
    public const string UserId = "USR-ADMIN";
    public const string Username = "admin";
    public const string Email = "admin@kargopazar.com";
    public const string Name = "Platform Yöneticisi";
    public const string DefaultPassword = "Istanbul34$";

    public static User CreateUser(string password)
    {
        var now = DateTime.UtcNow;
        var profile = new JsonObject
        {
            ["id"] = UserId,
            ["username"] = Username,
            ["name"] = Name,
            ["email"] = Email,
            ["role"] = Role,
            ["isPlatformAdmin"] = true,
            ["createdAt"] = StateMapper.FormatIso(now),
            ["preferences"] = new JsonObject { ["lang"] = "tr", ["units"] = "metric", ["currency"] = "TRY", ["dateFormat"] = "locale" }
        };
        return new User
        {
            Id = UserId,
            Username = Username,
            Email = Email,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(password, workFactor: 11),
            Name = Name,
            Role = Role,
            CompanyId = null,
            CreatedAt = now,
            Profile = StateMapper.ToJson(profile)
        };
    }
}

/// <summary>Seeds an empty database at startup without blocking or crashing the app when MySQL is unreachable.</summary>
public class SeedOnStartupService : BackgroundService
{
    private readonly IServiceScopeFactory _scopes;
    private readonly ILogger<SeedOnStartupService> _logger;

    public SeedOnStartupService(IServiceScopeFactory scopes, ILogger<SeedOnStartupService> logger)
    {
        _scopes = scopes;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        for (int attempt = 1; attempt <= 10 && !stoppingToken.IsCancellationRequested; attempt++)
        {
            try
            {
                using var scope = _scopes.CreateScope();
                await scope.ServiceProvider.GetRequiredService<ISeedService>().EnsureSeededAsync(stoppingToken);
                return;
            }
            catch (Exception ex) when (!stoppingToken.IsCancellationRequested)
            {
                _logger.LogWarning(ex, "Startup seed check failed (attempt {Attempt}/10)", attempt);
                await Task.Delay(TimeSpan.FromSeconds(Math.Min(60, 5 * attempt)), stoppingToken);
            }
        }
    }
}
