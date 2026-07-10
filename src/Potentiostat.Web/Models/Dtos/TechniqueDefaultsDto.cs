using System.Text.Json.Nodes;

namespace Potentiostat.Web.Models.Dtos;

/// <summary>
/// Live defaults for one technique's parameter form, seeded from the connected device's
/// GetParamAsync response (never hardcoded) so the UI reflects the actual firmware state.
/// </summary>
public sealed record TechniqueDefaultsDto(
    double QuietTimeSeconds,
    double QuietValueVolts,
    string CurrRange,
    double SampleRateHz,
    JsonObject Fields);
