// Round-trip and consistency checks for the KargoPazar API without a MySQL server.
//
//   dotnet run --project tests/KargoPazar.RoundTrip            (all checks)
//   dotnet run --project tests/KargoPazar.RoundTrip -- --hash   (print a BCrypt hash of Demo123!)
//
// 1. Relative dates: C# resolution == resolveDates() extracted from frontend/src/app/store/db.js.
// 2. Full stack on SQLite in-memory: seed -> DB -> GET /api/state equals the date-resolved seed
//    for every seed file (same keys, same key order, number text unchanged), then batch ops,
//    change-password, reset, export/import, public endpoints.
// 3. database/002_SeedData.sql (generated with a fixed --now) parsed, loaded and served: equals
//    the seed; typed columns equal the API's own decomposition; generation is deterministic.
// 4. database/001_InitialSchema.sql declares every table/column of the EF model.
using System.Diagnostics;
using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using KargoPazar.Data;
using KargoPazar.Middleware;
using KargoPazar.Models.DTOs;
using KargoPazar.Models.Enums;
using KargoPazar.Services.Implementations;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;

if (args.Contains("--hash"))
{
    Console.WriteLine(BCrypt.Net.BCrypt.HashPassword(SeedService.DefaultPassword, workFactor: 11));
    return 0;
}

var root = FindRoot();
const string Tz = "Europe/Istanbul";
var tz = StateMapper.FindTimeZone(Tz);
var now = DateTimeOffset.Parse("2026-10-01T09:00:00Z", CultureInfo.InvariantCulture);
int failures = 0, passes = 0;

void Check(string name, bool ok, string? detail = null)
{
    if (ok) { passes++; Console.WriteLine($"  PASS {name}"); }
    else { failures++; Console.WriteLine($"  FAIL {name}{(detail is null ? "" : ": " + detail)}"); }
}

async Task Expect(string name, string code, Func<Task> action)
{
    try { await action(); Check(name, false, "no error"); }
    catch (ApiException e) { Check(name, e.Code == code, $"got {e.Code} {e.Message}"); }
}

// ── 1. relative dates vs db.js ──────────────────────────────────────────────
Console.WriteLine("[1] relative dates: C# vs resolveDates() from db.js");
var seedDir = Path.Combine(root, "frontend", "src", "app", "data", "seed");
var seedFiles = Directory.GetFiles(seedDir, "*.json").Select(f => Path.GetFileNameWithoutExtension(f)!).OrderBy(n => n, StringComparer.Ordinal).ToList();
Check($"embedded seed files = {seedFiles.Count} files on disk", SeedService.Raw.Count == seedFiles.Count && seedFiles.All(SeedService.Raw.ContainsKey),
    $"embedded {SeedService.Raw.Count}");

var jsResolved = JsonDocument.Parse(RunNode(Path.Combine(root, "tests", "KargoPazar.RoundTrip", "resolve-seed.mjs"), $"--now={now:yyyy-MM-ddTHH:mm:ssZ}", Tz)).RootElement;
var csResolved = SeedService.Resolve(now, tz);
foreach (var name in seedFiles)
{
    using var cs = JsonDocument.Parse(csResolved[name!]);
    var diffs = new List<string>();
    JsonDiff(jsResolved.GetProperty(name!), cs.RootElement, name!, diffs);
    Check($"resolve {name}", diffs.Count == 0, string.Join("; ", diffs.Take(3)));
}

// ── 2. full stack on SQLite ─────────────────────────────────────────────────
Console.WriteLine("[2] seed -> DB -> GET /api/state, batch ops, auth, reset, export/import, public");
var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
{
    ["Seed:TimeZone"] = Tz,
    ["Jwt:SigningKey"] = "round-trip-test-signing-key-0123456789",
    ["Jwt:Issuer"] = "kargopazar-api",
    ["Jwt:Audience"] = "kargopazar-panel"
}).Build();

var conn = new SqliteConnection("DataSource=:memory:");
conn.Open();
using (var db0 = NewDb(conn)) db0.Database.EnsureCreated();

var s = Services(conn);
await s.Seed.ReseedAsync(now);
const string uid = "USR-001";

async Task<JsonElement> State(Svc sv) => JsonDocument.Parse(await sv.Store.GetStateJsonAsync(uid)).RootElement;

