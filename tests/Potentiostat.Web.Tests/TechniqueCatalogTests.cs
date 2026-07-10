using System.Text.Json.Nodes;
using Potentiostat.Web.Services;

namespace Potentiostat.Web.Tests;

public class TechniqueCatalogTests
{
    private const double Tolerance = 1e-9;

    [Fact]
    public void FirmwareTestName_MapsAllSixKeys()
    {
        Assert.Equal("constant", TechniqueCatalog.FirmwareTestName("cv"));
        Assert.Equal("chronoamp", TechniqueCatalog.FirmwareTestName("ca"));
        Assert.Equal("cyclic", TechniqueCatalog.FirmwareTestName("cyclic"));
        Assert.Equal("linearSweep", TechniqueCatalog.FirmwareTestName("ls"));
        Assert.Equal("sinusoid", TechniqueCatalog.FirmwareTestName("sine"));
        Assert.Equal("squareWave", TechniqueCatalog.FirmwareTestName("square"));
    }

    [Fact]
    public void ToFirmwareParam_Constant_ConvertsDurationSecondsToMs()
    {
        var fields = new JsonObject { ["value"] = 1.0, ["duration"] = 5.0 };

        var param = TechniqueCatalog.ToFirmwareParam("cv", fields, quietTimeSeconds: 1.0, quietValueVolts: 0.0);

        Assert.Equal(1.0, param["value"]!.GetValue<double>(), Tolerance);
        Assert.Equal(5000, param["duration"]!.GetValue<int>());
        Assert.Equal(1000, param["quietTime"]!.GetValue<int>());
        Assert.Equal(0.0, param["quietValue"]!.GetValue<double>(), Tolerance);
    }

    [Fact]
    public void ToFirmwareParam_Chronoamp_PacksTwoStepsIntoArray()
    {
        var fields = new JsonObject
        {
            ["step1Duration"] = 5.0,
            ["step1Value"] = 0.3,
            ["step2Duration"] = 5.0,
            ["step2Value"] = -0.3,
        };

        var param = TechniqueCatalog.ToFirmwareParam("ca", fields, quietTimeSeconds: 2.0, quietValueVolts: 0.0);

        var step = param["step"]!.AsArray();
        Assert.Equal(2, step.Count);
        Assert.Equal(5000, step[0]![0]!.GetValue<int>());
        Assert.Equal(0.3, step[0]![1]!.GetValue<double>(), Tolerance);
        Assert.Equal(5000, step[1]![0]!.GetValue<int>());
        Assert.Equal(-0.3, step[1]![1]!.GetValue<double>(), Tolerance);
    }

    [Fact]
    public void ToFirmwareParam_Cyclic_PassesShiftThroughUnchanged()
    {
        var fields = new JsonObject
        {
            ["amplitude"] = 0.5,
            ["offset"] = 0.0,
            ["period"] = 1.0,
            ["numCycles"] = 3.0,
            ["shift"] = 0.5,
        };

        var param = TechniqueCatalog.ToFirmwareParam("cyclic", fields, quietTimeSeconds: 0.5, quietValueVolts: 0.0);

        Assert.Equal(0.5, param["amplitude"]!.GetValue<double>(), Tolerance);
        Assert.Equal(0.0, param["offset"]!.GetValue<double>(), Tolerance);
        Assert.Equal(1000, param["period"]!.GetValue<int>());
        Assert.Equal(3, param["numCycles"]!.GetValue<int>());
        Assert.Equal(0.5, param["shift"]!.GetValue<double>(), Tolerance);
        Assert.Equal(500, param["quietTime"]!.GetValue<int>());
    }

    [Fact]
    public void ToFirmwareParam_LinearSweep_ConvertsDurationSecondsToMs()
    {
        var fields = new JsonObject { ["startValue"] = -0.5, ["finalValue"] = 0.5, ["duration"] = 2.0 };

        var param = TechniqueCatalog.ToFirmwareParam("ls", fields, quietTimeSeconds: 0.0, quietValueVolts: 0.0);

        Assert.Equal(-0.5, param["startValue"]!.GetValue<double>(), Tolerance);
        Assert.Equal(0.5, param["finalValue"]!.GetValue<double>(), Tolerance);
        Assert.Equal(2000, param["duration"]!.GetValue<int>());
    }

    [Fact]
    public void ToFirmwareParam_SquareWave_PassesWindowFractionThroughUnchanged()
    {
        var fields = new JsonObject
        {
            ["amplitude"] = 0.1,
            ["startValue"] = -0.4,
            ["finalValue"] = 0.2,
            ["stepValue"] = 0.005,
            ["window"] = 0.2,
        };

        var param = TechniqueCatalog.ToFirmwareParam("square", fields, quietTimeSeconds: 0.5, quietValueVolts: 0.4);

        Assert.Equal(0.2, param["window"]!.GetValue<double>(), Tolerance);
        Assert.Equal(0.4, param["quietValue"]!.GetValue<double>(), Tolerance);
    }

    [Theory]
    [InlineData("cyclic")]
    [InlineData("ls")]
    [InlineData("sine")]
    public void ToUiFields_RoundTripsThroughToFirmwareParam(string key)
    {
        var original = key switch
        {
            "cyclic" or "sine" => new JsonObject
            {
                ["amplitude"] = 0.5,
                ["offset"] = 0.1,
                ["period"] = 1.5,
                ["numCycles"] = 4.0,
                ["shift"] = 0.25,
            },
            "ls" => new JsonObject { ["startValue"] = -0.5, ["finalValue"] = 0.5, ["duration"] = 2.0 },
            _ => throw new ArgumentOutOfRangeException(nameof(key)),
        };

        var firmwareParam = TechniqueCatalog.ToFirmwareParam(key, original, quietTimeSeconds: 1.0, quietValueVolts: 0.0);
        var roundTripped = TechniqueCatalog.ToUiFields(key, firmwareParam);

        foreach (var (fieldName, value) in original)
        {
            Assert.Equal(value!.GetValue<double>(), roundTripped[fieldName]!.GetValue<double>(), Tolerance);
        }
    }

    [Fact]
    public void ToUiFields_Chronoamp_UnpacksStepArrayBackIntoFlatFields()
    {
        var firmwareParam = new JsonObject
        {
            ["quietValue"] = 0.0,
            ["quietTime"] = 2000,
            ["step"] = new JsonArray(
                new JsonArray(5000, 0.3),
                new JsonArray(5000, -0.3)),
        };

        var fields = TechniqueCatalog.ToUiFields("ca", firmwareParam);

        Assert.Equal(5.0, fields["step1Duration"]!.GetValue<double>(), Tolerance);
        Assert.Equal(0.3, fields["step1Value"]!.GetValue<double>(), Tolerance);
        Assert.Equal(5.0, fields["step2Duration"]!.GetValue<double>(), Tolerance);
        Assert.Equal(-0.3, fields["step2Value"]!.GetValue<double>(), Tolerance);
    }

    [Fact]
    public void UiQuietTimeSeconds_ConvertsMillisecondsToSeconds()
    {
        var param = new JsonObject { ["quietTime"] = 1500 };

        Assert.Equal(1.5, TechniqueCatalog.UiQuietTimeSeconds(param), Tolerance);
    }
}
