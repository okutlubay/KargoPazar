using System.Text.Json.Nodes;
using KargoPazar.Models.DTOs;
using KargoPazar.Services.Implementations;
using KargoPazar.Services.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace KargoPazar.Controllers;

[ApiController]
[Route("api/[controller]")]
public class AuthController : ControllerBase
{
    private readonly IAuthService _auth;

    public AuthController(IAuthService auth) => _auth = auth;

    /// <summary>{ identifier, password } -> { token, expiresAt, user }.</summary>
    [HttpPost("login")]
    [EnableRateLimiting("AuthRateLimit")]
    public async Task<IActionResult> Login([FromBody] LoginRequest request)
    {
        var result = await _auth.LoginAsync(request);
        var body = new JsonObject
        {
            ["token"] = result.Token,
            ["expiresAt"] = StateMapper.FormatIso(result.ExpiresAt),
            ["user"] = JsonNode.Parse(result.UserJson)
        };
        return this.RawJson(StateMapper.ToJson(body));
    }

    [Authorize]
    [HttpGet("me")]
    public async Task<IActionResult> Me()
    {
        var user = await _auth.GetUserDocumentAsync(this.UserId());
        return this.RawJson($"{{\"user\":{user}}}");
    }

    /// <summary>{ password } -> 204, or 400 WRONG_PASSWORD. Not counted by the login rate limiter.</summary>
    [Authorize]
    [HttpPost("verify-password")]
    public async Task<IActionResult> VerifyPassword([FromBody] VerifyPasswordRequest request)
    {
        await _auth.VerifyPasswordAsync(this.UserId(), request.Password);
        return NoContent();
    }

    [Authorize]
    [HttpPost("change-password")]
    public async Task<IActionResult> ChangePassword([FromBody] ChangePasswordRequest request)
    {
        await _auth.ChangePasswordAsync(this.UserId(), request);
        return NoContent();
    }
}
