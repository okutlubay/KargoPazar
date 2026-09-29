using System.Text.Json;
using KargoPazar.Models.DTOs;
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

    public PublicController(IPublicService publicService) => _public = publicService;

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
        var id = await _public.CreateLeadAsync(request, HttpContext.ClientIp(), Request.Headers.UserAgent.ToString());
        return StatusCode(201, new LeadCreated(id));
    }
}