void CompareStateToSeed(JsonElement state, JsonElement expectedSeed, string label)
{
    var cols = state.GetProperty("collections");
    var names = cols.EnumerateObject().Select(p => p.Name).ToHashSet();
    Check($"{label}: {seedFiles.Count} collections present", seedFiles.All(n => names.Contains(n!)) && names.Count == seedFiles.Count,
        $"missing [{string.Join(",", seedFiles.Where(n => !names.Contains(n!)))}] extra [{string.Join(",", names.Where(n => !seedFiles.Contains(n)))}]");
    foreach (var name in seedFiles)
    {
        if (!cols.TryGetProperty(name!, out var got)) continue;
        var expected = expectedSeed.GetProperty(name!);
        if (name == "user") expected = WithoutProperty(expected, "password");
        var diffs = new List<string>();
        JsonDiff(expected, got, name!, diffs);
        Check($"{label}: {name}", diffs.Count == 0, string.Join("; ", diffs.Take(3)));
    }
}

var state = await State(s);
Check("seedVersion", state.GetProperty("seedVersion").GetString() == SeedService.DefaultSeedVersion);
CompareStateToSeed(state, jsResolved, "round-trip");
Check("user has no password", !state.GetProperty("collections").GetProperty("user").TryGetProperty("password", out _));

// typed columns
using (var db = NewDb(conn))
{
    var o = await db.Collection("orders").AsNoTracking().FirstAsync(e => EF.Property<string>(e, "id") == "ORD-10343");
    Check("typed orders.status/customer_email/address_score", (string)o["status"] == "delivered"
        && (string)o["customer_email"] == "santiago.nakamura@hotmail.com" && Convert.ToDouble(o["address_score"]) == 96);
    var u = await db.Users.AsNoTracking().SingleAsync();
    Check("users row: username/email/company_id + BCrypt", u.Username == "demo" && u.Email == "demo@kargopazar.com"
        && u.CompanyId == "CUS-001" && BCrypt.Net.BCrypt.Verify("Demo123!", u.PasswordHash) && !u.Profile.Contains("Demo123!"));
    Check("companies row", (await db.Companies.AsNoTracking().SingleAsync()).LegalName == "Anatolia Home & Craft LLC");
    var w = await db.Wallets.AsNoTracking().SingleAsync();
    Check("wallets.balance DECIMAL", w.Balance == 1248.6m && w.Currency == "USD");
    Check("wallet_transactions rows", await db.WalletTransactions.CountAsync() == jsResolved.GetProperty("wallet").GetProperty("transactions").GetArrayLength());
    Check("app_documents holds 9 documents", await db.AppDocuments.CountAsync() == 9);
}

// auth
{
    var r1 = await s.Auth.LoginAsync(new LoginRequest("demo", "Demo123!"));
    var r2 = await s.Auth.LoginAsync(new LoginRequest("DEMO@kargopazar.com", "Demo123!"));
    Check("login username + email", r1.Token.Length > 20 && r2.Token.Length > 20 && !r1.UserJson.Contains("password"));
    await Expect("login wrong password -> INVALID_CREDENTIALS", ErrorCodes.InvalidCredentials, () => s.Auth.LoginAsync(new LoginRequest("demo", "nope")));
}

