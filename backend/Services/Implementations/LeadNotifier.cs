using System.Globalization;
using System.Net;
using System.Net.Mail;
using System.Text;
using System.Xml.Linq;
using KargoPazar.Models.Domain;

namespace KargoPazar.Services.Implementations;

/// <summary>
/// E-mails the team when a landing contact request arrives, so no request goes unnoticed.
/// SMTP settings (e.g. Amazon SES SMTP): Smtp:Host, Smtp:Port (587), Smtp:Username, Smtp:Password,
/// Smtp:From; recipients: Leads:NotifyTo (comma separated). Without them it only logs.
/// Sending never fails or delays the request: it runs in the background.
/// </summary>
public class LeadNotifier
{
    private readonly IConfiguration _config;
    private readonly ILogger<LeadNotifier> _logger;

    public LeadNotifier(IConfiguration config, ILogger<LeadNotifier> logger)
    {
        _config = config;
        _logger = logger;
    }

    public void Notify(Lead lead, string? topic)
    {
        var host = _config["Smtp:Host"];
        var to = _config["Leads:NotifyTo"];
        var from = _config["Smtp:From"];
        if (string.IsNullOrWhiteSpace(host) || string.IsNullOrWhiteSpace(to) || string.IsNullOrWhiteSpace(from))
        {
            _logger.LogWarning("New lead {LeadId} ({Topic}) but lead e-mail notification is not configured (Smtp:Host, Smtp:From, Leads:NotifyTo)", lead.Id, topic);
            return;
        }
        _ = Task.Run(async () =>
        {
            try
            {
                using var msg = new MailMessage { From = new MailAddress(from, "KargoPazar"), Subject = $"[KargoPazar] Yeni talep #{lead.Id}: {topic ?? "iletişim"} – {lead.Name}", BodyEncoding = Encoding.UTF8, SubjectEncoding = Encoding.UTF8 };
                foreach (var addr in to.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)) msg.To.Add(addr);
                msg.ReplyToList.Add(new MailAddress(lead.Email, lead.Name));
                msg.Body = new StringBuilder()
                    .AppendLine($"Talep no: {lead.Id}")
                    .AppendLine($"Konu: {topic ?? "-"}")
                    .AppendLine($"Ad: {lead.Name}")
                    .AppendLine($"E-posta: {lead.Email}")
                    .AppendLine($"Şirket: {lead.Company ?? "-"}")
                    .AppendLine($"Telefon: {lead.Phone ?? "-"}")
                    .AppendLine($"Tarih (UTC): {lead.CreatedAt:yyyy-MM-dd HH:mm}")
                    .AppendLine()
                    .AppendLine(lead.Message ?? "")
                    .ToString();
                using var smtp = new SmtpClient(host, _config.GetValue("Smtp:Port", 587))
                {
                    EnableSsl = true,
                    Credentials = new NetworkCredential(_config["Smtp:Username"], _config["Smtp:Password"]),
                    Timeout = 15000
                };
                await smtp.SendMailAsync(msg);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Lead {LeadId} notification e-mail failed", lead.Id);
            }
        });
    }
}

/// <summary>
/// Daily exchange rates from the Central Bank of the Republic of Türkiye (TCMB, forex selling),
/// cached for a few hours. Used by the landing calculator instead of the fixed seed rate.
/// </summary>
public class FxService
{
    private const string Url = "https://www.tcmb.gov.tr/kurlar/today.xml";
    private static readonly TimeSpan Ttl = TimeSpan.FromHours(3);
    private static readonly SemaphoreSlim Lock = new(1, 1);
    private static (DateTime At, string Json)? _cache;

    private readonly IHttpClientFactory _http;
    private readonly ILogger<FxService> _logger;

    public FxService(IHttpClientFactory http, ILogger<FxService> logger)
    {
        _http = http;
        _logger = logger;
    }

    /// <summary>{ base: "USD", rates: { TRY, EUR, GBP }, asOf: "yyyy-MM-dd", source: "TCMB" } or null.</summary>
    public async Task<string?> GetJsonAsync()
    {
        if (_cache is { } c && DateTime.UtcNow - c.At < Ttl) return c.Json;
        await Lock.WaitAsync();
        try
        {
            if (_cache is { } c2 && DateTime.UtcNow - c2.At < Ttl) return c2.Json;
            var client = _http.CreateClient();
            client.Timeout = TimeSpan.FromSeconds(6);
            var xml = XDocument.Parse(await client.GetStringAsync(Url));
            decimal? Selling(string code)
            {
                var cur = xml.Root?.Elements("Currency").FirstOrDefault(e => (string?)e.Attribute("CurrencyCode") == code);
                var unit = decimal.TryParse((string?)cur?.Element("Unit"), NumberStyles.Number, CultureInfo.InvariantCulture, out var u) && u > 0 ? u : 1;
                return decimal.TryParse((string?)cur?.Element("ForexSelling"), NumberStyles.Number, CultureInfo.InvariantCulture, out var v) && v > 0 ? v / unit : null;
            }
            var usd = Selling("USD");
            if (usd is null) return _cache?.Json;
            var eur = Selling("EUR");
            var gbp = Selling("GBP");
            var date = (string?)xml.Root?.Attribute("Date");
            var asOf = DateTime.TryParseExact(date, "MM/dd/yyyy", CultureInfo.InvariantCulture, DateTimeStyles.None, out var d)
                ? d.ToString("yyyy-MM-dd") : DateTime.UtcNow.ToString("yyyy-MM-dd");
            var rates = new Dictionary<string, decimal> { ["TRY"] = Math.Round(usd.Value, 4) };
            if (eur is not null) rates["EUR"] = Math.Round(usd.Value / eur.Value, 4);
            if (gbp is not null) rates["GBP"] = Math.Round(usd.Value / gbp.Value, 4);
            var json = System.Text.Json.JsonSerializer.Serialize(new { @base = "USD", rates, asOf, source = "TCMB" });
            _cache = (DateTime.UtcNow, json);
            return json;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "TCMB exchange rates could not be loaded");
            return _cache?.Json;
        }
        finally
        {
            Lock.Release();
        }
    }
}
