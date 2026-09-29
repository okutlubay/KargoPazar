using System.Text.Json;

namespace KargoPazar.Models.DTOs;

// ── Auth ────────────────────────────────────────────────────────────────────

/// <summary>identifier = username or e-mail.</summary>
public record LoginRequest(string? Identifier, string? Password);

public record ChangePasswordRequest(string? Current, string? Next);

public record VerifyPasswordRequest(string? Password);

/// <summary>Login result; UserJson is the composed `user` document (no password).</summary>
public record LoginResult(string Token, DateTime ExpiresAt, string UserJson);

// ── State ───────────────────────────────────────────────────────────────────

/// <summary>
/// One write. op: upsert | delete | setDoc | replaceCollection.
/// position (upsert of a new record only): first (default) | last.
/// </summary>
public record BatchOp(string? Op, string? Collection, string? Id, JsonElement Data, string? Position);

public record BatchRequest(List<BatchOp>? Ops);

public record BatchResult(int Applied);

// ── Public ──────────────────────────────────────────────────────────────────

public record LeadCreated(long Id);

public record ErrorResponse(string Code, string Message);