// batch ops
{
    var sv = Services(conn);
    string newOrder = """{"id":"ORD-TEST-1","channel":"manual","channelOrderNo":"M-1","status":"new","customer":{"name":"A B","email":"a@b.co"},"total":12.345,"weird":{"z":1,"a":2,"10":3,"2":4},"n":1e21,"f":0.1}""";
    string lastOrder = """{"id":"ORD-TEST-2","status":"new","total":5}""";
    var applied = await sv.Store.ApplyBatchAsync(uid, new List<BatchOp>
    {
        Op("upsert", "orders", "ORD-TEST-1", newOrder, "first"),
        Op("upsert", "orders", "ORD-TEST-2", lastOrder, "last"),
        Op("delete", "orders", "ORD-10343"),
    });
    Check("batch applied count", applied == 3);
    var st = await State(sv);
    var orders = st.GetProperty("collections").GetProperty("orders").EnumerateArray().ToList();
    Check("upsert first -> index 0, verbatim", orders[0].GetRawText() == newOrder, orders[0].GetRawText());
    Check("upsert last -> last index", orders[^1].GetProperty("id").GetString() == "ORD-TEST-2");
    Check("delete removed", orders.All(o => o.GetProperty("id").GetString() != "ORD-10343"));
    Check("order count", orders.Count == jsResolved.GetProperty("orders").GetArrayLength() + 1);

    // update in the middle keeps position
    var mid = orders[10];
    var midId = mid.GetProperty("id").GetString()!;
    var patched = JsonNode.Parse(mid.GetRawText())!.AsObject();
    patched["status"] = "on_hold";
    await sv.Store.ApplyBatchAsync(uid, new List<BatchOp> { Op("upsert", "orders", midId, patched.ToJsonString(StateMapper.JsonOut), "first") });
    var orders2 = (await State(sv)).GetProperty("collections").GetProperty("orders").EnumerateArray().ToList();
    Check("update keeps position + new data", orders2[10].GetProperty("id").GetString() == midId && orders2[10].GetProperty("status").GetString() == "on_hold");
    using (var db = NewDb(conn))
        Check("typed column follows update", (string)(await db.Collection("orders").AsNoTracking().FirstAsync(e => EF.Property<string>(e, "id") == midId))["status"] == "on_hold");

    // wallet setDoc with a new transaction first
    var wallet = JsonNode.Parse(st.GetProperty("collections").GetProperty("wallet").GetRawText())!.AsObject();
    wallet["balance"] = 1236.61;
    wallet["transactions"]!.AsArray().Insert(0, JsonNode.Parse("""{"id":"TXN-9999","at":"2026-10-01T10:00:00.000Z","type":"label","amount":-11.99,"balanceAfter":1236.61,"shipmentId":"SHP-1","status":"completed"}"""));
    var walletJson = wallet.ToJsonString(StateMapper.JsonOut);
    await sv.Store.ApplyBatchAsync(uid, new List<BatchOp> { Op("setDoc", "wallet", null, walletJson) });
    var gotWallet = (await State(sv)).GetProperty("collections").GetProperty("wallet");
    var wd = new List<string>();
    JsonDiff(JsonDocument.Parse(walletJson).RootElement, gotWallet, "wallet", wd);
    Check("setDoc wallet round-trips (new txn first)", wd.Count == 0 && gotWallet.GetProperty("transactions")[0].GetProperty("id").GetString() == "TXN-9999", string.Join("; ", wd.Take(3)));
    using (var db = NewDb(conn))
        Check("wallet typed balance + txn row", (await db.Wallets.SingleAsync()).Balance == 1236.61m
            && (await db.WalletTransactions.SingleAsync(t => t.Id == "TXN-9999")).Amount == -11.99m);

    // idempotent retries: same wallet doc and same upsert/delete batch sent twice
    await Services(conn).Store.ApplyBatchAsync(uid, new List<BatchOp> { Op("setDoc", "wallet", null, walletJson) });
    var retry = new List<BatchOp> { Op("upsert", "orders", "ORD-TEST-1", newOrder, "last"), Op("delete", "orders", "ORD-10343") };
    await Services(conn).Store.ApplyBatchAsync(uid, retry);
    await Services(conn).Store.ApplyBatchAsync(uid, retry);
    var st4 = (await State(Services(conn))).GetProperty("collections");
    var wd2 = new List<string>();
    JsonDiff(JsonDocument.Parse(walletJson).RootElement, st4.GetProperty("wallet"), "wallet", wd2);
    Check("retries are idempotent (wallet unchanged, order keeps index 0, delete no-op)", wd2.Count == 0
        && st4.GetProperty("orders")[0].GetRawText() == newOrder && st4.GetProperty("orders").GetArrayLength() == orders.Count);
    // wallet: remove one txn, reorder -> diff applied
    var w2 = JsonNode.Parse(walletJson)!.AsObject();
    var txArr = w2["transactions"]!.AsArray();
    txArr.RemoveAt(1);
    var moved = txArr[^1]!; txArr.RemoveAt(txArr.Count - 1); txArr.Insert(0, moved);
    var w2Json = w2.ToJsonString(StateMapper.JsonOut);
    await Services(conn).Store.ApplyBatchAsync(uid, new List<BatchOp> { Op("setDoc", "wallet", null, w2Json) });
    var wd3 = new List<string>();
    JsonDiff(JsonDocument.Parse(w2Json).RootElement, (await State(Services(conn))).GetProperty("collections").GetProperty("wallet"), "wallet", wd3);
    Check("wallet diff: removed + reordered transactions", wd3.Count == 0, string.Join("; ", wd3.Take(3)));
    await Services(conn).Store.ApplyBatchAsync(uid, new List<BatchOp> { Op("setDoc", "wallet", null, walletJson) });

    // user setDoc ignores password
    var user = JsonNode.Parse(st.GetProperty("collections").GetProperty("user").GetRawText())!.AsObject();
    user["name"] = "Yeni Ad";
    user["password"] = "hacked123!";
    user["company"]!["plan"] = "growth";
    await sv.Store.ApplyBatchAsync(uid, new List<BatchOp> { Op("setDoc", "user", null, user.ToJsonString(StateMapper.JsonOut)) });
    var gotUser = (await State(sv)).GetProperty("collections").GetProperty("user");
    Check("setDoc user: name/company updated, no password", gotUser.GetProperty("name").GetString() == "Yeni Ad"
        && gotUser.GetProperty("company").GetProperty("plan").GetString() == "growth" && !gotUser.TryGetProperty("password", out _));
    await Expect("setDoc password ignored (old password still valid, new rejected)", ErrorCodes.InvalidCredentials,
        async () => { await sv.Auth.LoginAsync(new LoginRequest("demo", "Demo123!")); await sv.Auth.LoginAsync(new LoginRequest("demo", "hacked123!")); });

    // replaceCollection, documents, unknown collections
    var rules = st.GetProperty("collections").GetProperty("rules").EnumerateArray().Reverse().Select(r => r.GetRawText()).ToList();
    var rulesJson = "[" + string.Join(",", rules) + "]";
    await sv.Store.ApplyBatchAsync(uid, new List<BatchOp>
    {
        Op("replaceCollection", "rules", null, rulesJson),
        Op("setDoc", "counters", null, """{"ORD":99999,"formats":{"x":1}}"""),
        Op("upsert", "requestLog", "REQ-1", """{"id":"REQ-1","path":"/v1/a"}""", "first"),
        Op("upsert", "requestLog", "REQ-2", """{"id":"REQ-2","path":"/v1/b"}""", "first"),
        Op("setDoc", "uiPrefs", null, """{"dense":true}"""),
        Op("replaceCollection", "drafts", null, """[{"a":1},{"a":2}]"""),
        Op("replaceCollection", "zip_city", null, """[{"zip":"00001","city":"X","state":"NJ","primary":true}]"""),
    });
    var st3 = (await State(sv)).GetProperty("collections");
    Check("replaceCollection keeps given order", st3.GetProperty("rules").GetRawText() == rulesJson);
    Check("setDoc known document", st3.GetProperty("counters").GetRawText() == """{"ORD":99999,"formats":{"x":1}}""");
    Check("unknown collection upsert first (app_records)", st3.GetProperty("requestLog").GetRawText() == """[{"id":"REQ-2","path":"/v1/b"},{"id":"REQ-1","path":"/v1/a"}]""");
    Check("unknown document (app_documents)", st3.GetProperty("uiPrefs").GetRawText() == """{"dense":true}""");
    Check("keyless records in unknown collection", st3.GetProperty("drafts").GetRawText() == """[{"a":1},{"a":2}]""");
    Check("keyless registry collection replace", st3.GetProperty("zip_city").GetArrayLength() == 1);

    await Expect("upsert on keyless collection rejected", ErrorCodes.InvalidOp,
        () => sv.Store.ApplyBatchAsync(uid, new List<BatchOp> { Op("upsert", "zip_city", "x", """{"zip":"1"}""") }));
    await Expect("unknown op rejected", ErrorCodes.InvalidOp,
        () => sv.Store.ApplyBatchAsync(uid, new List<BatchOp> { Op("merge", "orders", "x", "{}") }));
    // atomicity: first op valid, second invalid -> nothing applied
    await Expect("batch is atomic (invalid 2nd op)", ErrorCodes.InvalidOp,
        () => Services(conn).Store.ApplyBatchAsync(uid, new List<BatchOp>
        {
            Op("upsert", "orders", "ORD-ATOMIC", """{"id":"ORD-ATOMIC"}"""),
            Op("upsert", "user", "x", "{}")
        }));
    Check("atomic: first op rolled back", !(await State(Services(conn))).GetProperty("collections").GetProperty("orders").GetRawText().Contains("ORD-ATOMIC"));
}

