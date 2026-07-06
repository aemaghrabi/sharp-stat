# Potentiostat (C#)

C# port of the Python driver for the [IO Rodeo Rodeostat](https://iorodeo.com/)
open source potentiostat (`software/python/potentiostat`). Targets .NET 8 and
communicates with the device over newline-delimited JSON at 115200 baud using
`System.IO.Ports`.

## Layout

- `src/Potentiostat` — the driver library (`IoRodeo.Potentiostat` namespace)
- `examples/Potentiostat.Demo` — console demo: prints device info, runs a test
  with a progress bar, optionally writes a CSV
- `tests/Potentiostat.Tests` — xUnit protocol tests against an in-memory fake
  transport (no hardware needed)

## Usage

```csharp
using IoRodeo.Potentiostat;
using System.Text.Json.Nodes;

await using var pstat = new Potentiostat("COM3");
await pstat.ConnectAsync();

Console.WriteLine(pstat.HardwareVariant);   // e.g. 10V_microAmpV0.2
await pstat.SetCurrRangeAsync(CurrRanges.Range100uA);

var param = new JsonObject
{
    ["quietValue"] = 0.0,
    ["quietTime"] = 1000,
    ["amplitude"] = 1.0,
    ["offset"] = 0.0,
    ["period"] = 2000,
    ["numCycles"] = 3,
    ["shift"] = 0.0,
};

pstat.SampleReceived += (_, e) =>
    Console.WriteLine($"{e.Sample.TimeSeconds:0.000} s  {e.Sample.Volt:0.0000} V  {e.Sample.Curr:0.0000} uA");

var result = await pstat.RunTestAsync("cyclic", param);
// result.Times (s), result.Volts (V), result.Currents (uA)
```

Run the demo:

```
dotnet run --project examples/Potentiostat.Demo -- COM3 cyclic data.csv
```

Build and test:

```
dotnet build
dotnet test
```

## Differences from the Python driver

- Async-first API: every device call is a `Task`-returning `...Async` method
  with `CancellationToken` support. Cancelling `RunTestAsync` sends `stopTest`
  to the device and drains the stream before throwing.
- Times are always returned in seconds (the Python `timeunit` option is gone;
  raw milliseconds are on each `Sample`).
- Streaming output is exposed via the `SampleReceived` event and
  `IProgress<TestProgress>` instead of callbacks/console printing; CSV writing
  is an opt-in helper (`CsvSampleWriter`) rather than built into `RunTest`.
  Pickle output has no equivalent.
- The 64-byte USB serial workaround for the Adafruit SAMD core bug is
  preserved (`SerialJsonTransport.ApplyUsbSerialWorkaround`).
