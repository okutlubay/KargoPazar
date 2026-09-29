using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using KargoPazar.Data;
using KargoPazar.Middleware;
using KargoPazar.Models.Domain;
using KargoPazar.Models.DTOs;
using KargoPazar.Models.Enums;
using KargoPazar.Services.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace KargoPazar.Services.Implementations;

/// <summary>Unauthenticated endpoints used by the landing page.</summary>
public partial class PublicService : IPublicService
{
    private const int MaxTrackTokens = 25;
    private static readonly string[] RateCardKeys = { "platform", "plans", "firstMile", "carrierAgreements" };

    private readonly AppDbContext _db;
    private readonly StateStore _store;
    private readonly ICollectionRegistry _registry;
    private readonly ISeedService _seed;

    public PublicService(AppDbContext db, StateStore store, ICollectionRegistry registry, ISeedService seed)
    {
        _db = db;
        _store = store;
        _registry = registry;
        _seed = seed;
    }

    public async Task<string> GetPricingConfigJsonAsync()
    {
        await _seed.EnsureSeededAsync();
        var carriers = await _store.ReadCollectionAsync(_registry.Find("carriers")!);
        var countries = await _store.ReadCollectionAsync(_registry.Find("countries")!);
        var zipCity = await _store.ReadCollectionAsync(_registry.Find("zip_city")!);
        var rateCardsJson = await _db.AppDocuments.AsNoTracking().Where(d => d.Name == "rate_cards")
            .Select(d => d.Data).FirstOrDefaultAsync();

        using var ms = new MemoryStream();
        using (var w = new Utf8JsonWriter(ms, StateMapper.WriterOptions))
        {
            w.WriteStartObject();
            WriteArray(w, "carriers", carriers);
            w.WritePropertyName("rateCards");
            w.WriteStartObject();
            JsonElement rc = default;
            using var rcDoc = rateCardsJson is null ? null : JsonDocument.Parse(rateCardsJson);
            if (rcDoc is not null) rc = rcDoc.RootElement;
            foreach (var key in RateCardKeys)
            {
                w.WritePropertyName(key);
                if (rc.ValueKind == JsonValueKind.Object && rc.TryGetProperty(key, out var v)) v.WriteTo(w);
                else w.WriteNullValue();
            }
            w.WriteEndObject();
            WriteArray(w, "countries", countries);
            WriteArray(w, "zipCity", zipCity);
            w.WriteEndObject();
        }
        return Encoding.UTF8.GetString(ms.ToArray());
    }

    private static void WriteArray(Utf8JsonWriter w, string name, List<string> items)
    {
        w.WritePropertyName(name);
        w.WriteStartArray();
        foreach (var i in items) w.WriteRawValue(i);
        w.WriteEndArray();
    }

    [GeneratedRegex(@"[\s,;]+")]
    private static partial Regex TokenSplit();