// change password
{
    var sv = Services(conn);
    await Expect("change-password wrong current", ErrorCodes.WrongPassword, () => sv.Auth.ChangePasswordAsync(uid, new ChangePasswordRequest("bad", "NewPass123!")));
    await Expect("change-password weak", ErrorCodes.WeakPassword, () => sv.Auth.ChangePasswordAsync(uid, new ChangePasswordRequest("Demo123!", "short")));
    await sv.Auth.VerifyPasswordAsync(uid, "Demo123!");
    Check("verify-password ok", true);
    await Expect("verify-password wrong", ErrorCodes.WrongPassword, () => sv.Auth.VerifyPasswordAsync(uid, "nope"));
    await sv.Auth.ChangePasswordAsync(uid, new ChangePasswordRequest("Demo123!", "NewPass123!"));
    var ok = await Services(conn).Auth.LoginAsync(new LoginRequest("demo", "NewPass123!"));
    Check("login with new password", ok.Token.Length > 20);
    await Expect("old password rejected", ErrorCodes.InvalidCredentials, () => Services(conn).Auth.LoginAsync(new LoginRequest("demo", "Demo123!")));
}

// export / import
{
    var sv = Services(conn);
    var export = await sv.Store.ExportJsonAsync(uid);
    var exportDoc = JsonDocument.Parse(export).RootElement;
    Check("export has version/seedVersion/exportedAt/data", exportDoc.GetProperty("version").GetString() == SeedService.DefaultSeedVersion && exportDoc.TryGetProperty("seedVersion", out _) && exportDoc.TryGetProperty("exportedAt", out _)
        && exportDoc.GetProperty("data").TryGetProperty("requestLog", out _));
    await sv.Seed.ReseedAsync(now);                          // wipe to seed
    await Services(conn).Auth.LoginAsync(new LoginRequest("demo", "Demo123!"));
    await Services(conn).Auth.ChangePasswordAsync(uid, new ChangePasswordRequest("Demo123!", "Other456!"));
    await Services(conn).Store.ImportAsync(uid, exportDoc);   // restore the export
    var after = (await State(Services(conn))).GetProperty("collections");
    var d = new List<string>();
    JsonDiff(exportDoc.GetProperty("data"), after, "import", d);
    Check("import restores exported data exactly", d.Count == 0, string.Join("; ", d.Take(3)));
    Check("import keeps current password", (await Services(conn).Auth.LoginAsync(new LoginRequest("demo", "Other456!"))).Token.Length > 20);
    await Expect("import rejects bad payload", ErrorCodes.InvalidExport, () => Services(conn).Store.ImportAsync(uid, JsonDocument.Parse("""{"x":1}""").RootElement));
}

