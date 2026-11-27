using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using KargoPazar.Data;
using KargoPazar.Models.Domain;
using KargoPazar.Models.DTOs;
using Microsoft.EntityFrameworkCore;

namespace KargoPazar.Services.Implementations;

/// <summary>
/// Per-visitor demo sessions. Signing in with the public demo credentials creates a short-lived
/// workspace ("USR-WD…") that sees the shared demo data and keeps its own changes (copy on write in
/// StateStore), so visitors can neither change nor read what other visitors entered. Sessions are
/// deleted by DemoSessionCleanupService after <see cref="Lifetime"/>.
/// </summary>
public class DemoSessionService
{
    public const string DemoUserId = "USR-001";
    public const string CompanyIdPrefix = "CMP-WD";
    public static readonly TimeSpan Lifetime = TimeSpan.FromHours(24);

    private readonly AppDbContext _db;
    private readonly StateStore _store;

    public DemoSessionService(AppDbContext db, StateStore store)
    {
        _db = db;
        _store = store;
    }

    public static bool IsDemoUser(string? userId) => userId == DemoUserId;

    /// <summary>The shared demo account itself or a demo session: password changes and imports are off.</summary>
    public static bool IsDemoLike(string? userId) => IsDemoUser(userId) || Workspace.IsEphemeral(userId);

    /// <summary>Creates a session copying the demo user's profile, company and wallet.</summary>
    public async Task<User> CreateAsync(User demo)
    {
        var hex = Convert.ToHexString(RandomNumberGenerator.GetBytes(5)).ToLowerInvariant();
        var userId = Workspace.EphemeralUserIdPrefix + hex;
        var now = DateTime.UtcNow;

        string? companyId = null;
        if (demo.CompanyId is not null)
        {
            var company = await _db.Companies.AsNoTracking().FirstOrDefaultAsync(c => c.Id == demo.CompanyId);
            if (company is not null)
            {
                companyId = CompanyIdPrefix + hex;
                _db.Companies.Add(new Company
                {
                    Id = companyId, Name = company.Name, LegalName = company.LegalName, TaxId = company.TaxId,
                    Phone = company.Phone, Plan = company.Plan, DefaultHub = company.DefaultHub, Data = company.Data
                });
            }
        }

        var profile = JsonNode.Parse(demo.Profile) as JsonObject ?? new JsonObject();
        profile["id"] = userId;
        var user = new User
        {
            Id = userId,
            Username = $"demo-{hex}",
            Email = $"demo-{hex}@demo.kargopazar.invalid",
            // Same password as the demo account, so re-authentication prompts accept Demo123!.
            PasswordHash = demo.PasswordHash,
            Name = demo.Name,
            Role = demo.Role,
            CompanyId = companyId,
            CreatedAt = now,
            Profile = StateMapper.ToJson(profile)
        };
        _db.Users.Add(user);
        await _db.SaveChangesAsync();
        _db.ChangeTracker.Clear();

        if (companyId is not null)
        {
            var wallet = await _store.ReadWalletDocAsync(DemoUserId);
            if (wallet is not null)
            {
                using var w = JsonDocument.Parse(wallet);
                await _store.ApplyBatchAsync(userId, new[] { new BatchOp("setDoc", CollectionRegistry.WalletDoc, null, w.RootElement.Clone(), null) });
            }
        }
        return user;
    }
}

/// <summary>Deletes expired demo sessions, and the oldest ones beyond <see cref="MaxSessions"/>.</summary>
public class DemoSessionCleanupService : BackgroundService
{
    private const int MaxSessions = 500;
    private static readonly TimeSpan Interval = TimeSpan.FromMinutes(30);

    private readonly IServiceScopeFactory _scopes;
    private readonly ILogger<DemoSessionCleanupService> _logger;

    public DemoSessionCleanupService(IServiceScopeFactory scopes, ILogger<DemoSessionCleanupService> logger)
    {
        _scopes = scopes;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await Task.Delay(TimeSpan.FromMinutes(1), stoppingToken);
        while (!stoppingToken.IsCancellationRequested)
        {
            try { await RunOnceAsync(); }
            catch (Exception ex) when (!stoppingToken.IsCancellationRequested)
            {
                _logger.LogWarning(ex, "Demo session cleanup failed");
            }
            await Task.Delay(Interval, stoppingToken);
        }
    }

    public async Task<int> RunOnceAsync()
    {
        using var scope = _scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var store = scope.ServiceProvider.GetRequiredService<StateStore>();
        var cutoff = DateTime.UtcNow - DemoSessionService.Lifetime;
        var sessions = await db.Users.AsNoTracking()
            .Where(u => u.Id.StartsWith(Workspace.EphemeralUserIdPrefix))
            .OrderByDescending(u => u.CreatedAt).Select(u => new { u.Id, u.CreatedAt }).ToListAsync();
        var expired = sessions.Where((s, i) => i >= MaxSessions || s.CreatedAt is null || s.CreatedAt < cutoff).Select(s => s.Id).ToList();
        foreach (var id in expired) await store.DeleteDemoSessionAsync(id);
        if (expired.Count > 0) _logger.LogInformation("Deleted {Count} demo sessions", expired.Count);
        return expired.Count;
    }
}
