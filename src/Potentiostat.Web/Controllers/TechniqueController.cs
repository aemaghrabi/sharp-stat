using Microsoft.AspNetCore.Mvc;
using Potentiostat.Web.Services;

namespace Potentiostat.Web.Controllers;

[Route("api/technique")]
public sealed class TechniqueController : ApiControllerBase
{
    private readonly IPotentiostatSessionService _session;

    public TechniqueController(IPotentiostatSessionService session)
    {
        _session = session;
    }

    [HttpGet("catalog")]
    public Task<IActionResult> Catalog(CancellationToken ct) =>
        ExecuteAsync(async () => Ok(await _session.GetCatalogAsync(ct)));

    [HttpGet("{key}/default-params")]
    public Task<IActionResult> DefaultParams(string key, CancellationToken ct) =>
        ExecuteAsync(async () => Ok(await _session.GetDefaultsAsync(key, ct)));
}