    /// <summary>Same matching as trackLookup() in the panel: tracking no or shipment id, then order id / channel order no, then reference.</summary>
    public async Task<string> TrackJsonAsync(string? query)
    {
        var tokens = TokenSplit().Split(query ?? "").Select(t => t.Trim()).Where(t => t.Length > 0 && t.Length <= 64)
            .Distinct().Take(MaxTrackTokens).ToList();
        if (tokens.Count == 0) throw ApiException.BadRequest(ErrorCodes.Validation, "Tracking number required");
        await _seed.EnsureSeededAsync();

        var upper = tokens.Select(t => t.ToUpperInvariant()).ToList();
        var shipments = _db.Collection("shipments").AsNoTracking();

        var direct = await shipments
            .Where(s => upper.Contains(EF.Property<string>(s, "tracking_no")) || upper.Contains(EF.Property<string>(s, "id"))
                        || tokens.Contains(EF.Property<string>(s, "tracking_no")) || tokens.Contains(EF.Property<string>(s, "id")))
            .Select(s => EF.Property<string>(s, "data")).ToListAsync();
        var directDocs = direct.Select(d => JsonNode.Parse(d)!.AsObject()).Where(s => !IsTest(s)).ToList();

        var carriers = new Dictionary<string, JsonObject>(StringComparer.Ordinal);
        foreach (var c in await _store.ReadCollectionAsync(_registry.Find("carriers")!))
            if (JsonNode.Parse(c) is JsonObject co && co["code"]?.GetValueKind() == JsonValueKind.String)
                carriers[co["code"]!.GetValue<string>()] = co;

        using var ms = new MemoryStream();
        using (var w = new Utf8JsonWriter(ms, StateMapper.WriterOptions))
        {
            w.WriteStartArray();
            foreach (var tok in tokens)
            {
                var t = tok.ToUpperInvariant();
                var matches = directDocs.Where(s => Eq(s["trackingNo"], t) || Eq(s["id"], t)).ToList();

                if (matches.Count == 0)
                {
                    var order = await _db.Collection("orders").AsNoTracking()
                        .Where(o => EF.Property<string>(o, "id") == tok || EF.Property<string>(o, "id") == t
                                    || EF.Property<string>(o, "channel_order_no") == tok || EF.Property<string>(o, "channel_order_no") == t)
                        .Select(o => new { Id = EF.Property<string>(o, "id"), ShipmentId = EF.Property<string>(o, "shipment_id") })
                        .FirstOrDefaultAsync();
                    if (order is not null)
                    {
                        var rows = await shipments
                            .Where(s => EF.Property<string>(s, "order_id") == order.Id || (order.ShipmentId != null && EF.Property<string>(s, "id") == order.ShipmentId))
                            .Select(s => EF.Property<string>(s, "data")).ToListAsync();
                        matches = rows.Select(d => JsonNode.Parse(d)!.AsObject()).Where(s => !IsTest(s))
                            .OrderByDescending(s => s["createdAt"]?.ToString(), StringComparer.Ordinal).Take(1).ToList();
                    }
                }

                if (matches.Count == 0)
                {
                    var rows = await shipments
                        .Where(s => EF.Property<string>(s, "reference") == tok || EF.Property<string>(s, "reference") == t)
                        .Select(s => EF.Property<string>(s, "data")).Take(5).ToListAsync();
                    matches = rows.Select(d => JsonNode.Parse(d)!.AsObject()).Where(s => !IsTest(s)).Take(1).ToList();
                }

                if (matches.Count == 0)
                {
                    w.WriteStartObject();
                    w.WriteString("query", tok);
                    w.WriteBoolean("found", false);
                    w.WriteNull("shipment");
                    w.WriteEndObject();
                    continue;
                }
                foreach (var m in matches)
                {
                    w.WriteStartObject();
                    w.WriteString("query", tok);
                    w.WriteBoolean("found", true);
                    w.WritePropertyName("shipment");
                    PublicShipment(m, carriers).WriteTo(w);
                    w.WriteEndObject();
                }
            }
            w.WriteEndArray();
        }
        return Encoding.UTF8.GetString(ms.ToArray());
    }

    private static bool IsTest(JsonObject s) => s["test"] is JsonValue v && v.GetValueKind() == JsonValueKind.True;

    private static bool Eq(JsonNode? n, string upper) =>
        n is JsonValue v && v.GetValueKind() is JsonValueKind.String or JsonValueKind.Number
        && string.Equals(v.ToString().ToUpperInvariant(), upper, StringComparison.Ordinal);

    // Removed everywhere in the public view (customer / recipient contact data).
    private static readonly HashSet<string> ContactKeys = new(StringComparer.Ordinal) { "email", "phone" };
    // Removed from the recipient address: who and where exactly (city/state/zip/country stay).
    private static readonly string[] RecipientKeys = { "name", "company", "line1", "line2" };
    // Internal cost / margin data.
    private static readonly string[] InternalKeys = { "cost", "pricing", "walletCharge", "account", "scaleReading" };

