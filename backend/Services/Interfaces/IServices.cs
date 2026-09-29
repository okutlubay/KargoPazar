using System.Text.Json;
using KargoPazar.Models.DTOs;
using KargoPazar.Services.Implementations;

namespace KargoPazar.Services.Interfaces;

public interface ICollectionRegistry
{
    IReadOnlyCollection<CollectionDef> Collections { get; }
    IReadOnlyCollection<string> Documents { get; }
    CollectionDef? Find(string name);
    bool IsKnownDocument(string name);
}

public interface IAuthService
{
    Task<LoginResult> LoginAsync(LoginRequest request);
    Task<string> GetUserDocumentAsync(string userId);
    Task ChangePasswordAsync(string userId, ChangePasswordRequest request);
    Task VerifyPasswordAsync(string userId, string? password);
}

public interface IStateStore
{
    /// <summary>{ seedVersion, collections: {...} } as JSON text.</summary>
    Task<string> GetStateJsonAsync(string userId);

    /// <summary>{ version, seedVersion, exportedAt, data: {...} } as JSON text (version = seedVersion, for older panel exports).</summary>
    Task<string> ExportJsonAsync(string userId);

    /// <summary>Applies every op in one database transaction. Returns the number of ops applied.</summary>
    Task<int> ApplyBatchAsync(string userId, IReadOnlyList<BatchOp> ops);

    /// <summary>Replaces all data with an export ({ data: {...} }). The password is kept.</summary>
    Task ImportAsync(string userId, JsonElement export);
}

public interface ISeedService
{
    /// <summary>Seed version of the embedded seed files.</summary>
    string SeedVersion { get; }

    /// <summary>Seeds the database when it has no users. Safe to call repeatedly.</summary>
    Task EnsureSeededAsync(CancellationToken ct = default);

    /// <summary>Wipes all demo data and reloads the seed with dates resolved against now (password back to Demo123!).</summary>
    Task ReseedAsync(DateTimeOffset? now = null, CancellationToken ct = default);

    /// <summary>Date-resolved seed: name -> JSON text (arrays = collections, objects = documents).</summary>
    IReadOnlyDictionary<string, string> ResolvedSeed(DateTimeOffset now);
}

public interface IPublicService
{
    Task<string> GetPricingConfigJsonAsync();
    Task<string> TrackJsonAsync(string? query);
    Task<long> CreateLeadAsync(JsonElement payload, string? ip, string? userAgent);
}
