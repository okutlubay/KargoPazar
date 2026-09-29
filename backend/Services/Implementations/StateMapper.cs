using System.Globalization;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using KargoPazar.Models.Domain;
using KargoPazar.Models.Enums;

namespace KargoPazar.Services.Implementations;

/// <summary>
/// Pure mapping between panel JSON and table rows (no database access), shared by the
/// state store, the seeder and the round-trip test. Record JSON is stored verbatim so key
/// order and number formatting survive; typed columns are derived copies for querying.
/// </summary>
public static class StateMapper
{
    public static readonly JsonSerializerOptions JsonOut = new()
    {
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
        WriteIndented = false
    };

    public static readonly JsonWriterOptions WriterOptions = new()
    {
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
        Indented = false
    };

    public static string ToJson(JsonNode? node) => node?.ToJsonString(JsonOut) ?? "null";

    // ── Relative dates ───────────────────────────────────────────────────────

    /// <summary>Same rule as isRelDate() in frontend/src/app/store/db.js.</summary>
    public static bool IsRelDate(JsonObject o)
    {
        if (!o.TryGetPropertyValue("daysAgo", out var d) || d is not JsonValue dv || dv.GetValueKind() != JsonValueKind.Number)
            return false;
        foreach (var kv in o)
            if (kv.Key is not ("daysAgo" or "hour" or "minute")) return false;
        return true;
    }

    /// <summary>
    /// Mirrors toIso() in db.js: take "now" in the seed time zone, move the calendar date back
    /// daysAgo days, set local hour:minute (defaults 9:00), convert to UTC, format like
    /// Date.prototype.toISOString().
    /// </summary>
    public static string RelToIso(JsonObject rel, DateTimeOffset now, TimeZoneInfo tz)
    {
        double daysAgo = rel["daysAgo"]!.GetValue<double>();
        double hour = NumberOr(rel, "hour", 9);
        double minute = NumberOr(rel, "minute", 0);

        var local = TimeZoneInfo.ConvertTime(now, tz);
        var wall = local.Date.AddDays(-Math.Truncate(daysAgo)).AddHours(hour).AddMinutes(minute);
        wall = DateTime.SpecifyKind(wall, DateTimeKind.Unspecified);
        var offset = tz.IsInvalidTime(wall) ? tz.GetUtcOffset(wall.AddHours(1)) : tz.GetUtcOffset(wall);
        var utc = new DateTimeOffset(wall, offset).UtcDateTime;
        return FormatIso(utc);
    }

