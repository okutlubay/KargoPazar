using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using KargoPazar.Middleware;
using KargoPazar.Services.Implementations;
using KargoPazar.Models.Enums;
using Microsoft.AspNetCore.Mvc;

namespace KargoPazar.Controllers;

internal static class ControllerExtensions
{
    /// <summary>Authenticated user id (JWT sub).</summary>
    public static string UserId(this ControllerBase c) =>
        c.User.FindFirst(JwtRegisteredClaimNames.Sub)?.Value
        ?? throw new ApiException(401, ErrorCodes.Unauthorized, "Not signed in");

    /// <summary>True for the platform administrator account (role claim, raw or mapped).</summary>
    public static bool IsPlatformAdmin(this ControllerBase c) =>
        (c.User.FindFirst("role")?.Value ?? c.User.FindFirst(ClaimTypes.Role)?.Value) == PlatformAdmin.Role;

    /// <summary>Pre-serialized JSON body (keeps stored record text untouched).</summary>
    public static ContentResult RawJson(this ControllerBase c, string json, int status = 200) =>
        new() { Content = json, ContentType = "application/json; charset=utf-8", StatusCode = status };

    /// <summary>Client IP, honouring X-Forwarded-For (App Runner / load balancer).</summary>
    public static string? ClientIp(this HttpContext ctx)
    {
        var fwd = ctx.Request.Headers["X-Forwarded-For"].FirstOrDefault();
        return !string.IsNullOrWhiteSpace(fwd) ? fwd.Split(',')[0].Trim() : ctx.Connection.RemoteIpAddress?.ToString();
    }
}
