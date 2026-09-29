using System.Reflection;
using System.Text.Json;
using KargoPazar.Models.Enums;
using KargoPazar.Services.Interfaces;

namespace KargoPazar.Services.Implementations;

/// <summary>Typed column of a collection table (copied from the record on every write).</summary>
public sealed record ColumnDef(string Name, string[] Path, ColumnKind Kind, int Length, int Precision, int Scale, bool Index)
{
    public Type ClrType => Kind switch
    {
        ColumnKind.String => typeof(string),
        ColumnKind.Int => typeof(int?),
        ColumnKind.Double => typeof(double?),
        ColumnKind.Decimal => typeof(decimal?),
        ColumnKind.Bool => typeof(bool?),
        ColumnKind.DateTime => typeof(DateTime?),
        _ => throw new InvalidOperationException(Kind.ToString())
    };
}

/// <summary>A collection with its own table. Table name = collection name.</summary>
public sealed record CollectionDef(string Name, string? KeyField, string[]? CreatedAtPath, IReadOnlyList<ColumnDef> Columns)
{
    public string Table => Name;
    public bool Keyless => KeyField is null;
    /// <summary>Primary key column: id, code, sku or seq (keyless collections).</summary>
    public string KeyColumn => KeyField ?? "seq";
}

/// <summary>
/// Registry loaded from the embedded Data/collections.json (the same file drives
/// database/generate-seed-sql.mjs). Static so AppDbContext can build its model from it.
/// </summary>
public sealed class CollectionRegistry : ICollectionRegistry
{
    public const string UserDoc = "user";
    public const string WalletDoc = "wallet";

    private static readonly Lazy<CollectionRegistry> _default = new(Load);
    public static CollectionRegistry Default => _default.Value;

    private readonly Dictionary<string, CollectionDef> _collections;
    private readonly HashSet<string> _documents;

    private CollectionRegistry(Dictionary<string, CollectionDef> collections, HashSet<string> documents)
    {
        _collections = collections;
        _documents = documents;
    }

    public IReadOnlyCollection<CollectionDef> Collections => _collections.Values;
    public IReadOnlyCollection<string> Documents => _documents;

    public CollectionDef? Find(string name) => _collections.TryGetValue(name, out var d) ? d : null;
    public bool IsKnownDocument(string name) => name is UserDoc or WalletDoc || _documents.Contains(name);

    private static CollectionRegistry Load()
    {
        using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("KargoPazar.Data.collections.json")
            ?? throw new InvalidOperationException("Embedded resource KargoPazar.Data.collections.json missing");
        using var doc = JsonDocument.Parse(stream);
        var root = doc.RootElement;

        var collections = new Dictionary<string, CollectionDef>(StringComparer.Ordinal);
        foreach (var c in root.GetProperty("collections").EnumerateObject())
        {
            var v = c.Value;
            string? key = v.TryGetProperty("key", out var k) && k.ValueKind == JsonValueKind.String ? k.GetString() : null;
            string[]? created = v.TryGetProperty("createdAt", out var ca) && ca.ValueKind == JsonValueKind.String
                ? ca.GetString()!.Split('.') : null;
            var cols = new List<ColumnDef>();
            foreach (var col in v.GetProperty("columns").EnumerateArray())
                cols.Add(ParseColumn(col));
            collections[c.Name] = new CollectionDef(c.Name, key, created, cols);
        }

        var documents = new HashSet<string>(StringComparer.Ordinal);
        foreach (var d in root.GetProperty("documents").EnumerateArray())
            documents.Add(d.GetString()!);

        return new CollectionRegistry(collections, documents);
    }

    private static ColumnDef ParseColumn(JsonElement col)
    {
        var name = col.GetProperty("name").GetString()!;
        var path = col.GetProperty("path").GetString()!.Split('.');
        var type = col.GetProperty("type").GetString()!;
        var index = col.TryGetProperty("index", out var ix) && ix.ValueKind == JsonValueKind.True;
        var parts = type.Split(':');
        switch (parts[0])
        {
            case "string": return new ColumnDef(name, path, ColumnKind.String, int.Parse(parts[1]), 0, 0, index);
            case "int": return new ColumnDef(name, path, ColumnKind.Int, 0, 0, 0, index);
            case "double": return new ColumnDef(name, path, ColumnKind.Double, 0, 0, 0, index);
            case "bool": return new ColumnDef(name, path, ColumnKind.Bool, 0, 0, 0, index);
            case "datetime": return new ColumnDef(name, path, ColumnKind.DateTime, 0, 0, 0, index);
            case "decimal":
                var ps = parts[1].Split(',');
                return new ColumnDef(name, path, ColumnKind.Decimal, 0, int.Parse(ps[0]), int.Parse(ps[1]), index);
            default: throw new InvalidOperationException($"Unknown column type '{type}' for {name}");
        }
    }
}
