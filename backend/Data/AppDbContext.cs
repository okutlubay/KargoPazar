using KargoPazar.Models.Domain;
using KargoPazar.Services.Implementations;
using Microsoft.EntityFrameworkCore;

namespace KargoPazar.Data;

/// <summary>
/// Hybrid schema (see database/001_InitialSchema.sql, which is the source of truth for MySQL):
/// relational tables for users/companies/wallets, one shared-type (property bag) entity per
/// registry collection with typed columns, plus generic app_documents / app_records.
/// Column names are snake_case (EFCore.NamingConventions); bag properties are already snake_case.
/// </summary>
public class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) { }

    public DbSet<User> Users => Set<User>();
    public DbSet<Company> Companies => Set<Company>();
    public DbSet<Wallet> Wallets => Set<Wallet>();
    public DbSet<WalletTransaction> WalletTransactions => Set<WalletTransaction>();
    public DbSet<AppDocument> AppDocuments => Set<AppDocument>();
    public DbSet<AppRecord> AppRecords => Set<AppRecord>();
    public DbSet<AppMeta> AppMeta => Set<AppMeta>();
    public DbSet<Lead> Leads => Set<Lead>();

    /// <summary>Property-bag set of a registry collection table.</summary>
    public DbSet<Dictionary<string, object>> Collection(string name) => Set<Dictionary<string, object>>(name);

    protected override void OnModelCreating(ModelBuilder mb)
    {
        base.OnModelCreating(mb);

        mb.Entity<User>(e =>
        {
            e.ToTable("users");
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasMaxLength(64);
            e.Property(x => x.Username).HasMaxLength(64);
            e.Property(x => x.Email).HasMaxLength(190);
            e.Property(x => x.PasswordHash).HasMaxLength(100);
            e.Property(x => x.Name).HasMaxLength(160);
            e.Property(x => x.Role).HasMaxLength(32);
            e.Property(x => x.CompanyId).HasMaxLength(64);
            e.HasIndex(x => x.Username).IsUnique();
            e.HasIndex(x => x.Email).IsUnique();
        });

        mb.Entity<Company>(e =>
        {
            e.ToTable("companies");
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasMaxLength(64);
            e.Property(x => x.Name).HasMaxLength(160);
            e.Property(x => x.LegalName).HasMaxLength(160);
            e.Property(x => x.TaxId).HasMaxLength(32);
            e.Property(x => x.Phone).HasMaxLength(40);
            e.Property(x => x.Plan).HasMaxLength(32);
            e.Property(x => x.DefaultHub).HasMaxLength(16);
        });

        mb.Entity<Wallet>(e =>
        {
            e.ToTable("wallets");
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasMaxLength(64);
            e.Property(x => x.CompanyId).HasMaxLength(64);
            e.Property(x => x.Balance).HasPrecision(12, 2);
            e.Property(x => x.Currency).HasMaxLength(8);
            e.HasIndex(x => x.CompanyId);
        });

        mb.Entity<WalletTransaction>(e =>
        {
            e.ToTable("wallet_transactions");
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasMaxLength(64);
            e.Property(x => x.WalletId).HasMaxLength(64);
            e.Property(x => x.Type).HasMaxLength(32);
            e.Property(x => x.Status).HasMaxLength(32);
            e.Property(x => x.Amount).HasPrecision(12, 2);
            e.Property(x => x.BalanceAfter).HasPrecision(12, 2);
            e.Property(x => x.ShipmentId).HasMaxLength(64);
            e.HasIndex(x => new { x.WalletId, x.SortOrder });
            e.HasIndex(x => x.ShipmentId);
        });

        mb.Entity<AppDocument>(e =>
        {
            e.ToTable("app_documents");
            e.HasKey(x => x.Name);
            e.Property(x => x.Name).HasMaxLength(64);
        });

        mb.Entity<AppRecord>(e =>
        {
            e.ToTable("app_records");
            e.HasKey(x => new { x.Collection, x.Id });
            e.Property(x => x.Collection).HasMaxLength(64);
            e.Property(x => x.Id).HasMaxLength(64);
            e.HasIndex(x => new { x.Collection, x.SortOrder });
        });

        mb.Entity<AppMeta>(e =>
        {
            e.ToTable("app_meta");
            e.HasKey(x => x.Name);
            e.Property(x => x.Name).HasMaxLength(64);
            e.Property(x => x.Value).HasMaxLength(255);
        });

        mb.Entity<Lead>(e =>
        {
            e.ToTable("leads");
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).ValueGeneratedOnAdd();
            e.Property(x => x.Name).HasMaxLength(160);
            e.Property(x => x.Email).HasMaxLength(190);
            e.Property(x => x.Company).HasMaxLength(160);
            e.Property(x => x.Phone).HasMaxLength(40);
            e.Property(x => x.Ip).HasMaxLength(64);
            e.Property(x => x.UserAgent).HasMaxLength(255);
            e.HasIndex(x => x.CreatedAt);
        });

        foreach (var def in CollectionRegistry.Default.Collections)
        {
            mb.SharedTypeEntity<Dictionary<string, object>>(def.Name, b =>
            {
                b.ToTable(def.Table);
                if (def.Keyless)
                {
                    b.Property<int>("seq").ValueGeneratedNever();
                    b.HasKey("seq");
                }
                else
                {
                    b.Property<string>(def.KeyColumn).HasMaxLength(64);
                    b.HasKey(def.KeyColumn);
                }
                b.Property<double>("sort_order");
                b.Property<string>("data").IsRequired();
                b.Property<DateTime?>("created_at");
                foreach (var col in def.Columns)
                {
                    var p = b.Property(col.ClrType, col.Name);
                    if (col.Kind == Models.Enums.ColumnKind.String) p.HasMaxLength(col.Length);
                    if (col.Kind == Models.Enums.ColumnKind.Decimal) p.HasPrecision(col.Precision, col.Scale);
                    if (col.Index) b.HasIndex(col.Name);
                }
                b.HasIndex("sort_order");
            });
        }
    }
}
