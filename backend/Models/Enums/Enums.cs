namespace KargoPazar.Models.Enums;

public enum ColumnKind
{
    String,
    Int,
    Double,
    Decimal,
    Bool,
    DateTime
}

/// <summary>Error codes returned as { code, message }.</summary>
public static class ErrorCodes
{
    public const string InvalidCredentials = "INVALID_CREDENTIALS";
    public const string Locked = "LOCKED";
    public const string RateLimited = "RATE_LIMITED";
    public const string Unauthorized = "UNAUTHORIZED";
    public const string WrongPassword = "WRONG_PASSWORD";
    public const string WeakPassword = "WEAK_PASSWORD";
    public const string Validation = "VALIDATION";
    public const string InvalidJson = "INVALID_JSON";
    public const string InvalidOp = "INVALID_OP";
    public const string MissingId = "MISSING_ID";
    public const string DuplicateKey = "DUPLICATE_KEY";
    public const string InvalidExport = "INVALID_EXPORT";
    public const string NotFound = "NOT_FOUND";
    public const string Conflict = "CONFLICT";
    public const string Internal = "INTERNAL";
}
