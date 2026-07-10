namespace Potentiostat.Web.Models.Dtos;

public sealed record LogEntryDto(DateTimeOffset Timestamp, string Level, string Message)
{
    public static LogEntryDto Info(string message) => new(DateTimeOffset.Now, "info", message);

    public static LogEntryDto Warn(string message) => new(DateTimeOffset.Now, "warn", message);

    public static LogEntryDto Error(string message) => new(DateTimeOffset.Now, "error", message);

    public static LogEntryDto Error(Exception ex) => new(DateTimeOffset.Now, "error", ex.Message);
}
