using Microsoft.AspNetCore.Mvc;
using Potentiostat.Web.Models.Dtos;
using Potentiostat.Web.Services;

namespace Potentiostat.Web.Controllers;

[Route("api/device")]
public sealed class DeviceController : ApiControllerBase
{
    private readonly IPotentiostatSessionService _session;

    public DeviceController(IPotentiostatSessionService session)
    {
        _session = session;
    }

    [HttpGet("ports")]
    public ActionResult<IReadOnlyList<PortInfoDto>> ListPorts() => Ok(_session.ListPorts());

    [HttpPost("connect")]
    public Task<IActionResult> Connect([FromBody] ConnectRequest request, CancellationToken ct) =>
        ExecuteAsync(async () =>
        {
            var status = await _session.ConnectAsync(request.PortName, ct);
            return Ok(status);
        });

    [HttpPost("disconnect")]
    public Task<IActionResult> Disconnect() =>
        ExecuteAsync(async () =>
        {
            await _session.DisconnectAsync();
            return NoContent();
        });

    [HttpGet("status")]
    public ActionResult<DeviceStatusDto> Status() => Ok(_session.GetStatus());
}