// reset
{
    await Services(conn).Seed.ReseedAsync(now);
    Check("reset restores Demo123!", (await Services(conn).Auth.LoginAsync(new LoginRequest("demo", "Demo123!"))).Token.Length > 20);
    var st = await State(Services(conn));
    CompareStateToSeed(st, jsResolved, "after reset");
    Check("reset drops runtime collections", !st.GetProperty("collections").TryGetProperty("requestLog", out _));
}

// public endpoints
{
    var sv = Services(conn);
    var pc = JsonDocument.Parse(await sv.Public.GetPricingConfigJsonAsync()).RootElement;
    Check("pricing-config shape", pc.GetProperty("carriers").GetArrayLength() == 8 && pc.GetProperty("countries").GetArrayLength() == 4
        && pc.GetProperty("zipCity").GetArrayLength() == jsResolved.GetProperty("zip_city").GetArrayLength()
        && new[] { "platform", "plans", "firstMile", "carrierAgreements" }.All(k => pc.GetProperty("rateCards").TryGetProperty(k, out var v) && v.ValueKind != JsonValueKind.Null));
    var ship = jsResolved.GetProperty("shipments")[0];
    var order = jsResolved.GetProperty("orders").EnumerateArray().First(o => o.GetProperty("shipmentId").ValueKind == JsonValueKind.String);
    var tr = JsonDocument.Parse(await sv.Public.TrackJsonAsync($"{ship.GetProperty("trackingNo").GetString()}, {order.GetProperty("id").GetString()};NOPE-1")).RootElement;
    Check("track: 3 results (tracking, order, unknown)", tr.GetArrayLength() == 3 && tr[0].GetProperty("found").GetBoolean()
        && tr[1].GetProperty("found").GetBoolean() && !tr[2].GetProperty("found").GetBoolean()
        && tr[1].GetProperty("shipment").GetProperty("id").GetString() == order.GetProperty("shipmentId").GetString());
    var trText = tr.GetRawText();
    var to0 = tr[0].GetProperty("shipment").GetProperty("to");
    Check("track: full shape, no personal / cost fields", !to0.TryGetProperty("line1", out _) && !to0.TryGetProperty("name", out _)
        && to0.TryGetProperty("city", out _) && !trText.Contains("\"email\"") && !trText.Contains("\"phone\"")
        && !trText.Contains("\"walletCharge\"") && !trText.Contains("\"cost\"") && !trText.Contains(ship.GetProperty("to").GetProperty("name").GetString()!)
        && tr[0].GetProperty("shipment").GetProperty("events").GetArrayLength() == ship.GetProperty("events").GetArrayLength()
        && tr[0].GetProperty("shipment").TryGetProperty("reference", out _));
    Check("track: carrierName resolved", tr[0].GetProperty("shipment").GetProperty("carrierName").ValueKind == JsonValueKind.String);
    await Expect("track: empty query", ErrorCodes.Validation, () => sv.Public.TrackJsonAsync(" , "));
    var leadId = await sv.Public.CreateLeadAsync(JsonDocument.Parse("""{"name":"Ayse","email":"ayse@example.com","company":"ACME","phone":null,"message":"Merhaba","topic":"demo","lang":"tr","consent":true,"source":"landing","createdAt":"2026-10-01T09:00:00.000Z"}""").RootElement, "1.2.3.4", "test");
    using (var db = NewDb(conn))
        Check("lead created, payload kept in data", leadId > 0 && (await db.Leads.SingleAsync(l => l.Id == leadId)).Data!.Contains("\"consent\":true"));
    await Expect("lead invalid email", ErrorCodes.Validation, () => sv.Public.CreateLeadAsync(JsonDocument.Parse("""{"name":"A","email":"bad"}""").RootElement, null, null));
}

