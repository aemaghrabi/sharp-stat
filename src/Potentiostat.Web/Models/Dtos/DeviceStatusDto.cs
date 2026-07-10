namespace Potentiostat.Web.Models.Dtos;

public sealed record DeviceStatusDto(
    bool Connected,
    bool Connecting,
    bool TestRunning,
    string? PortName,
    string? HardwareVariant,
    string? FirmwareVersion,
    string? HardwareVersion)
{
    public static readonly DeviceStatusDto Disconnected = new(false, false, false, null, null, null, null);
}