    public static string FormatIso(DateTime utc) =>
        utc.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);

    private static double NumberOr(JsonObject o, string name, double fallback)
    {
        if (o.TryGetPropertyValue(name, out var v) && v is JsonValue jv && jv.GetValueKind() == JsonValueKind.Number)
            return jv.GetValue<double>();
        return fallback; // undefined or null -> ?? default
    }

    /// <summary>Replaces every relative date object with its ISO string (in place when possible).</summary>
    public static JsonNode? ResolveDates(JsonNode? node, DateTimeOffset now, TimeZoneInfo tz)
    {
        switch (node)
        {
            case JsonArray arr:
                for (int i = 0; i < arr.Count; i++)
                {
                    var r = ResolveDates(arr[i], now, tz);
                    if (!ReferenceEquals(r, arr[i])) arr[i] = r;
                }
                return arr;
            case JsonObject obj:
                if (IsRelDate(obj)) return JsonValue.Create(RelToIso(obj, now, tz));
                foreach (var key in obj.Select(kv => kv.Key).ToList())
                {
                    var child = obj[key];
                    var r = ResolveDates(child, now, tz);
                    if (!ReferenceEquals(r, child)) obj[key] = r;
                }
                return obj;
            default:
                return node;
        }
    }

    public static TimeZoneInfo FindTimeZone(string? id)
    {
        if (string.IsNullOrWhiteSpace(id)) return TimeZoneInfo.Utc;
        try { return TimeZoneInfo.FindSystemTimeZoneById(id); }
        catch { return TimeZoneInfo.Utc; }
    }

    // ── Keys and typed columns ───────────────────────────────────────────────

    /// <summary>Record key: the collection's key field, else id, else code. Null when absent.</summary>
    public static string? KeyOf(JsonElement rec, string? keyField)
    {
        if (rec.ValueKind != JsonValueKind.Object) return null;
        foreach (var f in keyField is null or "id" or "code" ? new[] { "id", "code" } : new[] { keyField, "id", "code" })
        {
            if (rec.TryGetProperty(f, out var v))
            {
                if (v.ValueKind == JsonValueKind.String) return v.GetString();
                if (v.ValueKind == JsonValueKind.Number) return v.GetRawText();
            }
        }
        return null;
    }

    public static JsonElement? Get(JsonElement rec, string[] path)
    {
        var cur = rec;
        foreach (var p in path)
        {
            if (cur.ValueKind != JsonValueKind.Object || !cur.TryGetProperty(p, out var next)) return null;
            cur = next;
        }
        return cur;
    }

    /// <summary>Typed value for a column; null when missing or not convertible (never throws).</summary>
    public static object? Extract(JsonElement rec, ColumnDef col) => Convert(Get(rec, col.Path), col.Kind, col.Length, col.Precision, col.Scale);

    public static object? Convert(JsonElement? value, ColumnKind kind, int length = 0, int precision = 12, int scale = 2)
    {
        if (value is not { } v) return null;
        switch (kind)
        {
            case ColumnKind.String:
                string? s = v.ValueKind switch
                {
                    JsonValueKind.String => v.GetString(),
                    JsonValueKind.Number => v.GetRawText(),
                    JsonValueKind.True => "true",
                    JsonValueKind.False => "false",
                    _ => null
                };
                if (s is not null && length > 0 && s.Length > length) s = s[..length];
                return s;
            case ColumnKind.Int:
                return v.ValueKind == JsonValueKind.Number && v.TryGetInt32(out var i) ? i : null;
            case ColumnKind.Double:
                return v.ValueKind == JsonValueKind.Number && v.TryGetDouble(out var d) && double.IsFinite(d) ? d : null;
            case ColumnKind.Decimal:
                if (v.ValueKind != JsonValueKind.Number || !v.TryGetDecimal(out var m)) return null;
                m = Math.Round(m, scale, MidpointRounding.AwayFromZero);
                var limit = (decimal)Math.Pow(10, precision - scale);
                return Math.Abs(m) < limit ? m : null;
            case ColumnKind.Bool:
                return v.ValueKind switch { JsonValueKind.True => true, JsonValueKind.False => false, _ => null };
            case ColumnKind.DateTime:
                return ParseDate(v);
            default:
                return null;
        }
    }

    public static DateTime? ParseDate(JsonElement? value)
    {
        if (value is not { ValueKind: JsonValueKind.String } v) return null;
        var s = v.GetString();
        if (string.IsNullOrEmpty(s) || s.Length < 10) return null;
        if (!DateTimeOffset.TryParse(s, CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var dto)) return null;
        var utc = dto.UtcDateTime;
        if (utc.Year < 1000 || utc.Year > 9999) return null;
        // DATETIME(3): keep millisecond precision.
        return new DateTime(utc.Ticks - utc.Ticks % TimeSpan.TicksPerMillisecond, DateTimeKind.Utc);
    }

    /// <summary>Property bag for a collection table row (every mapped property present).</summary>
    public static Dictionary<string, object> ToRow(CollectionDef def, object key, double sortOrder, JsonElement rec, string data)
    {
        var row = new Dictionary<string, object>(StringComparer.Ordinal)
        {
            [def.KeyColumn] = key,
            ["sort_order"] = sortOrder,
            ["data"] = data,
            ["created_at"] = (def.CreatedAtPath is null ? null : ParseDate(Get(rec, def.CreatedAtPath)))!
        };
        foreach (var col in def.Columns) row[col.Name] = Extract(rec, col)!;
        return row;
    }

    // ── user document <-> users + companies ─────────────────────────────────

    public sealed record UserParts(string Profile, string? Username, string? Email, string? Name, string? Role,
        DateTime? CreatedAt, string? CustomerId, bool HasCompany, Company? Company);

    /// <summary>Splits the user document. password is dropped; company goes to its own row.</summary>
    public static UserParts DecomposeUser(JsonElement doc)
    {
        if (doc.ValueKind != JsonValueKind.Object) throw new ArgumentException("user document must be an object");
        var obj = JsonNode.Parse(doc.GetRawText())!.AsObject();
        obj.Remove("password");

        Company? company = null;
        bool hasCompany = doc.TryGetProperty("company", out var c) && c.ValueKind == JsonValueKind.Object;
        if (hasCompany)
        {
            company = new Company
            {
                Name = Str(c, "name", 160),
                LegalName = Str(c, "legalName", 160),
                TaxId = Str(c, "taxId", 32),
                Phone = Str(c, "phone", 40),
                Plan = Str(c, "plan", 32),
                DefaultHub = Str(c, "defaultHub", 16),
                Data = c.GetRawText()
            };
            obj["company"] = null; // placeholder keeps key order
        }

        return new UserParts(ToJson(obj), Str(doc, "username", 64), Str(doc, "email", 190), Str(doc, "name", 160),
            Str(doc, "role", 32), ParseDate(Get(doc, new[] { "createdAt" })), Str(doc, "customerId", 64), hasCompany, company);
    }

    public static string ComposeUser(string profile, string? companyData)
    {
        if (companyData is null) return profile;
        var obj = JsonNode.Parse(profile)!.AsObject();
        obj["company"] = JsonNode.Parse(companyData);
        return ToJson(obj);
    }

    // ── wallet document <-> wallets + wallet_transactions ───────────────────

    public sealed record WalletParts(string Data, decimal? Balance, string? Currency, List<WalletTransaction> Transactions);

    public static WalletParts DecomposeWallet(JsonElement doc, string walletId)
    {
        if (doc.ValueKind != JsonValueKind.Object) throw new ArgumentException("wallet document must be an object");
        var obj = JsonNode.Parse(doc.GetRawText())!.AsObject();
        var txs = new List<WalletTransaction>();
        if (doc.TryGetProperty("transactions", out var t) && t.ValueKind == JsonValueKind.Array)
        {
            int i = 0;
            foreach (var tx in t.EnumerateArray())
            {
                txs.Add(new WalletTransaction
                {
                    Id = KeyOf(tx, "id") ?? $"#{i}",
                    WalletId = walletId,
                    Type = Str(tx, "type", 32),
                    Status = Str(tx, "status", 32),
                    Amount = (decimal?)Convert(Get(tx, new[] { "amount" }), ColumnKind.Decimal, 0, 12, 2),
                    BalanceAfter = (decimal?)Convert(Get(tx, new[] { "balanceAfter" }), ColumnKind.Decimal, 0, 12, 2),
                    ShipmentId = Str(tx, "shipmentId", 64),
                    CreatedAt = ParseDate(Get(tx, new[] { "at" })),
                    SortOrder = i,
                    Data = tx.GetRawText()
                });
                i++;
            }
            obj["transactions"] = null; // placeholder keeps key order
        }
        return new WalletParts(ToJson(obj),
            (decimal?)Convert(Get(doc, new[] { "balance" }), ColumnKind.Decimal, 0, 12, 2),
            Str(doc, "currency", 8), txs);
    }

    public static string ComposeWallet(string data, IEnumerable<string> transactions)
    {
        var obj = JsonNode.Parse(data)!.AsObject();
        if (!obj.ContainsKey("transactions")) return data;
        var arr = new JsonArray();
        foreach (var t in transactions) arr.Add(JsonNode.Parse(t));
        obj["transactions"] = arr;
        return ToJson(obj);
    }

    private static string? Str(JsonElement e, string name, int max) =>
        (string?)Convert(Get(e, new[] { name }), ColumnKind.String, max);

    /// <summary>Unique-key guard for replaceCollection.</summary>
    public static void EnsureUnique(IEnumerable<string> keys, string collection)
    {
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var k in keys)
            if (!seen.Add(k))
                throw Middleware.ApiException.BadRequest(ErrorCodes.DuplicateKey, $"Duplicate key '{k}' in {collection}");
    }
}
