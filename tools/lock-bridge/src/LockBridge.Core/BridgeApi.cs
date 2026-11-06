using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace LockBridge.Core;

public sealed record IssueRequest(string? Order, string? Signature, int? CardNo);
public sealed record PairRequest(string? Code);

/// <summary>
/// The bridge's HTTP side, on 127.0.0.1 only. A page may call it only from the
/// hotel's own site (Origin), only by the bridge's own address (Host, against
/// DNS rebinding) and only with JSON (no plain form posts). Writing a card needs
/// an order the server signed; nothing here writes master, floor or system cards.
/// </summary>
public static class BridgeApi
{
    private const long MaxBody = 64 * 1024;

    public static WebApplication Build(Bridge bridge, Action<WebApplicationBuilder>? configure = null)
    {
        var options = bridge.Options;
        var builder = WebApplication.CreateSlimBuilder();
        builder.Logging.SetMinimumLevel(LogLevel.Warning);
        builder.WebHost.ConfigureKestrel(k =>
        {
            k.AddServerHeader = false;
            k.Limits.MaxRequestBodySize = MaxBody;
            k.Listen(System.Net.IPAddress.Loopback, options.Port);
        });
        builder.Services.ConfigureHttpJsonOptions(j =>
        {
            j.SerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
            j.SerializerOptions.DefaultIgnoreCondition = JsonIgnoreCondition.Never;
        });
        configure?.Invoke(builder);

        var app = builder.Build();
        app.Use((ctx, next) => Guard(ctx, next, options));

        app.MapGet("/status", async (CancellationToken ct) =>
        {
            DriverStatus driver;
            try
            {
                using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
                timeout.CancelAfter(TimeSpan.FromSeconds(5));
                driver = await bridge.Driver.StatusAsync(timeout.Token);
            }
            catch (Exception ex) { driver = new DriverStatus(false, null, $"The encoder did not answer: {ex.Message}"); }
            if (driver.DllVersion is not null) bridge.DllVersion = driver.DllVersion;

            var s = bridge.Session;
            return Results.Json(new
            {
                ok = true,
                version = options.BridgeVersion,
                paired = s is not null,
                encoderId = s?.Config.EncoderId,
                label = s?.Config.Label,
                encoder = new { name = bridge.Driver.Name, ready = driver.Ready, message = driver.Message, dllVersion = driver.DllVersion },
                busy = s?.Writer.Busy ?? false,
                unsentResults = s?.Writer.PendingReceipts().Sum(p => p.Cards.Count) ?? 0,
                serverError = s?.Receipts.LastError,
                revoked = s?.Receipts.Revoked ?? false,
            });
        });

        app.MapPost("/challenge", () =>
        {
            if (bridge.Session is not { } s) return Problem(409, "This PC is not paired yet. Pair it in Settings → Door locks.");
            return Results.Json(new { challenge = s.Challenges.Issue(), encoderId = s.Config.EncoderId });
        });

        app.MapPost("/cards/issue", async (IssueRequest req) =>
        {
            if (bridge.Session is not { } s) return Problem(409, "This PC is not paired yet. Pair it in Settings → Door locks.");
            if (string.IsNullOrEmpty(req.Order) || string.IsNullOrEmpty(req.Signature) || req.CardNo is not int cardNo)
                return Problem(400, "order, signature and cardNo are required.");
            var outcome = await s.Writer.IssueAsync(req.Order, req.Signature, cardNo);
            return Results.Json(new { nonce = outcome.Nonce, cardNo = outcome.CardNo, status = outcome.Status, error = outcome.Error }, statusCode: outcome.HttpStatus);
        });

        app.MapGet("/orders/{nonce}", (string nonce) =>
        {
            if (bridge.Session is not { } s) return Problem(409, "This PC is not paired yet.");
            var cards = s.Writer.OrderState(nonce);
            if (cards.Count == 0) return Problem(404, "No card of this order has been written on this PC.");
            return Results.Json(new
            {
                nonce,
                cards = cards.OrderBy(c => c.Key).Select(c => new { cardNo = c.Key, status = c.Value.Status, error = c.Value.Error, reported = c.Value.Sent }),
            });
        });

        app.MapPost("/pair", async (PairRequest req, CancellationToken ct) =>
        {
            if (string.IsNullOrWhiteSpace(req.Code)) return Problem(400, "The pairing code is required.");
            var outcome = await bridge.PairAsync(req.Code, ct);
            if (outcome.Config is null) return Problem(outcome.HttpStatus, outcome.Error ?? "Pairing failed.");
            return Results.Json(new { paired = true, encoderId = outcome.Config.EncoderId, label = outcome.Config.Label });
        });

        return app;
    }

    private static IResult Problem(int status, string error) => Results.Json(new { error }, statusCode: status);

    internal static async Task Guard(HttpContext ctx, Func<Task> next, BridgeOptions options)
    {
        var res = ctx.Response;
        res.Headers.CacheControl = "no-store";
        res.Headers.XContentTypeOptions = "nosniff";

        if (!string.Equals(ctx.Request.Host.Value, options.ExpectedHost, StringComparison.OrdinalIgnoreCase))
        {
            await Refuse(ctx, 403, "Wrong host.");
            return;
        }

        var origin = ctx.Request.Headers.Origin.ToString();
        var hasOrigin = origin.Length > 0;
        var allowed = hasOrigin && options.AllowedOrigins.Contains(origin, StringComparer.Ordinal);
        if (hasOrigin && !allowed)
        {
            await Refuse(ctx, 403, "This page may not use the lock bridge.");
            return;
        }
        if (allowed)
        {
            res.Headers.AccessControlAllowOrigin = origin;
            res.Headers.Vary = "Origin";
        }

        if (HttpMethods.IsOptions(ctx.Request.Method))
        {
            if (!allowed) { await Refuse(ctx, 403, "This page may not use the lock bridge."); return; }
            res.Headers.AccessControlAllowMethods = "GET, POST";
            res.Headers.AccessControlAllowHeaders = "Content-Type";
            res.Headers.AccessControlMaxAge = "600";
            if (ctx.Request.Headers.ContainsKey("Access-Control-Request-Private-Network"))
                res.Headers["Access-Control-Allow-Private-Network"] = "true";
            res.StatusCode = 204;
            return;
        }

        if (HttpMethods.IsPost(ctx.Request.Method))
        {
            // A browser always sends Origin on a cross-site POST; one without it is not from the portal.
            if (!allowed) { await Refuse(ctx, 403, "This page may not use the lock bridge."); return; }
            var type = ctx.Request.ContentType ?? "";
            if (!type.StartsWith("application/json", StringComparison.OrdinalIgnoreCase))
            {
                await Refuse(ctx, 415, "Send JSON.");
                return;
            }
        }
        else if (!HttpMethods.IsGet(ctx.Request.Method))
        {
            await Refuse(ctx, 405, "Method not allowed.");
            return;
        }

        try
        {
            await next();
        }
        catch (BadHttpRequestException ex)
        {
            if (!res.HasStarted) await Refuse(ctx, ex.StatusCode, "The request could not be read.");
        }
    }

    private static Task Refuse(HttpContext ctx, int status, string error)
    {
        ctx.Response.StatusCode = status;
        return ctx.Response.WriteAsJsonAsync(new { error });
    }
}