    /// <summary>Stored shipment shape minus personal and internal fields, plus carrierName/serviceName.</summary>
    private static JsonObject PublicShipment(JsonObject s, Dictionary<string, JsonObject> carriers)
    {
        var view = s.DeepClone().AsObject();
        StripContacts(view);
        foreach (var k in InternalKeys) view.Remove(k);
        if (view["to"] is JsonObject to) foreach (var k in RecipientKeys) to.Remove(k);

        string? carrierCode = s["carrier"]?.GetValueKind() == JsonValueKind.String ? s["carrier"]!.GetValue<string>() : null;
        string? serviceCode = s["service"]?.GetValueKind() == JsonValueKind.String ? s["service"]!.GetValue<string>() : null;
        JsonNode? carrierName = null, serviceName = null;
        if (carrierCode is not null && carriers.TryGetValue(carrierCode, out var carrier))
        {
            carrierName = carrier["name"]?.DeepClone();
            if (carrier["services"] is JsonArray services)
                foreach (var sv in services)
                    if (sv is JsonObject so && so["code"]?.ToString() == serviceCode) { serviceName = so["name"]?.DeepClone(); break; }
        }
        view["carrierName"] = carrierName ?? s["carrier"]?.DeepClone();
        view["serviceName"] = serviceName ?? s["service"]?.DeepClone();
        return view;
    }

    private static void StripContacts(JsonNode? node)
    {
        switch (node)
        {
            case JsonObject o:
                foreach (var k in o.Select(kv => kv.Key).Where(ContactKeys.Contains).ToList()) o.Remove(k);
                foreach (var kv in o) StripContacts(kv.Value);
                break;
            case JsonArray a:
                foreach (var x in a) StripContacts(x);
                break;
        }
    }

    [GeneratedRegex(@"^[^@\s]+@[^@\s]+\.[^@\s]+$")]
    private static partial Regex EmailPattern();

    private static string? Field(JsonElement p, string name) =>
        p.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    /// <summary>Known fields go to typed columns; the whole payload (topic, lang, consent, ...) to data.</summary>
    public async Task<long> CreateLeadAsync(JsonElement payload, string? ip, string? userAgent)
    {
        if (payload.ValueKind != JsonValueKind.Object) throw ApiException.BadRequest(ErrorCodes.Validation, "JSON object expected");
        var raw = payload.GetRawText();
        if (raw.Length > 20_000) throw ApiException.BadRequest(ErrorCodes.Validation, "payload too large");
        var name = Field(payload, "name")?.Trim() ?? "";
        var email = Field(payload, "email")?.Trim() ?? "";
        var company = Field(payload, "company");
        var phone = Field(payload, "phone");
        var message = Field(payload, "message");
        if (name.Length is 0 or > 160) throw ApiException.BadRequest(ErrorCodes.Validation, "name is required (max 160 chars)");
        if (email.Length > 190 || !EmailPattern().IsMatch(email)) throw ApiException.BadRequest(ErrorCodes.Validation, "a valid email is required");
        if (company is { Length: > 160 }) throw ApiException.BadRequest(ErrorCodes.Validation, "company max 160 chars");
        if (phone is { Length: > 40 }) throw ApiException.BadRequest(ErrorCodes.Validation, "phone max 40 chars");
        if (message is { Length: > 4000 }) throw ApiException.BadRequest(ErrorCodes.Validation, "message max 4000 chars");

        var lead = new Lead
        {
            Name = name,
            Email = email,
            Company = string.IsNullOrWhiteSpace(company) ? null : company.Trim(),
            Phone = string.IsNullOrWhiteSpace(phone) ? null : phone.Trim(),
            Message = string.IsNullOrWhiteSpace(message) ? null : message.Trim(),
            Ip = ip is { Length: > 64 } ? ip[..64] : ip,
            UserAgent = userAgent is { Length: > 255 } ? userAgent[..255] : userAgent,
            CreatedAt = DateTime.UtcNow,
            Data = raw
        };
        _db.Leads.Add(lead);
        await _db.SaveChangesAsync();
        return lead.Id;
    }
}
