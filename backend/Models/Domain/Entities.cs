namespace KargoPazar.Models.Domain;

// Relational core. The panel's `user` document is composed from User + Company and the
// `wallet` document from Wallet + WalletTransaction (see StateMapper). Profile/Data hold the
// verbatim JSON (key order and number formatting preserved); typed columns are derived copies.

public class User
{
    public string Id { get; set; } = "";
    public string Username { get; set; } = "";
    public string Email { get; set; } = "";
    public string PasswordHash { get; set; } = "";
    public string? Name { get; set; }
    public string? Role { get; set; }
    public string? CompanyId { get; set; }
    public DateTime? CreatedAt { get; set; }
    /// <summary>User document without password; "company" holds a null placeholder when a company row exists.</summary>
    public string Profile { get; set; } = "{}";
}

public class Company
{
    public string Id { get; set; } = "";
    public string? Name { get; set; }
    public string? LegalName { get; set; }
    public string? TaxId { get; set; }
    public string? Phone { get; set; }
    public string? Plan { get; set; }
    public string? DefaultHub { get; set; }
    public string Data { get; set; } = "{}";
}

public class Wallet
{
    public string Id { get; set; } = "";
    public string? CompanyId { get; set; }
    public decimal? Balance { get; set; }
    public string? Currency { get; set; }
    /// <summary>Wallet document; "transactions" holds a null placeholder, rows live in wallet_transactions.</summary>
    public string Data { get; set; } = "{}";
}

public class WalletTransaction
{
    public string Id { get; set; } = "";
    public string WalletId { get; set; } = "";
    public string? Type { get; set; }
    public string? Status { get; set; }
    public decimal? Amount { get; set; }
    public decimal? BalanceAfter { get; set; }
    public string? ShipmentId { get; set; }
    public DateTime? CreatedAt { get; set; }
    public double SortOrder { get; set; }
    public string Data { get; set; } = "{}";
}

/// <summary>Documents without a dedicated table (rate_cards, roles, system, counters, ...).</summary>
public class AppDocument
{
    public string Name { get; set; } = "";
    public string Data { get; set; } = "{}";
}

/// <summary>Records of collections without a dedicated table (requestLog, drafts, modelEvents, ...).</summary>
public class AppRecord
{
    public string Collection { get; set; } = "";
    public string Id { get; set; } = "";
    public double SortOrder { get; set; }
    public string Data { get; set; } = "{}";
}

/// <summary>Key/value metadata (seed_version, seeded_at).</summary>
public class AppMeta
{
    public string Name { get; set; } = "";
    public string? Value { get; set; }
}

/// <summary>Landing contact form submissions.</summary>
public class Lead
{
    public long Id { get; set; }
    public string Name { get; set; } = "";
    public string Email { get; set; } = "";
    public string? Company { get; set; }
    public string? Phone { get; set; }
    public string? Message { get; set; }
    public string? Ip { get; set; }
    public string? UserAgent { get; set; }
    public DateTime CreatedAt { get; set; }
    /// <summary>Whole submitted payload (topic, lang, consent, source, ... included).</summary>
    public string? Data { get; set; }
}
