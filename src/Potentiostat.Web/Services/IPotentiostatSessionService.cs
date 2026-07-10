using Potentiostat.Web.Models.Dtos;

namespace Potentiostat.Web.Services;

public interface IPotentiostatSessionService : IAsyncDisposable
{
    IReadOnlyList<PortInfoDto> ListPorts();

    Task<DeviceStatusDto> ConnectAsync(string portName, CancellationToken ct);

    Task DisconnectAsync();

    DeviceStatusDto GetStatus();

    Task<TechniqueCatalogDto> GetCatalogAsync(CancellationToken ct);

    Task<TechniqueDefaultsDto> GetDefaultsAsync(string techniqueKey, CancellationToken ct);

    Task StartTestAsync(StartTestRequest request, CancellationToken ct);

    Task StopTestAsync();
}