// ── 3. generated 002_SeedData.sql ───────────────────────────────────────────
Console.WriteLine("[3] database/002_SeedData.sql (generated) parsed, loaded and served");
var gen = Path.Combine(root, "database", "generate-seed-sql.mjs");
var tmp1 = Path.Combine(Path.GetTempPath(), $"kp-seed-{Guid.NewGuid():N}-1.sql");
var tmp2 = Path.Combine(Path.GetTempPath(), $"kp-seed-{Guid.NewGuid():N}-2.sql");
RunNode(gen, $"--now={now:yyyy-MM-ddTHH:mm:ssZ} --tz={Tz} --out={tmp1}", null);
RunNode(gen, $"--now={now:yyyy-MM-ddTHH:mm:ssZ} --tz={Tz} --out={tmp2}", null);
var sqlText = File.ReadAllText(tmp1);
Check("generator is deterministic for a fixed --now", sqlText == File.ReadAllText(tmp2));
File.Delete(tmp1); File.Delete(tmp2);
var committed = Path.Combine(root, "database", "002_SeedData.sql");
Check("committed 002_SeedData.sql exists and parses", File.Exists(committed) && ParseInserts(File.ReadAllText(committed)).Count > 0);

var inserts = ParseInserts(sqlText);
{
    // typed-column parity with the API's own decomposition
    var registry = CollectionRegistry.Default;
    foreach (var def in registry.Collections)
    {
        using var seedDoc = JsonDocument.Parse(csResolved[def.Name]);
        var apiRows = new StateStore(NewDb(conn), registry, config, NullLogger<StateStore>.Instance).BuildRows(def, seedDoc.RootElement);
        var sqlRows = inserts.Where(i => i.Table == def.Name).SelectMany(i => i.Rows.Select(r => i.Columns.Zip(r).ToDictionary(p => p.First, p => p.Second))).ToList();
        var problems = new List<string>();
        if (apiRows.Count != sqlRows.Count) problems.Add($"rows {apiRows.Count} vs {sqlRows.Count}");
        for (int i = 0; i < Math.Min(apiRows.Count, sqlRows.Count) && problems.Count < 3; i++)
        {
            foreach (var (col, apiVal) in apiRows[i])
            {
                if (!sqlRows[i].TryGetValue(col, out var sqlVal)) { problems.Add($"missing column {col}"); continue; }
                var kind = def.Columns.FirstOrDefault(c => c.Name == col)?.Kind;
                if (col == "created_at") kind = ColumnKind.DateTime;
                if (!SameValue(apiVal, sqlVal, kind, col == "data", def.Columns.FirstOrDefault(c => c.Name == col)?.Scale ?? 2))
                    problems.Add($"row {i} {col}: api={Show(apiVal)} sql={Show(sqlVal)}");
            }
        }
        Check($"002 typed parity {def.Name}", problems.Count == 0, string.Join("; ", problems));
    }

    // load into a fresh database and serve it
    var conn2 = new SqliteConnection("DataSource=:memory:");
    conn2.Open();
    using (var db2 = NewDb(conn2)) db2.Database.EnsureCreated();
    foreach (var ins in inserts)
    {
        foreach (var row in ins.Rows)
        {
            using var cmd = conn2.CreateCommand();
            var cols = string.Join(", ", ins.Columns.Select(c => $"\"{c}\""));
            var ps = string.Join(", ", ins.Columns.Select((_, i) => $"$p{i}"));
            cmd.CommandText = $"INSERT INTO \"{ins.Table}\" ({cols}) VALUES ({ps})";
            for (int i = 0; i < row.Count; i++) cmd.Parameters.AddWithValue($"$p{i}", row[i] ?? DBNull.Value);
            cmd.ExecuteNonQuery();
        }
    }
    var sv2 = Services(conn2);
    var st2 = JsonDocument.Parse(await sv2.Store.GetStateJsonAsync(uid)).RootElement;
    CompareStateToSeed(st2, jsResolved, "002 served");
    Check("002: demo / Demo123! with the precomputed hash", (await sv2.Auth.LoginAsync(new LoginRequest("demo", "Demo123!"))).Token.Length > 20);
    Check("002: seed-now header", sqlText.Contains($"-- seed-now: {now:yyyy-MM-ddTHH:mm:ss}.000Z"));
}

