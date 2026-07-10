using System.Text.Json.Nodes;

namespace Potentiostat.Web.Models.Dtos;

/// <summary>
/// Fields holds the technique-specific parameters using firmware-native field names/units
/// (seconds for time fields, converted to ms by TechniqueCatalog.ToFirmwareParam), e.g. for
/// "cyclic": amplitude, offset, period, numCycles, shift.
/// </summary>
public sealed record StartTestRequest(
    string TechniqueKey,
    JsonObject Fields,
    string CurrRange,
    double SampleRateHz,
    double QuietTimeSeconds,
    double QuietValueVolts);
