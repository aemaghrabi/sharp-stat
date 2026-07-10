namespace Potentiostat.Web.Models.Dtos;

public sealed record SampleDto(int Channel, double TimeSeconds, double Volt, double Curr, bool LimitError);