// ── 4. schema file vs EF model ──────────────────────────────────────────────
Console.WriteLine("[4] database/001_InitialSchema.sql vs EF model");
{
    var ddl = File.ReadAllText(Path.Combine(root, "database", "001_InitialSchema.sql"));
    var tables = new Dictionary<string, HashSet<string>>();
    foreach (Match m in Regex.Matches(ddl, @"CREATE TABLE IF NOT EXISTS `(\w+)` \((.*?)\n\) ENGINE", RegexOptions.Singleline))
        tables[m.Groups[1].Value] = Regex.Matches(m.Groups[2].Value, @"^\s+`(\w+)`", RegexOptions.Multiline).Select(x => x.Groups[1].Value).ToHashSet();
    using var db = NewDb(conn);
    foreach (var et in db.Model.GetEntityTypes())
    {
        var table = et.GetTableName()!;
        var so = Microsoft.EntityFrameworkCore.Metadata.StoreObjectIdentifier.Table(table, null);
        var efCols = et.GetProperties().Select(p => p.GetColumnName(so)!).ToHashSet();
        if (!tables.TryGetValue(table, out var sqlCols)) { Check($"schema table {table}", false, "missing in 001"); continue; }
        var missing = efCols.Where(c => !sqlCols.Contains(c)).ToList();
        var extra = sqlCols.Where(c => !efCols.Contains(c) && c != "updated_at").ToList();
        Check($"schema {table}", missing.Count == 0 && extra.Count == 0, $"missing [{string.Join(",", missing)}] unmapped [{string.Join(",", extra)}]");
    }
    Check("schema has no tables unknown to the model", tables.Keys.All(t => db.Model.GetEntityTypes().Any(e => e.GetTableName() == t)));
}

Console.WriteLine($"\n{passes} passed, {failures} failed");
return failures == 0 ? 0 : 1;

// ── helpers ─────────────────────────────────────────────────────────────────

AppDbContext NewDb(SqliteConnection c) =>
    new(new DbContextOptionsBuilder<AppDbContext>().UseSqlite(c).UseSnakeCaseNamingConvention().Options);

Svc Services(SqliteConnection c)
{
    var db = NewDb(c);
    var registry = CollectionRegistry.Default;
    var store = new StateStore(db, registry, config, NullLogger<StateStore>.Instance);
    var seed = new SeedService(db, store, config, NullLogger<SeedService>.Instance);
    return new Svc(store, seed, new AuthService(db, store, seed, config), new PublicService(db, store, registry, seed));
}

static BatchOp Op(string op, string col, string? id, string? data = null, string? position = null) =>
    new(op, col, id, data is null ? default : JsonDocument.Parse(data).RootElement, position);

static string FindRoot()
{
    var dir = new DirectoryInfo(AppContext.BaseDirectory);
    while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "KargoPazar.sln"))) dir = dir.Parent;
    return dir?.FullName ?? throw new InvalidOperationException("repo root (KargoPazar.sln) not found");
}

static string RunNode(string script, string arguments, string? tzEnv)
{
    var psi = new ProcessStartInfo("node", $"\"{script}\" {arguments}")
    {
        RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false,
        StandardOutputEncoding = Encoding.UTF8
    };
    if (tzEnv is not null) psi.Environment["TZ"] = tzEnv;
    using var p = Process.Start(psi)!;
    var stdout = p.StandardOutput.ReadToEnd();
    var stderr = p.StandardError.ReadToEnd();
    p.WaitForExit();
    if (p.ExitCode != 0) throw new InvalidOperationException($"node {script} failed: {stderr}");
    return stdout;
}

static JsonElement WithoutProperty(JsonElement obj, string name)
{
    var node = JsonNode.Parse(obj.GetRawText())!.AsObject();
    node.Remove(name);
    return JsonDocument.Parse(node.ToJsonString()).RootElement;
}

// Structural equality as the browser sees it: same keys in the same (JavaScript) property
// order, same number text, same string values.
static void JsonDiff(JsonElement a, JsonElement b, string path, List<string> diffs)
{
    if (diffs.Count > 10) return;
    if (a.ValueKind != b.ValueKind) { diffs.Add($"{path}: kind {a.ValueKind} vs {b.ValueKind}"); return; }
    switch (a.ValueKind)
    {
        case JsonValueKind.Object:
            var ka = JsOrder(a.EnumerateObject().Select(p => p.Name).ToList());
            var kb = JsOrder(b.EnumerateObject().Select(p => p.Name).ToList());
            if (!ka.SequenceEqual(kb)) { diffs.Add($"{path}: keys [{string.Join(",", ka.Take(12))}] vs [{string.Join(",", kb.Take(12))}]"); return; }
            foreach (var k in ka) JsonDiff(a.GetProperty(k), b.GetProperty(k), $"{path}.{k}", diffs);
            break;
        case JsonValueKind.Array:
            if (a.GetArrayLength() != b.GetArrayLength()) { diffs.Add($"{path}: length {a.GetArrayLength()} vs {b.GetArrayLength()}"); return; }
            for (int i = 0; i < a.GetArrayLength(); i++) JsonDiff(a[i], b[i], $"{path}[{i}]", diffs);
            break;
        case JsonValueKind.Number:
            if (a.GetRawText() != b.GetRawText()) diffs.Add($"{path}: {a.GetRawText()} vs {b.GetRawText()}");
            break;
        case JsonValueKind.String:
            if (a.GetString() != b.GetString()) diffs.Add($"{path}: \"{a.GetString()}\" vs \"{b.GetString()}\"");
            break;
    }
}

