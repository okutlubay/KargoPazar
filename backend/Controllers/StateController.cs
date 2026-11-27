using System.Text.Json;
using KargoPazar.Middleware;
using KargoPazar.Models.DTOs;
using KargoPazar.Models.Enums;
using KargoPazar.Services.Implementations;
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
    private readonly StateStore _state;
    private readonly ISeedService _seed;

    public StateController(IStateStore store, StateStore state, ISeedService seed)
    {
        _store = store;
        _state = state;
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

    /// <summary>
    /// Demo session: drops the visitor's own changes (back to the shared demo data).
    /// Workspace account: empties its own data only.
    /// The shared demo account itself is only reseeded by the server (seed version), never by a request.
    /// </summary>
    [HttpPost("reset")]
    public async Task<IActionResult> Reset()
    {
        if (this.IsPlatformAdmin()) throw new ApiException(403, ErrorCodes.Forbidden, "Not available for the platform administrator");
        var userId = this.UserId();
        if (Workspace.IsEphemeral(userId)) await _state.ResetDemoSessionAsync(userId, DemoSessionService.DemoUserId);
        else if (DemoSessionService.IsDemoUser(userId)) throw new ApiException(403, ErrorCodes.Forbidden, "Not available for the shared demo account");
        else if (Workspace.IsIsolated(userId)) await _store.ResetWorkspaceAsync(userId);
        else await _seed.ReseedAsync();
        return NoContent();
    }

    [HttpGet("export")]
    public async Task<IActionResult> Export() => this.RawJson(await _store.ExportJsonAsync(this.UserId()));

    [HttpPost("import")]
    [RequestSizeLimit(50_000_000)]
    public async Task<IActionResult> Import([FromBody] JsonElement export)
    {
        if (this.IsPlatformAdmin()) throw new ApiException(403, ErrorCodes.Forbidden, "Not available for the platform administrator");
        if (DemoSessionService.IsDemoLike(this.UserId())) throw new ApiException(403, ErrorCodes.Forbidden, "Import is turned off in the demo");
        await _store.ImportAsync(this.UserId(), export);
        return NoContent();
    }
}
