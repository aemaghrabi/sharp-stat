using Potentiostat.Web.Models.Dtos;

namespace Potentiostat.Web.Hubs;

public interface IAcquisitionClient
{
    Task SampleReceived(SampleDto sample);

    Task ProgressChanged(TestProgressDto progress);

    Task LogEntry(LogEntryDto entry);

    Task StatusChanged(DeviceStatusDto status);

    Task TestCompleted(TestCompletedDto result);
}
