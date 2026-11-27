using System.Text.Json;
using KargoPazar.Models.DTOs;
using KargoPazar.Services.Implementations;
using KargoPazar.Services.Interfaces;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace KargoPazar.Controllers;

/// <summary>Unauthenticated endpoints for the landing page.</summary>
[ApiController]
[Route("api/[controller]")]
public class PublicController : ControllerBase
{
    private readonly IPublicService _public;
    private readonly FxService _fx;

    public PublicController(IPublicService publicService, FxService fx)
    {
        _public = publicService;
        _fx = fx;
    }

    /// <summary>Daily TCMB rates: { base: "USD", rates: { TRY, EUR, GBP }, asOf, source }. 503 when unavailable.</summary>
    [HttpGet("fx")]
    [EnableRateLimiting("PublicRateLimit")]
    public async Task<IActionResult> Fx()
    {
        var json = await _fx.GetJsonAsync();
        if (json is null) return StatusCode(503, new { code = "FX_UNAVAILABLE", message = "Exchange rates are not available right now" });
        Response.Headers.CacheControl = "public, max-age=1800";
        return this.RawJson(json);
    }

    /// <summary>{ carriers, rateCards: { platform, plans, firstMile, carrierAgreements }, countries, zipCity }.</summary>
    [HttpGet("pricing-config")]
    public async Task<IActionResult> PricingConfig()
    {
        Response.Headers.CacheControl = "public, max-age=60";
        return this.RawJson(await _public.GetPricingConfigJsonAsync());
    }

    /// <summary>q = comma separated tracking / order numbers -> [{ query, found, shipment }].</summary>
    [HttpGet("track")]
    [EnableRateLimiting("PublicRateLimit")]
    public async Task<IActionResult> Track([FromQuery] string? q) => this.RawJson(await _public.TrackJsonAsync(q));

    /// <summary>Landing contact form -> 201 { id }. Unknown fields are kept in leads.data.</summary>
    [HttpPost("leads")]
    [EnableRateLimiting("LeadRateLimit")]
    public async Task<ActionResult<LeadCreated>> CreateLead([FromBody] JsonElement request)
    {
        // Honeypot: the hidden "website" field is only filled by bots. Answer like a success, store nothing.
        if (request.ValueKind == JsonValueKind.Object && request.TryGetProperty("website", out var hp)
            && hp.ValueKind == JsonValueKind.String && !string.IsNullOrWhiteSpace(hp.GetString()))
            return StatusCode(201, new LeadCreated(0));
        var id = await _public.CreateLeadAsync(request, HttpContext.ClientIp(), Request.Headers.UserAgent.ToString());
        return StatusCode(201, new LeadCreated(id));
    }
}
