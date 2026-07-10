using System.Text.Json.Nodes;

namespace Potentiostat.Web.Services;

/// <summary>
/// Maps the six UI technique keys to firmware test names and translates between the UI's
/// firmware-native parameter fields (time fields in seconds) and the firmware's own JSON
/// shape (time fields in ms, chronoamp's two steps packed into a "step" array). There is no
/// physics reparametrization here — every UI field is the same field the firmware expects,
/// modulo the seconds/milliseconds unit and the step-array packing, both of which are
/// mechanical and cannot be "wrong" the way a derived formula could be.
/// </summary>
public static class TechniqueCatalog
{
    private static readonly IReadOnlyDictionary<string, string> FirmwareNameByKey = new Dictionary<string, string>
    {
        ["cv"] = "constant",
        ["ca"] = "chronoamp",
        ["cyclic"] = "cyclic",
        ["ls"] = "linearSweep",
        ["sine"] = "sinusoid",
        ["square"] = "squareWave",
    };

    private static readonly IReadOnlyDictionary<string, string> DisplayLabelByKey = new Dictionary<string, string>
    {
        ["cv"] = "Constant Voltage",
        ["ca"] = "Chronoamperometry",
        ["cyclic"] = "Cyclic Voltammetry",
        ["ls"] = "Linear Sweep",
        ["sine"] = "Sinusoidal",
        ["square"] = "Square Wave",
    };

    public static IReadOnlyList<string> AllKeys { get; } = FirmwareNameByKey.Keys.ToArray();

    public static string FirmwareTestName(string techniqueKey) =>
        FirmwareNameByKey.TryGetValue(techniqueKey, out var name)
            ? name
            : throw new ArgumentException($"Unknown technique key '{techniqueKey}'.", nameof(techniqueKey));

    public static string DisplayLabel(string techniqueKey) =>
        DisplayLabelByKey.TryGetValue(techniqueKey, out var label)
            ? label
            : throw new ArgumentException($"Unknown technique key '{techniqueKey}'.", nameof(techniqueKey));

    public static string? TryGetKeyForFirmwareName(string firmwareTestName) =>
        FirmwareNameByKey.FirstOrDefault(kv => kv.Value == firmwareTestName).Key;

    private static int SecondsToMs(double seconds) => (int)Math.Round(seconds * 1000.0);

    private static double MsToSeconds(double ms) => ms / 1000.0;

    /// <summary>
    /// Reads a JSON number as a double regardless of the underlying CLR type it was stored
    /// as. Values parsed from the device's wire JSON (JsonElement-backed) coerce cleanly via
    /// GetValue&lt;double&gt;(), but JsonValue nodes built directly from a C# int (as
    /// ToFirmwareParam does for ms/cycle fields, matching the firmware's documented integer
    /// types) do not — GetValue&lt;T&gt;() requires an exact type match in that case.
    /// </summary>
    private static double AsDouble(JsonNode? node) => node switch
    {
        null => 0.0,
        JsonValue value when value.TryGetValue<double>(out var d) => d,
        JsonValue value when value.TryGetValue<int>(out var i) => i,
        JsonValue value when value.TryGetValue<long>(out var l) => l,
        _ => node.GetValue<double>(),
    };

    private static double RequireDouble(JsonObject fields, string field) =>
        fields.TryGetPropertyValue(field, out var node) && node is not null
            ? AsDouble(node)
            : throw new ArgumentException($"Missing required field '{field}'.", nameof(fields));

