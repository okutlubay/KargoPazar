using System.Text.Json;
using KargoPazar.Middleware;
using KargoPazar.Models.DTOs;
using KargoPazar.Models.Enums;
using KargoPazar.Services.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace KargoPazar.Controllers;

[ApiController]
[Authorize]
[Route("api/[controller]")]
public class StateController : ControllerBase
{
    private readonly IStateStore _store;
    private readonly ISeedService _seed;

    public StateController(IStateStore store, ISeedService seed)
    {
        _store = store;
        _seed = seed;
    }

    /// <summary>{ seedVersion, collections: { name: [records] | {document} } }.</summary>
    [HttpGet]
    public async Task<IActionResult> Get() => this.RawJson(await _store.GetStateJsonAsync(this.UserId()));

    /// <summary>{ ops: [...] } applied in one transaction -> { applied }.</summary>
    [HttpPost("batch")]
    [RequestSizeLimit(50_000_000)]
    public async Task<ActionResult<BatchResult>> Batch([FromBody] BatchRequest request)
    {
        if (request.Ops is null) throw ApiException.BadRequest(ErrorCodes.Validation, "ops is required");
        var applied = await _store.ApplyBatchAsync(this.UserId(), request.Ops);
        return new BatchResult(applied);
    }

    /// <summary>Reloads every collection from the seed with fresh dates (password back to Demo123!).</summary>
    [HttpPost("reset")]
    public async Task<IActionResult> Reset()
    {
        await _seed.ReseedAsync();
        return NoContent();
    }

    [HttpGet("export")]
    public async Task<IActionResult> Export() => this.RawJson(await _store.ExportJsonAsync(this.UserId()));

    [HttpPost("import")]
    [RequestSizeLimit(50_000_000)]
    public async Task<IActionResult> Import([FromBody] JsonElement export)
    {
        await _store.ImportAsync(this.UserId(), export);
        return NoContent();
    }
}
