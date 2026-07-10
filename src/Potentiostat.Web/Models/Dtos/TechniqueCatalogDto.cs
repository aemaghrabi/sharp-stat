namespace Potentiostat.Web.Models.Dtos;

public sealed record TechniqueCatalogDto(
    IReadOnlyList<string> AvailableTechniqueKeys,
    IReadOnlyList<string> VoltRanges,
    IReadOnlyList<string> CurrRanges);
