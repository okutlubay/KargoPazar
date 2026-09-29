using System.Reflection;
using System.Text.Json;
using System.Text.Json.Nodes;
using KargoPazar.Data;
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
    public const string DefaultSeedVersion = "2026.10.2";
    public const string DefaultPassword = "Demo123!";
    public const string DefaultTimeZone = "Europe/Istanbul";
    private const string ResourcePrefix = "KargoPazar.Seed.";

    private static readonly Lazy<IReadOnlyDictionary<string, string>> RawSeed = new(LoadRaw);
    private static readonly SemaphoreSlim SeedLock = new(1, 1);

    private readonly AppDbContext _db;
    private readonly StateStore _store;
    private readonly ILogger<SeedService> _logger;
    private readonly TimeZoneInfo _tz;

    public SeedService(AppDbContext db, StateStore store, IConfiguration config, ILogger<SeedService> logger)
    {
        _db = db;
        _store = store;
        _logger = logger;
        SeedVersion = ConfiguredSeedVersion(config);
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
        if (await _db.Users.AnyAsync(ct)) return;
        await SeedLock.WaitAsync(ct);
        try
        {
            if (await _db.Users.AnyAsync(ct)) return;
            _logger.LogInformation("Database has no users: seeding demo data");
            await ReseedAsync(null, ct);
        }
        finally
        {
            SeedLock.Release();
        }
    }

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
