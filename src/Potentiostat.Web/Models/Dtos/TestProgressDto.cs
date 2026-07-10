namespace Potentiostat.Web.Models.Dtos;

public sealed record TestProgressDto(double ElapsedSeconds, double TotalSeconds, double Fraction);
