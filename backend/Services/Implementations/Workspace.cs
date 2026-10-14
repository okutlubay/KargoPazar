using System.Text.Json.Nodes;
using KargoPazar.Models.Domain;

namespace KargoPazar.Services.Implementations;

/// <summary>
/// Private workspaces: customer accounts whose data is isolated from the shared demo data.
/// Platform reference data (carriers, countries, hubs, rate cards, HS codes, ...) is shared with
/// every account; everything else (orders, shipments, stores, rules, counters, runtime
/// collections, ...) is stored under the "w:{userId}:" prefix in app_records / app_documents.
/// The user, company, wallet and wallet transactions rows belong to the workspace's own company.
/// Workspaces survive demo resets and imports.
/// </summary>
public static class Workspace
{
    public const string UserIdPrefix = "USR-W";
    public const string StoragePrefix = "w:";

    /// <summary>Platform reference data read from (and written to) the shared tables by every account.</summary>
    public static readonly IReadOnlySet<string> Shared = new HashSet<string>(StringComparer.Ordinal)
    {
        "carriers", "countries", "customers", "hubs", "roadmap", "hs_codes", "hs_training", "hs_duty_rates",
        "addresses_labeled", "zip_city", "zip3_state", "streets", "rate_cards", "roles", "fx", "system",
        "pricing_recs", "test_suites"
    };

    public static bool IsIsolated(string? userId) =>
        userId is not null && userId.StartsWith(UserIdPrefix, StringComparison.Ordinal);

    public static string Prefix(string userId) => $"{StoragePrefix}{userId}:";

    public static bool IsShared(string name) => Shared.Contains(name);

    /// <summary>True for storage names that belong to some workspace (never served to the demo account).</summary>
    public static bool IsWorkspaceStorage(string name) => name.StartsWith(StoragePrefix, StringComparison.Ordinal);
}

/// <summary>
/// The evaluation account: an empty company workspace (no orders, shipments or wallet balance)
/// with demo texts turned off in the panel (user.demoMode = false). Created at startup when
/// missing; the password comes from Seed:WorkspacePassword.
/// </summary>
public static class WorkspaceAccount
{
    public const string UserId = "USR-W001";
    public const string Username = "fatmanur";
    public const string Email = "fatmanur@fenece.com";
    public const string Name = "Fatmanur";
    public const string CompanyId = "CMP-W001";
    public const string WalletId = "WAL-W001";
    public const string DefaultPassword = "Fenece#26";

    private const string CompanyName = "Fenece";
    private const string LegalName = "Fenece Tic. Ltd. Şti.";

    public static User CreateUser(string password, DateTime now)
    {
        var profile = new JsonObject
        {
            ["id"] = UserId,
            ["username"] = Username,
            ["name"] = Name,
            ["email"] = Email,
            ["phone"] = "",
            ["role"] = "owner",
            ["isPlatformAdmin"] = false,
            ["customerId"] = "CUS-W001",
            ["timezone"] = SeedService.DefaultTimeZone,
            ["createdAt"] = StateMapper.FormatIso(now),
            ["lastLoginAt"] = null,
            ["twoFactorEnabled"] = false,
            ["demoMode"] = false,
            ["company"] = null,
            ["preferences"] = new JsonObject
            {
                ["lang"] = "tr", ["units"] = "metric", ["currency"] = "TRY", ["optimizerWeight"] = 0.6, ["dateFormat"] = "locale"
            },
            ["onboardingAnswers"] = null,
            ["sessions"] = new JsonArray()
        };
        return new User
        {
            Id = UserId,
            Username = Username,
            Email = Email,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(password, workFactor: 11),
            Name = Name,
            Role = "owner",
            CompanyId = CompanyId,
            CreatedAt = now,
            Profile = StateMapper.ToJson(profile)
        };
    }

