using System.Text;
using System.Text.Json;
using KargoPazar.Data;
using KargoPazar.Middleware;
using KargoPazar.Models.Domain;
using KargoPazar.Models.DTOs;
using KargoPazar.Models.Enums;
using KargoPazar.Services.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace KargoPazar.Services.Implementations;

/// <summary>
/// Generic document store behind /api/state. Registry collections live in their own tables,
/// user/wallet are composed from relational tables, everything else goes to app_documents /
/// app_records. Reads return records ordered by sort_order.
/// </summary>
public class StateStore : IStateStore
{
    public const string MetaSeedVersion = "seed_version";
    public const string MetaSeededAt = "seeded_at";
    private const int MaxKeyLength = 64;

    private readonly AppDbContext _db;
    private readonly ICollectionRegistry _registry;
    private readonly ILogger<StateStore> _logger;
    private readonly string _seedVersion;

    public StateStore(AppDbContext db, ICollectionRegistry registry, IConfiguration config, ILogger<StateStore> logger)
    {
        _db = db;
        _registry = registry;
        _logger = logger;
        _seedVersion = SeedService.ConfiguredSeedVersion(config);
    }

    // ── Reads ────────────────────────────────────────────────────────────────

    public async Task<string> GetStateJsonAsync(string userId)
    {
        var (version, collections) = await ReadAllAsync(userId);
        return Write(w =>
        {
            w.WriteString("seedVersion", version);
            w.WritePropertyName("collections");
            WriteCollections(w, collections);
        });
    }

    public async Task<string> ExportJsonAsync(string userId)
    {
        var (version, collections) = await ReadAllAsync(userId);
        return Write(w =>
        {
            w.WriteString("version", version);
            w.WriteString("seedVersion", version);
            w.WriteString("exportedAt", StateMapper.FormatIso(DateTime.UtcNow));
            w.WritePropertyName("data");
            WriteCollections(w, collections);
        });
    }

    private static void WriteCollections(Utf8JsonWriter w, SortedDictionary<string, string> collections)
    {
        w.WriteStartObject();
        foreach (var (name, json) in collections)
        {
            w.WritePropertyName(name);
            w.WriteRawValue(json);
        }
        w.WriteEndObject();
    }

    private static string Write(Action<Utf8JsonWriter> body)
    {
        using var ms = new MemoryStream();
        using (var w = new Utf8JsonWriter(ms, StateMapper.WriterOptions))
        {
            w.WriteStartObject();
            body(w);
            w.WriteEndObject();
        }
        return Encoding.UTF8.GetString(ms.ToArray());
    }

    /// <summary>All collections and documents as JSON text, keyed by name (ordinal order).</summary>
    public async Task<(string SeedVersion, SortedDictionary<string, string> Collections)> ReadAllAsync(string userId)
    {
        var result = new SortedDictionary<string, string>(StringComparer.Ordinal);

        foreach (var def in _registry.Collections)
            result[def.Name] = JoinArray(await ReadCollectionAsync(def));

        foreach (var doc in await _db.AppDocuments.AsNoTracking().ToListAsync())
            result[doc.Name] = doc.Data;

        var records = await _db.AppRecords.AsNoTracking()
            .OrderBy(r => r.Collection).ThenBy(r => r.SortOrder).ThenBy(r => r.Id)
            .Select(r => new { r.Collection, r.Data }).ToListAsync();
        foreach (var g in records.GroupBy(r => r.Collection))
        {
            if (result.ContainsKey(g.Key))
                _logger.LogWarning("Name {Name} exists as a document and as records; records win", g.Key);
            result[g.Key] = JoinArray(g.Select(r => r.Data));
        }

        var user = await ReadUserDocAsync(userId);
        if (user is not null) result[CollectionRegistry.UserDoc] = user;
        var wallet = await ReadWalletDocAsync(userId);
        if (wallet is not null) result[CollectionRegistry.WalletDoc] = wallet;

        var version = await _db.AppMeta.AsNoTracking().Where(m => m.Name == MetaSeedVersion)
            .Select(m => m.Value).FirstOrDefaultAsync();
        return (version ?? _seedVersion, result);
    }

