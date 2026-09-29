using System.Net;
using System.Text.Json;
using KargoPazar.Models.Enums;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;

namespace KargoPazar.Middleware;

/// <summary>Expected error with an API code, rendered as { code, message }.</summary>
public class ApiException : Exception
{
    public int StatusCode { get; }
    public string Code { get; }

    public ApiException(int statusCode, string code, string message) : base(message)
    {
        StatusCode = statusCode;
        Code = code;
    }

    public static ApiException BadRequest(string code, string message) => new(400, code, message);
}

public class ExceptionMiddleware
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private readonly RequestDelegate _next;
    private readonly ILogger<ExceptionMiddleware> _logger;
    private readonly IHostEnvironment _env;

    public ExceptionMiddleware(RequestDelegate next, ILogger<ExceptionMiddleware> logger, IHostEnvironment env)
    {
        _next = next;
        _logger = logger;
        _env = env;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        try
        {
            await _next(context);
        }
        catch (Exception ex) when (!context.Response.HasStarted)
        {
            var (status, code, message) = ex switch
            {
                ApiException a => (a.StatusCode, a.Code, a.Message),
                BadHttpRequestException b => (b.StatusCode, ErrorCodes.Validation, b.Message),
                JsonException => ((int)HttpStatusCode.BadRequest, ErrorCodes.InvalidJson, "Request body is not valid JSON"),
                DbUpdateConcurrencyException => ((int)HttpStatusCode.Conflict, ErrorCodes.Conflict, "The record was changed concurrently"),
                DbUpdateException => ((int)HttpStatusCode.Conflict, ErrorCodes.Conflict, "The write conflicts with existing data"),
                OperationCanceledException when context.RequestAborted.IsCancellationRequested => (499, "CANCELLED", "Request cancelled"),
                _ => ((int)HttpStatusCode.InternalServerError, ErrorCodes.Internal,
                      _env.IsDevelopment() ? ex.Message : "Unexpected server error")
            };

            if (status >= 500) _logger.LogError(ex, "Unhandled exception: {Message}", ex.Message);
            else if (ex is DbUpdateException) _logger.LogWarning(ex, "Database write rejected");
            else _logger.LogInformation("{Code}: {Message}", code, message);

            context.Response.StatusCode = status;
            context.Response.ContentType = "application/json";
            await context.Response.WriteAsync(JsonSerializer.Serialize(new { code, message }, Json));
        }
    }
}