// JavaScript own-property order: array-index keys ascending, then the rest in insertion order.
static List<string> JsOrder(List<string> keys)
{
    static bool IsIndex(string k) => Regex.IsMatch(k, "^(0|[1-9][0-9]{0,8})$");
    return keys.Where(IsIndex).OrderBy(long.Parse).Concat(keys.Where(k => !IsIndex(k))).ToList();
}

static bool SameValue(object? api, object? sql, ColumnKind? kind, bool isJson, int scale)
{
    if (api is null || sql is null) return api is null && sql is null;
    if (isJson)
    {
        var d = new List<string>();
        JsonDiff(JsonDocument.Parse((string)api).RootElement, JsonDocument.Parse((string)sql).RootElement, "data", d);
        return d.Count == 0;
    }
    switch (kind)
    {
        case ColumnKind.Decimal:
            return Math.Round(decimal.Parse(Convert.ToString(sql, CultureInfo.InvariantCulture)!, NumberStyles.Float, CultureInfo.InvariantCulture), scale, MidpointRounding.AwayFromZero) == (decimal)api;
        case ColumnKind.DateTime:
            return ((DateTime)api).ToString("yyyy-MM-dd HH:mm:ss.fff", CultureInfo.InvariantCulture) == (string)sql;
        case ColumnKind.Bool:
            return ((bool)api ? 1L : 0L) == Convert.ToInt64(sql, CultureInfo.InvariantCulture);
        case ColumnKind.Int:
        case ColumnKind.Double:
            return Convert.ToDouble(api, CultureInfo.InvariantCulture) == Convert.ToDouble(sql, CultureInfo.InvariantCulture);
        default:
            return Convert.ToString(api, CultureInfo.InvariantCulture) == Convert.ToString(sql, CultureInfo.InvariantCulture);
    }
}

static string Show(object? v) => v is null ? "NULL" : v is string s && s.Length > 60 ? s[..60] + "..." : Convert.ToString(v, CultureInfo.InvariantCulture)!;

// Minimal parser for the INSERT statements emitted by generate-seed-sql.mjs.
static List<Insert> ParseInserts(string sql)
{
    var result = new List<Insert>();
    var header = new Regex(@"INSERT INTO `(\w+)` \(([^)]*)\) VALUES\n");
    int pos = 0;
    while (true)
    {
        var m = header.Match(sql, pos);
        if (!m.Success) break;
        var cols = m.Groups[2].Value.Split(',').Select(c => c.Trim().Trim('`')).ToList();
        int i = m.Index + m.Length;
        var rows = new List<List<object?>>();
        while (true)
        {
            while (sql[i] is '\n' or ' ' or ',') i++;
            if (sql[i] == ';') { i++; break; }
            if (sql[i] != '(') throw new FormatException($"expected ( at {i}");
            i++;
            var row = new List<object?>();
            while (true)
            {
                while (sql[i] == ' ') i++;
                if (sql[i] == '\'')
                {
                    var sb = new StringBuilder();
                    i++;
                    while (sql[i] != '\'')
                    {
                        if (sql[i] == '\\')
                        {
                            i++;
                            sb.Append(sql[i] switch { 'n' => '\n', 'r' => '\r', '0' => '\0', 'Z' => '\x1a', var c => c });
                        }
                        else sb.Append(sql[i]);
                        i++;
                    }
                    i++;
                    row.Add(sb.ToString());
                }
                else
                {
                    int start = i;
                    while (sql[i] != ',' && sql[i] != ')') i++;
                    var tok = sql[start..i].Trim();
                    row.Add(tok == "NULL" ? null
                        : Regex.IsMatch(tok, @"^-?\d+$") ? long.Parse(tok, CultureInfo.InvariantCulture)
                        : double.Parse(tok, NumberStyles.Float, CultureInfo.InvariantCulture));
                }
                while (sql[i] == ' ') i++;
                if (sql[i] == ',') { i++; continue; }
                if (sql[i] == ')') { i++; break; }
                throw new FormatException($"unexpected '{sql[i]}' at {i}");
            }
            if (row.Count != cols.Count) throw new FormatException($"{m.Groups[1].Value}: {row.Count} values for {cols.Count} columns");
            rows.Add(row);
        }
        result.Add(new Insert(m.Groups[1].Value, cols, rows));
        pos = i;
    }
    return result;
}

record Svc(StateStore Store, SeedService Seed, AuthService Auth, PublicService Public);
record Insert(string Table, List<string> Columns, List<List<object?>> Rows);