    /// <summary>
    /// Builds the firmware-shaped param object for RunTestAsync/SetParamAsync from the UI's
    /// firmware-native fields (time fields in seconds) plus the common quiet-period settings.
    /// </summary>
    public static JsonObject ToFirmwareParam(
        string techniqueKey,
        JsonObject fields,
        double quietTimeSeconds,
        double quietValueVolts)
    {
        var param = new JsonObject
        {
            ["quietValue"] = quietValueVolts,
            ["quietTime"] = SecondsToMs(quietTimeSeconds),
        };

        switch (techniqueKey)
        {
            case "cv":
                param["value"] = RequireDouble(fields, "value");
                param["duration"] = SecondsToMs(RequireDouble(fields, "duration"));
                break;

            case "ca":
                param["step"] = new JsonArray(
                    new JsonArray(SecondsToMs(RequireDouble(fields, "step1Duration")), RequireDouble(fields, "step1Value")),
                    new JsonArray(SecondsToMs(RequireDouble(fields, "step2Duration")), RequireDouble(fields, "step2Value")));
                break;

            case "cyclic":
            case "sine":
                param["amplitude"] = RequireDouble(fields, "amplitude");
                param["offset"] = RequireDouble(fields, "offset");
                param["period"] = SecondsToMs(RequireDouble(fields, "period"));
                param["numCycles"] = (int)RequireDouble(fields, "numCycles");
                param["shift"] = RequireDouble(fields, "shift");
                break;

            case "ls":
                param["startValue"] = RequireDouble(fields, "startValue");
                param["finalValue"] = RequireDouble(fields, "finalValue");
                param["duration"] = SecondsToMs(RequireDouble(fields, "duration"));
                break;

            case "square":
                param["amplitude"] = RequireDouble(fields, "amplitude");
                param["startValue"] = RequireDouble(fields, "startValue");
                param["finalValue"] = RequireDouble(fields, "finalValue");
                param["stepValue"] = RequireDouble(fields, "stepValue");
                param["window"] = RequireDouble(fields, "window");
                break;

            default:
                throw new ArgumentException($"Unknown technique key '{techniqueKey}'.", nameof(techniqueKey));
        }

        return param;
    }

    /// <summary>
    /// Inverse of <see cref="ToFirmwareParam"/>: converts a firmware-reported param object
    /// (e.g. from GetParamAsync) into the UI's field shape (time fields in seconds) for
    /// pre-populating the technique's parameter form with live device defaults.
    /// </summary>
    public static JsonObject ToUiFields(string techniqueKey, JsonObject firmwareParam)
    {
        var fields = new JsonObject();

        switch (techniqueKey)
        {
            case "cv":
                fields["value"] = AsDouble(firmwareParam["value"]);
                fields["duration"] = MsToSeconds(AsDouble(firmwareParam["duration"]));
                break;

            case "ca":
                var steps = firmwareParam["step"]?.AsArray();
                fields["step1Duration"] = MsToSeconds(AsDouble(steps?[0]?[0]));
                fields["step1Value"] = AsDouble(steps?[0]?[1]);
                fields["step2Duration"] = MsToSeconds(AsDouble(steps?[1]?[0]));
                fields["step2Value"] = AsDouble(steps?[1]?[1]);
                break;

            case "cyclic":
            case "sine":
                fields["amplitude"] = AsDouble(firmwareParam["amplitude"]);
                fields["offset"] = AsDouble(firmwareParam["offset"]);
                fields["period"] = MsToSeconds(AsDouble(firmwareParam["period"]));
                fields["numCycles"] = AsDouble(firmwareParam["numCycles"]);
                fields["shift"] = AsDouble(firmwareParam["shift"]);
                break;

            case "ls":
                fields["startValue"] = AsDouble(firmwareParam["startValue"]);
                fields["finalValue"] = AsDouble(firmwareParam["finalValue"]);
                fields["duration"] = MsToSeconds(AsDouble(firmwareParam["duration"]));
                break;

            case "square":
                fields["amplitude"] = AsDouble(firmwareParam["amplitude"]);
                fields["startValue"] = AsDouble(firmwareParam["startValue"]);
                fields["finalValue"] = AsDouble(firmwareParam["finalValue"]);
                fields["stepValue"] = AsDouble(firmwareParam["stepValue"]);
                fields["window"] = AsDouble(firmwareParam["window"]);
                break;

            default:
                throw new ArgumentException($"Unknown technique key '{techniqueKey}'.", nameof(techniqueKey));
        }

        return fields;
    }

    public static double UiQuietTimeSeconds(JsonObject firmwareParam) =>
        MsToSeconds(AsDouble(firmwareParam["quietTime"]));

    public static double UiQuietValueVolts(JsonObject firmwareParam) =>
        AsDouble(firmwareParam["quietValue"]);
}