    public static Company CreateCompany(DateTime now)
    {
        JsonObject Sender(string hub, string line1, string line2, string city, string state, string zip) => new()
        {
            ["name"] = $"{CompanyName} c/o KargoPazar {hub}", ["line1"] = line1, ["line2"] = line2,
            ["city"] = city, ["state"] = state, ["zip"] = zip, ["country"] = "US"
        };
        var nj = Sender("NJ01", "600 Meadowlands Pkwy", "Dock 4", "Secaucus", "NJ", "07094");
        var data = new JsonObject
        {
            ["name"] = CompanyName,
            ["legalName"] = LegalName,
            ["taxId"] = "",
            ["taxOffice"] = "",
            ["country"] = "TR",
            ["phone"] = "",
            ["plan"] = "enterprise",
            ["planSince"] = StateMapper.FormatIso(now),
            ["defaultHub"] = "NJ01",
            ["hqAddress"] = new JsonObject
            {
                ["name"] = CompanyName, ["company"] = LegalName, ["line1"] = "", ["line2"] = "", ["district"] = "",
                ["city"] = "İstanbul", ["state"] = "İstanbul", ["zip"] = "", ["country"] = "TR", ["phone"] = ""
            },
            ["senderAddress"] = nj.DeepClone(),
            ["senderAddresses"] = new JsonObject
            {
                ["NJ01"] = nj,
                ["LA01"] = Sender("LA01", "1100 E Dominguez St", "Bldg B", "Carson", "CA", "90746")
            }
        };
        return new Company
        {
            Id = CompanyId, Name = CompanyName, LegalName = LegalName, TaxId = "", Phone = "", Plan = "enterprise",
            DefaultHub = "NJ01", Data = StateMapper.ToJson(data)
        };
    }

    public static Wallet CreateWallet() => new()
    {
        Id = WalletId,
        CompanyId = CompanyId,
        Balance = 0m,
        Currency = "USD",
        Data = StateMapper.ToJson(new JsonObject
        {
            ["balance"] = 0,
            ["currency"] = "USD",
            ["autoTopup"] = new JsonObject { ["enabled"] = false, ["threshold"] = 200, ["amount"] = 500, ["cardId"] = null },
            ["cards"] = new JsonArray(),
            ["transactions"] = null
        })
    };

    /// <summary>
    /// Starting content of an empty workspace (stored under the workspace prefix): standard box
    /// presets, the Türkiye origin points, unconnected carrier account slots, fresh id counters, no webhooks, the owner in the team.
    /// </summary>
    public static (List<AppRecord> Records, List<AppDocument> Documents) InitialData(string userId, DateTime now)
    {
        var prefix = Workspace.Prefix(userId);
        var records = new List<AppRecord>();
        void Add(string collection, IEnumerable<JsonNode> items)
        {
            int i = 0;
            foreach (var item in items)
                records.Add(new AppRecord { Collection = prefix + collection, Id = item["id"]!.GetValue<string>(), SortOrder = i++, Data = StateMapper.ToJson(item) });
        }

        Add("box_presets", SeedArray("box_presets"));
        Add("origin_points", OriginPoints(now));
        Add("carrier_accounts", SeedArray("carrier_accounts")
            .Select(a => (JsonNode)new JsonObject { ["id"] = a["id"]!.GetValue<string>(), ["carrier"] = a["carrier"]!.GetValue<string>(), ["status"] = "not_connected" }));
        Add("team", new JsonNode[]
        {
            new JsonObject
            {
                ["id"] = userId, ["name"] = Name, ["email"] = Email, ["role"] = "owner", ["status"] = "active", ["initials"] = "F",
                ["joinedAt"] = StateMapper.FormatIso(now), ["lastActiveAt"] = StateMapper.FormatIso(now)
            }
        });

        // Same id formats as the demo, numbering starts fresh.
        var counters = JsonNode.Parse(SeedService.Raw["counters"])!.AsObject();
        foreach (var key in counters.Select(p => p.Key).Where(k => k != "formats" && k != "INV_YEAR").ToList())
            counters[key] = 1000;
        counters["INV_YEAR"] = now.Year;

        var documents = new List<AppDocument>
        {
            new() { Name = prefix + "counters", Data = StateMapper.ToJson(counters) },
            new() { Name = prefix + "webhooks", Data = StateMapper.ToJson(new JsonObject { ["endpoints"] = new JsonArray(), ["deliveries"] = new JsonArray() }) }
        };
        return (records, documents);
    }

    /// <summary>Türkiye origin points (collection points routed via IST-CP), see origin_points.json.</summary>
    public static IEnumerable<JsonNode> OriginPoints(DateTime now) => SeedArray("origin_points").Select(p =>
    {
        p["createdAt"] = StateMapper.FormatIso(now);
        return p;
    });

    private static IEnumerable<JsonNode> SeedArray(string name) =>
        JsonNode.Parse(SeedService.Raw[name])!.AsArray().Select(n => n!.DeepClone());
}
