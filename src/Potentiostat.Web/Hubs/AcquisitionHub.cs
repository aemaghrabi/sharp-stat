using Microsoft.AspNetCore.SignalR;

namespace Potentiostat.Web.Hubs;

/// <summary>
/// Push-only hub: the server broadcasts sample/progress/log/status events to every connected
/// browser tab. There are no client-invokable methods — connect/start/stop go through the
/// ordinary MVC JSON endpoints instead, which keeps them independently testable.
/// </summary>
public sealed class AcquisitionHub : Hub<IAcquisitionClient>
{
}
