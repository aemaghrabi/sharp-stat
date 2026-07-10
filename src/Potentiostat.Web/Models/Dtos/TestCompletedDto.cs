namespace Potentiostat.Web.Models.Dtos;

public sealed record TestCompletedDto(int SampleCount, bool LimitError, bool Cancelled, string? ErrorMessage);