    public async Task<List<string>> ReadCollectionAsync(CollectionDef def)
    {
        var ordered = _db.Collection(def.Name).AsNoTracking().OrderBy(e => EF.Property<double>(e, "sort_order"));
        var q = def.Keyless
            ? ordered.ThenBy(e => EF.Property<int>(e, "seq"))
            : ordered.ThenBy(e => EF.Property<string>(e, def.KeyColumn));
        return await q.Select(e => EF.Property<string>(e, "data")).ToListAsync();
    }

    public async Task<string?> ReadUserDocAsync(string userId)
    {
        var user = await _db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == userId);
        if (user is null) return null;
        string? companyData = null;
        if (user.CompanyId is not null)
            companyData = await _db.Companies.AsNoTracking().Where(c => c.Id == user.CompanyId)
                .Select(c => c.Data).FirstOrDefaultAsync();
        return StateMapper.ComposeUser(user.Profile, companyData);
    }

    public async Task<string?> ReadWalletDocAsync(string userId)
    {
        var wallet = await FindWalletAsync(userId, tracked: false);
        if (wallet is null) return null;
        var txs = await _db.WalletTransactions.AsNoTracking().Where(t => t.WalletId == wallet.Id)
            .OrderBy(t => t.SortOrder).ThenBy(t => t.Id).Select(t => t.Data).ToListAsync();
        return StateMapper.ComposeWallet(wallet.Data, txs);
    }

    private async Task<Wallet?> FindWalletAsync(string userId, bool tracked)
    {
        IQueryable<Wallet> wallets = tracked ? _db.Wallets : _db.Wallets.AsNoTracking();
        var companyId = await _db.Users.Where(u => u.Id == userId).Select(u => u.CompanyId).FirstOrDefaultAsync();
        Wallet? wallet = null;
        if (companyId is not null) wallet = await wallets.FirstOrDefaultAsync(w => w.CompanyId == companyId);
        return wallet ?? await wallets.OrderBy(w => w.Id).FirstOrDefaultAsync();
    }

    private static string JoinArray(IEnumerable<string> items)
    {
        var sb = new StringBuilder("[");
        bool first = true;
        foreach (var i in items)
        {
            if (!first) sb.Append(',');
            sb.Append(i);
            first = false;
        }
        return sb.Append(']').ToString();
    }

    // ── Batch writes ─────────────────────────────────────────────────────────

    private sealed class BatchContext
    {
        public readonly Dictionary<string, (double? Min, double? Max)> Bounds = new(StringComparer.Ordinal);
    }

    public async Task<int> ApplyBatchAsync(string userId, IReadOnlyList<BatchOp> ops)
    {
        for (int i = 0; i < ops.Count; i++) Validate(ops[i], i);

        var strategy = _db.Database.CreateExecutionStrategy();
        return await strategy.ExecuteAsync(async () =>
        {
            _db.ChangeTracker.Clear();
            await using var tx = await _db.Database.BeginTransactionAsync();
            var ctx = new BatchContext();
            for (int i = 0; i < ops.Count; i++)
            {
                try
                {
                    await ApplyOpAsync(userId, ops[i], ctx);
                }
                catch (ApiException ex)
                {
                    _db.ChangeTracker.Clear();
                    throw new ApiException(ex.StatusCode, ex.Code, $"ops[{i}] ({ops[i].Op} {ops[i].Collection}): {ex.Message}");
                }
            }
            await _db.SaveChangesAsync();
            await tx.CommitAsync();
            _db.ChangeTracker.Clear();
            return ops.Count;
        });
    }

    private static void Validate(BatchOp op, int i)
    {
        string where = $"ops[{i}]";
        if (op is null) throw ApiException.BadRequest(ErrorCodes.Validation, $"{where}: op missing");
        if (string.IsNullOrWhiteSpace(op.Collection) || op.Collection.Length > MaxKeyLength)
            throw ApiException.BadRequest(ErrorCodes.Validation, $"{where}: collection is required (max {MaxKeyLength} chars)");
        if (op.Op is not ("upsert" or "delete" or "setDoc" or "replaceCollection"))
            throw ApiException.BadRequest(ErrorCodes.InvalidOp, $"{where}: unknown op '{op.Op}'");
        if (op.Id is { Length: > MaxKeyLength })
            throw ApiException.BadRequest(ErrorCodes.Validation, $"{where}: id longer than {MaxKeyLength} chars");
        if (op.Position is not (null or "first" or "last"))
            throw ApiException.BadRequest(ErrorCodes.Validation, $"{where}: position must be first or last");
        if (op.Op != "delete" && op.Data.ValueKind == JsonValueKind.Undefined)
            throw ApiException.BadRequest(ErrorCodes.Validation, $"{where}: data is required");
    }

    private Task ApplyOpAsync(string userId, BatchOp op, BatchContext ctx) => op.Op switch
    {
        "upsert" => UpsertAsync(op.Collection!, op.Id, op.Data, op.Position, ctx),
        "delete" => DeleteAsync(op.Collection!, op.Id, op.Data),
        "setDoc" => SetDocAsync(userId, op.Collection!, op.Data, ctx),
        "replaceCollection" => ReplaceCollectionAsync(userId, op.Collection!, op.Data, ctx),
        _ => throw ApiException.BadRequest(ErrorCodes.InvalidOp, $"unknown op '{op.Op}'")
    };

    private async Task UpsertAsync(string name, string? id, JsonElement data, string? position, BatchContext ctx)
    {
        if (data.ValueKind != JsonValueKind.Object)
            throw ApiException.BadRequest(ErrorCodes.Validation, "upsert data must be an object");
        if (_registry.IsKnownDocument(name))
            throw ApiException.BadRequest(ErrorCodes.InvalidOp, $"{name} is a document; use setDoc");

        var def = _registry.Find(name);
        if (def is { Keyless: true })
            throw ApiException.BadRequest(ErrorCodes.InvalidOp, $"{name} has no record key; use replaceCollection");

        var key = id ?? StateMapper.KeyOf(data, def?.KeyField)
            ?? throw ApiException.BadRequest(ErrorCodes.MissingId, "record id is required");
        if (key.Length > MaxKeyLength)
            throw ApiException.BadRequest(ErrorCodes.Validation, $"id longer than {MaxKeyLength} chars");
        var text = data.GetRawText();

        if (def is not null)
        {
            var set = _db.Collection(name);
            var existing = await set.FindAsync(key);
            if (existing is not null)
            {
                var entry = _db.Entry(existing);
                var row = StateMapper.ToRow(def, key, 0, data, text);
                foreach (var (prop, value) in row)
                {
                    if (prop == def.KeyColumn || prop == "sort_order") continue;
                    entry.Property(prop).CurrentValue = value;
                }
            }
            else
            {
                var sort = await NextSortAsync(ctx, name, position,
                    () => set.Select(e => (double?)EF.Property<double>(e, "sort_order")));
                set.Add(StateMapper.ToRow(def, key, sort, data, text));
            }
            return;
        }

        var rec = await _db.AppRecords.FindAsync(name, key);
        if (rec is not null)
        {
            rec.Data = text;
        }
        else
        {
            var sort = await NextSortAsync(ctx, name, position,
                () => _db.AppRecords.Where(r => r.Collection == name).Select(r => (double?)r.SortOrder));
            _db.AppRecords.Add(new AppRecord { Collection = name, Id = key, SortOrder = sort, Data = text });
        }
    }

    private static async Task<double> NextSortAsync(BatchContext ctx, string name, string? position, Func<IQueryable<double?>> sortOrders)
    {
        if (!ctx.Bounds.TryGetValue(name, out var b))
        {
            var q = sortOrders();
            b = (await q.MinAsync(), await q.MaxAsync());
        }
        double sort;
        if (position == "last")
        {
            sort = (b.Max ?? -1) + 1;
            b = (b.Min ?? sort, sort);
        }
        else
        {
            sort = (b.Min ?? 1) - 1;
            b = (sort, b.Max ?? sort);
        }
        ctx.Bounds[name] = b;
        return sort;
    }

    private async Task DeleteAsync(string name, string? id, JsonElement data)
    {
        if (_registry.IsKnownDocument(name))
            throw ApiException.BadRequest(ErrorCodes.InvalidOp, $"{name} is a document; use setDoc");
        var def = _registry.Find(name);
        if (def is { Keyless: true })
            throw ApiException.BadRequest(ErrorCodes.InvalidOp, $"{name} has no record key; use replaceCollection");
        var key = id ?? StateMapper.KeyOf(data, def?.KeyField)
            ?? throw ApiException.BadRequest(ErrorCodes.MissingId, "record id is required");

        if (def is not null)
        {
            var set = _db.Collection(name);
            var existing = await set.FindAsync(key);
            if (existing is not null) set.Remove(existing);
            return;
        }
        var rec = await _db.AppRecords.FindAsync(name, key);
        if (rec is not null) _db.AppRecords.Remove(rec);
    }

    private async Task SetDocAsync(string userId, string name, JsonElement data, BatchContext ctx)
    {
        if (name == CollectionRegistry.UserDoc) { await SetUserAsync(userId, data); return; }
        if (name == CollectionRegistry.WalletDoc) { await SetWalletAsync(userId, data); return; }

        var def = _registry.Find(name);
        if (def is not null || (data.ValueKind == JsonValueKind.Array && !_registry.IsKnownDocument(name)))
        {
            if (data.ValueKind != JsonValueKind.Array)
                throw ApiException.BadRequest(ErrorCodes.InvalidOp, $"{name} is a collection; data must be an array");
            await ReplaceCollectionAsync(userId, name, data, ctx);
            return;
        }

        var doc = await _db.AppDocuments.FindAsync(name);
        if (doc is not null) doc.Data = data.GetRawText();
        else _db.AppDocuments.Add(new AppDocument { Name = name, Data = data.GetRawText() });

        if (!_registry.IsKnownDocument(name))
        {
            // An unknown name switched from collection to document: drop stale records.
            await FlushAsync();
            await _db.AppRecords.Where(r => r.Collection == name).ExecuteDeleteAsync();
            ctx.Bounds.Remove(name);
        }
    }

    private async Task ReplaceCollectionAsync(string userId, string name, JsonElement data, BatchContext ctx)
    {
        if (data.ValueKind != JsonValueKind.Array)
        {
            if (data.ValueKind == JsonValueKind.Object && _registry.Find(name) is null)
            {
                await SetDocAsync(userId, name, data, ctx);
                return;
            }
            throw ApiException.BadRequest(ErrorCodes.Validation, "replaceCollection data must be an array");
        }
        if (_registry.IsKnownDocument(name))
            throw ApiException.BadRequest(ErrorCodes.InvalidOp, $"{name} is a document; use setDoc");

        await FlushAsync();
        ctx.Bounds.Remove(name);

        var def = _registry.Find(name);
        if (def is not null)
        {
            var set = _db.Collection(name);
            await set.ExecuteDeleteAsync();
            var rows = BuildRows(def, data);
            set.AddRange(rows);
            ctx.Bounds[name] = rows.Count == 0 ? (null, null) : (0, rows.Count - 1);
            return;
        }

        await _db.AppRecords.Where(r => r.Collection == name).ExecuteDeleteAsync();
        await _db.AppDocuments.Where(d => d.Name == name).ExecuteDeleteAsync();
        var items = data.EnumerateArray().ToList();
        var keys = UniqueKeys(items.Select(r => StateMapper.KeyOf(r, null)), name);
        for (int i = 0; i < items.Count; i++)
            _db.AppRecords.Add(new AppRecord { Collection = name, Id = keys[i], SortOrder = i, Data = items[i].GetRawText() });
        ctx.Bounds[name] = items.Count == 0 ? (null, null) : (0, items.Count - 1);
    }

    /// <summary>Rows for a whole collection in array order (sort_order = index).</summary>
    public List<Dictionary<string, object>> BuildRows(CollectionDef def, JsonElement array)
    {
        var items = array.EnumerateArray().ToList();
        var rows = new List<Dictionary<string, object>>(items.Count);
        if (def.Keyless)
        {
            for (int i = 0; i < items.Count; i++)
                rows.Add(StateMapper.ToRow(def, i, i, items[i], items[i].GetRawText()));
            return rows;
        }
        var keys = UniqueKeys(items.Select(r => StateMapper.KeyOf(r, def.KeyField)), def.Name);
        for (int i = 0; i < items.Count; i++)
            rows.Add(StateMapper.ToRow(def, keys[i], i, items[i], items[i].GetRawText()));
        return rows;
    }

    /// <summary>
    /// Record keys for a full collection write. Missing, over-long or duplicate keys get a
    /// synthetic key (the record JSON is untouched), mirroring JS arrays where the first match wins.
    /// </summary>
    public List<string> UniqueKeys(IEnumerable<string?> keys, string collection)
    {
        var seen = new HashSet<string>(StringComparer.Ordinal);
        var result = new List<string>();
        int i = 0;
        foreach (var k in keys)
        {
            var key = k is { Length: > 0 and <= MaxKeyLength } ? k : $"#{i}";
            if (!seen.Add(key))
            {
                _logger.LogWarning("Duplicate key {Key} in {Collection}; stored under a synthetic key", key, collection);
                key = $"{(key.Length > 40 ? key[..40] : key)}#dup{i}";
                seen.Add(key);
            }
            result.Add(key);
            i++;
        }
        return result;
    }

    private async Task FlushAsync()
    {
        await _db.SaveChangesAsync();
        _db.ChangeTracker.Clear();
    }

    // ── user / wallet documents ──────────────────────────────────────────────

    private async Task SetUserAsync(string userId, JsonElement data)
    {
        if (data.ValueKind != JsonValueKind.Object)
            throw ApiException.BadRequest(ErrorCodes.Validation, "user document must be an object");
        var user = await _db.Users.FindAsync(userId)
            ?? throw new ApiException(401, ErrorCodes.Unauthorized, "User no longer exists");
        var parts = StateMapper.DecomposeUser(data);
        if (user.Role == PlatformAdmin.Role)
        {
            // The platform administrator has no company: only profile fields (preferences, name) change.
            user.Profile = parts.Profile;
            user.Name = parts.Name;
            return;
        }
        await ApplyUserPartsAsync(user, parts);
    }

    /// <summary>Writes a decomposed user document onto a tracked user row (password untouched).</summary>
    public async Task ApplyUserPartsAsync(User user, StateMapper.UserParts parts)
    {
        user.Profile = parts.Profile;
        if (!string.IsNullOrWhiteSpace(parts.Username)) user.Username = parts.Username;
        if (!string.IsNullOrWhiteSpace(parts.Email)) user.Email = parts.Email;
        user.Name = parts.Name;
        // The platform role is never granted through the user document.
        user.Role = parts.Role == PlatformAdmin.Role ? "owner" : parts.Role;
        user.CreatedAt = parts.CreatedAt;
        user.CompanyId ??= parts.CustomerId ?? "CMP-001";

        var company = await _db.Companies.FindAsync(user.CompanyId);
        if (parts.Company is not null)
        {
            if (company is null)
            {
                company = new Company { Id = user.CompanyId };
                _db.Companies.Add(company);
            }
            company.Name = parts.Company.Name;
            company.LegalName = parts.Company.LegalName;
            company.TaxId = parts.Company.TaxId;
            company.Phone = parts.Company.Phone;
            company.Plan = parts.Company.Plan;
            company.DefaultHub = parts.Company.DefaultHub;
            company.Data = parts.Company.Data;
        }
        else if (company is not null)
        {
            _db.Companies.Remove(company);
        }
    }

    private async Task SetWalletAsync(string userId, JsonElement data)
    {
        if (data.ValueKind != JsonValueKind.Object)
            throw ApiException.BadRequest(ErrorCodes.Validation, "wallet document must be an object");
        await FlushAsync();
        var wallet = await FindWalletAsync(userId, tracked: true);
        if (wallet is null)
        {
            var companyId = await _db.Users.Where(u => u.Id == userId).Select(u => u.CompanyId).FirstOrDefaultAsync();
            wallet = new Wallet { Id = "WAL-001", CompanyId = companyId };
            _db.Wallets.Add(wallet);
        }
        var parts = StateMapper.DecomposeWallet(data, wallet.Id);
        wallet.Data = parts.Data;
        wallet.Balance = parts.Balance;
        wallet.Currency = parts.Currency;

        // Diff against stored rows: update changed/moved, insert new, delete removed.
        var existing = await _db.WalletTransactions.Where(t => t.WalletId == wallet.Id)
            .ToDictionaryAsync(t => t.Id, StringComparer.Ordinal);
        var incoming = parts.Transactions;
        var keys = UniqueKeys(incoming.Select(t => (string?)t.Id), "wallet.transactions");
        for (int i = 0; i < incoming.Count; i++)
        {
            var tx = incoming[i];
            tx.Id = keys[i];
            if (existing.Remove(tx.Id, out var cur))
            {
                if (cur.Data == tx.Data && cur.SortOrder == tx.SortOrder) continue;
                cur.Type = tx.Type;
                cur.Status = tx.Status;
                cur.Amount = tx.Amount;
                cur.BalanceAfter = tx.BalanceAfter;
                cur.ShipmentId = tx.ShipmentId;
                cur.CreatedAt = tx.CreatedAt;
                cur.SortOrder = tx.SortOrder;
                cur.Data = tx.Data;
            }
            else
            {
                _db.WalletTransactions.Add(tx);
            }
        }
        _db.WalletTransactions.RemoveRange(existing.Values);
    }

    public void AddTransactions(List<WalletTransaction> txs)
    {
        var keys = UniqueKeys(txs.Select(t => (string?)t.Id), "wallet.transactions");
        for (int i = 0; i < txs.Count; i++) txs[i].Id = keys[i];
        _db.WalletTransactions.AddRange(txs);
    }

    // ── Full replace (seed, reset, import) ───────────────────────────────────

    public async Task ImportAsync(string userId, JsonElement export)
    {
        if (export.ValueKind != JsonValueKind.Object || !export.TryGetProperty("data", out var data) || data.ValueKind != JsonValueKind.Object)
            throw ApiException.BadRequest(ErrorCodes.InvalidExport, "Expected { data: { ... } }");

        var user = await _db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == userId)
            ?? throw new ApiException(401, ErrorCodes.Unauthorized, "User no longer exists");

        var items = new Dictionary<string, JsonElement>(StringComparer.Ordinal);
        foreach (var p in data.EnumerateObject()) items[p.Name] = p.Value;

        using var current = items.ContainsKey(CollectionRegistry.UserDoc)
            ? null
            : JsonDocument.Parse(await ReadUserDocAsync(userId) ?? "{}");
        if (current is not null) items[CollectionRegistry.UserDoc] = current.RootElement;

        await ReplaceAllAsync(items, userId, user.PasswordHash, _seedVersion);
    }

    /// <summary>Wipes every demo table (leads are kept) and loads the given collections/documents.</summary>
    public async Task ReplaceAllAsync(IReadOnlyDictionary<string, JsonElement> data, string userId, string passwordHash, string seedVersion)
    {
        var strategy = _db.Database.CreateExecutionStrategy();
        await strategy.ExecuteAsync(async () =>
        {
            _db.ChangeTracker.Clear();
            await using var tx = await _db.Database.BeginTransactionAsync();

            foreach (var def in _registry.Collections) await _db.Collection(def.Name).ExecuteDeleteAsync();
            await _db.WalletTransactions.ExecuteDeleteAsync();
            await _db.Wallets.ExecuteDeleteAsync();
            await _db.Users.Where(u => u.Role == null || u.Role != PlatformAdmin.Role).ExecuteDeleteAsync();
            await _db.Companies.ExecuteDeleteAsync();
            await _db.AppRecords.ExecuteDeleteAsync();
            await _db.AppDocuments.ExecuteDeleteAsync();
            await _db.AppMeta.ExecuteDeleteAsync();

            string? companyId = null;
            if (data.TryGetValue(CollectionRegistry.UserDoc, out var userDoc) && userDoc.ValueKind == JsonValueKind.Object)
            {
                var parts = StateMapper.DecomposeUser(userDoc);
                var username = string.IsNullOrWhiteSpace(parts.Username) ? "demo" : parts.Username;
                var user = new User
                {
                    Id = userId,
                    Username = username,
                    Email = string.IsNullOrWhiteSpace(parts.Email) ? $"{username}@kargopazar.com" : parts.Email,
                    PasswordHash = passwordHash
                };
                _db.Users.Add(user);
                await ApplyUserPartsAsync(user, parts);
                companyId = user.CompanyId;
            }

            if (data.TryGetValue(CollectionRegistry.WalletDoc, out var walletDoc) && walletDoc.ValueKind == JsonValueKind.Object)
            {
                var wallet = new Wallet { Id = "WAL-001", CompanyId = companyId };
                var parts = StateMapper.DecomposeWallet(walletDoc, wallet.Id);
                wallet.Data = parts.Data;
                wallet.Balance = parts.Balance;
                wallet.Currency = parts.Currency;
                _db.Wallets.Add(wallet);
                AddTransactions(parts.Transactions);
            }

            foreach (var (name, value) in data)
            {
                if (name is CollectionRegistry.UserDoc or CollectionRegistry.WalletDoc) continue;
                if (name.Length > MaxKeyLength)
                {
                    _logger.LogWarning("Skipping {Name}: name too long", name);
                    continue;
                }
                var def = _registry.Find(name);
                if (def is not null)
                {
                    if (value.ValueKind != JsonValueKind.Array)
                    {
                        _logger.LogWarning("Skipping {Name}: expected an array", name);
                        continue;
                    }
                    _db.Collection(name).AddRange(BuildRows(def, value));
                }
                else if (value.ValueKind == JsonValueKind.Array && !_registry.IsKnownDocument(name))
                {
                    var items = value.EnumerateArray().ToList();
                    var keys = UniqueKeys(items.Select(r => StateMapper.KeyOf(r, null)), name);
                    for (int i = 0; i < items.Count; i++)
                        _db.AppRecords.Add(new AppRecord { Collection = name, Id = keys[i], SortOrder = i, Data = items[i].GetRawText() });
                }
                else
                {
                    _db.AppDocuments.Add(new AppDocument { Name = name, Data = value.GetRawText() });
                }
            }

            _db.AppMeta.Add(new AppMeta { Name = MetaSeedVersion, Value = seedVersion });
            _db.AppMeta.Add(new AppMeta { Name = MetaSeededAt, Value = StateMapper.FormatIso(DateTime.UtcNow) });

            await _db.SaveChangesAsync();
            await tx.CommitAsync();
            _db.ChangeTracker.Clear();
        });
    }
}
