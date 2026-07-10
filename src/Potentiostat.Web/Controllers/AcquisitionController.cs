using Microsoft.AspNetCore.Mvc;
using Potentiostat.Web.Models.Dtos;
using Potentiostat.Web.Services;

namespace Potentiostat.Web.Controllers;

[Route("api/acquisition")]
public sealed class AcquisitionController : ApiControllerBase
{
    private readonly IPotentiostatSessionService _session;

    public AcquisitionController(IPotentiostatSessionService session)
    {
        _session = session;
    }

    [HttpPost("start")]
    public Task<IActionResult> Start([FromBody] StartTestRequest request, CancellationToken ct) =>
        ExecuteAsync(async () =>
        {
            await _session.StartTestAsync(request, ct);
            return Accepted();
        });

    [HttpPost("stop")]
    public Task<IActionResult> Stop() =>
        ExecuteAsync(async () =>
        {
            await _session.StopTestAsync();
            return Accepted();
        });

    [HttpGet("state")]
    public ActionResult State()
    {
        var status = _session.GetStatus();
        return Ok(new { running = status.TestRunning });
    }
}
