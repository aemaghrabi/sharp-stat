using IoRodeo.SharpStatDriver;
using Microsoft.AspNetCore.Mvc;

namespace Potentiostat.Web.Controllers;

/// <summary>
/// Maps the driver's exception hierarchy (plus the framework exceptions it doesn't cover,
/// like TimeoutException) to HTTP status codes for the synchronous API endpoints. Errors
/// raised inside the long-running RunTestAsync background task are not routed through this —
/// they surface via the SignalR LogEntry/TestCompleted events instead, since there is no open
/// HTTP request to respond to by the time they happen.
/// </summary>
[ApiController]
public abstract class ApiControllerBase : ControllerBase
{
    protected async Task<IActionResult> ExecuteAsync(Func<Task<IActionResult>> action)
    {
        try
        {
            return await action();
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
        catch (HardwareVersionException ex)
        {
            return Conflict(new { error = ex.Message });
        }
        catch (InvalidOperationException ex)
        {
            return Conflict(new { error = ex.Message });
        }
        catch (PotentiostatException ex)
        {
            return StatusCode(StatusCodes.Status502BadGateway, new { error = ex.Message });
        }
        catch (TimeoutException ex)
        {
            return StatusCode(StatusCodes.Status504GatewayTimeout, new { error = ex.Message });
        }
        catch (Exception ex) when (ex is UnauthorizedAccessException or IOException)
        {
            // Most commonly: another process already has the serial port open, or the OS
            // denied access to it. Retryable from the user's point of view (close the other
            // app / unplug-replug), so this is a 409 like the other "try again" conditions
            // above rather than an unhandled-exception 500.
            return Conflict(new { error = $"Could not access the serial port: {ex.Message}" });
        }
    }
}
