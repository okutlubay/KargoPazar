using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using KargoPazar.Data;
using KargoPazar.Middleware;
using KargoPazar.Models.DTOs;
using KargoPazar.Models.Enums;
using KargoPazar.Services.Interfaces;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;

namespace KargoPazar.Services.Implementations;

public class AuthService : IAuthService
{
    private readonly AppDbContext _db;
    private readonly StateStore _store;
    private readonly ISeedService _seed;
    private readonly IConfiguration _config;

    public AuthService(AppDbContext db, StateStore store, ISeedService seed, IConfiguration config)
    {
        _db = db;
        _store = store;
        _seed = seed;
        _config = config;
    }

    public async Task<LoginResult> LoginAsync(LoginRequest request)
    {
        var identifier = request.Identifier?.Trim().ToLowerInvariant();
        if (string.IsNullOrEmpty(identifier) || string.IsNullOrEmpty(request.Password))
            throw new ApiException(401, ErrorCodes.InvalidCredentials, "Invalid username or password");

        await _seed.EnsureSeededAsync();

        var user = await _db.Users.AsNoTracking()
            .FirstOrDefaultAsync(u => u.Username.ToLower() == identifier || u.Email.ToLower() == identifier);
        if (user is null || !BCrypt.Net.BCrypt.Verify(request.Password, user.PasswordHash))
            throw new ApiException(401, ErrorCodes.InvalidCredentials, "Invalid username or password");

        var expires = DateTime.UtcNow.AddHours(_config.GetValue("Jwt:ExpiryHours", 12));
        var token = CreateToken(user.Id, user.Username, user.Role, expires);
        var doc = await _store.ReadUserDocAsync(user.Id) ?? "{}";
        return new LoginResult(token, expires, doc);
    }

    public async Task<string> GetUserDocumentAsync(string userId) =>
        await _store.ReadUserDocAsync(userId) ?? throw new ApiException(401, ErrorCodes.Unauthorized, "User no longer exists");

    public async Task ChangePasswordAsync(string userId, ChangePasswordRequest request)
    {
        var user = await _db.Users.FindAsync(userId)
            ?? throw new ApiException(401, ErrorCodes.Unauthorized, "User no longer exists");
        if (string.IsNullOrEmpty(request.Current) || !BCrypt.Net.BCrypt.Verify(request.Current, user.PasswordHash))
            throw ApiException.BadRequest(ErrorCodes.WrongPassword, "Current password is incorrect");
        if (!IsStrong(request.Next))
            throw ApiException.BadRequest(ErrorCodes.WeakPassword, "Password must be at least 8 characters and mix at least two of: upper case, lower case, digit, symbol");
        user.PasswordHash = BCrypt.Net.BCrypt.HashPassword(request.Next, workFactor: 11);
        await _db.SaveChangesAsync();
    }

    /// <summary>Re-authentication check for sensitive panel actions (not rate limited like login).</summary>
    public async Task VerifyPasswordAsync(string userId, string? password)
    {
        var hash = await _db.Users.AsNoTracking().Where(u => u.Id == userId).Select(u => u.PasswordHash).FirstOrDefaultAsync()
            ?? throw new ApiException(401, ErrorCodes.Unauthorized, "User no longer exists");
        if (string.IsNullOrEmpty(password) || !BCrypt.Net.BCrypt.Verify(password, hash))
            throw ApiException.BadRequest(ErrorCodes.WrongPassword, "Password is incorrect");
    }

    /// <summary>Same threshold as passwordStrength() score >= 2 in the panel (length 8+ and two character classes).</summary>
    public static bool IsStrong(string? pw)
    {
        if (pw is null || pw.Length < 8 || pw.Length > 128) return false;
        int classes = 0;
        if (pw.Any(char.IsUpper)) classes++;
        if (pw.Any(char.IsLower)) classes++;
        if (pw.Any(char.IsDigit)) classes++;
        if (pw.Any(c => !char.IsLetterOrDigit(c))) classes++;
        return classes >= 2;
    }

    private string CreateToken(string userId, string username, string? role, DateTime expires)
    {
        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_config["Jwt:SigningKey"]!));
        var claims = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Sub, userId),
            new(JwtRegisteredClaimNames.UniqueName, username),
            new(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString("N"))
        };
        if (!string.IsNullOrEmpty(role)) claims.Add(new Claim("role", role));
        var token = new JwtSecurityToken(
            issuer: _config["Jwt:Issuer"],
            audience: _config["Jwt:Audience"],
            claims: claims,
            expires: expires,
            signingCredentials: new SigningCredentials(key, SecurityAlgorithms.HmacSha256));
        return new JwtSecurityTokenHandler().WriteToken(token);
    }
}
