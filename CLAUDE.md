# CLAUDE.md — Rodeostat C# Driver

C# port of the Python driver in `../python/potentiostat` for the IO Rodeo
Rodeostat open source potentiostat. The original plan for the port is in
[PLAN.md](PLAN.md); user-facing docs and API examples are in [README.md](README.md).

## Build, test, run

```
dotnet build                                              # whole solution
dotnet test                                               # 21 xUnit tests, no hardware needed
dotnet run --project examples/Potentiostat.Demo -- COM4 cyclic data.csv
```

Target is net8.0 (builds fine on newer SDKs). Library dependencies:
`System.IO.Ports` (NuGet) + built-in `System.Text.Json`.

## Layout

- `src/Potentiostat` — **deprecated**, kept for reference/rollback only; no
  longer referenced by `Potentiostat.Demo` or `Potentiostat.Web` (see below).
  Namespace `IoRodeo.Potentiostat`.
  - `Potentiostat.cs` — main device class: async command methods + `RunTestAsync` streaming loop
  - `SerialJsonTransport.cs` — line-based serial I/O (115200 baud, DTR/RTS asserted)
  - `ISerialTransport.cs` — transport interface, implemented by the fake in tests
  - `Protocol/` — command/JSON-key string constants, `Sample`/`TestProgress` DTOs
  - `Ranges.cs` — volt/current range constants + hardware-variant lookup tables
  - `TestResult.cs`, `Exceptions.cs`, `Helpers/CsvSampleWriter.cs`
- `examples/Potentiostat.Demo` — console demo (device info, progress bar, CSV)
- `tests/Potentiostat.Tests` — xUnit tests against `FakeTransport` (in-memory
  scripted device); still tests the deprecated `src/Potentiostat` library,
  unchanged by the driver switch below

`Potentiostat.Demo` and `Potentiostat.Web` now build against the external
`SharpStatDriver` project (`IoRodeo.SharpStatDriver` namespace) via a
cross-repo `ProjectReference` into a sibling repo at
`D:\EJUST\potentiostat\software\SharpStatDriver\src\SharpStatDriver`, not
`src/Potentiostat` in this repo. `SharpStatDriver` is an API-compatible port of
`src/Potentiostat` (same class/method shapes, different namespace) — the
invariants, conventions, and wire protocol documented below apply equally to
it.

## Wire protocol (shared with the Python driver and firmware)

Newline-delimited JSON at 115200 baud. Command: `{"command":"getVolt"}\n`.
Response: `{"success":true,"response":{"command":"getVolt","v":1.25}}`.
While a test runs the device streams one sample per line
(`{"t":ms,"v":volts,"i":uA}`, plus `"n"` mux channel and `"le"` limit error);
a line **without** the `t`/`v`/`i` keys is the end-of-test terminator.

## Invariants — do not break

- **64-byte write workaround** (`SerialJsonTransport.ApplyUsbSerialWorkaround`):
  outgoing messages whose byte length (terminator included) is a multiple of 64
  get a leading space, dodging an Adafruit ArduinoCore-samd USB serial bug.
  Removing it breaks communication for those message lengths.
- **Ordinal string version comparisons** (firmware mux gate `>= "0.0.5"`,
  hardware gate `>= "HW0.2"`), matching the Python driver. Real devices report
  quirky values that only pass under ordinal compare: firmware `FW0.0.9`
  (`'F' > '0'`) and hardware `V0.2` (`'V' > 'H'`). Do not "fix" this with
  semantic version parsing.
- `ConnectAsync` must drain stale serial input before the first command, and
  caches `HardwareVariant`/`FirmwareVersion`/`HardwareVersion`; the range
  lookups and hardware guards read those cached values.
- `getHardwareVersion` fails on pre-0.2 firmware; the driver falls back to
  `"HW0.1 (default)"` rather than throwing.
- Library stays UI-agnostic: no console output, no file writing in
  `src/Potentiostat` (CSV export lives in `Helpers/CsvSampleWriter` and is
  caller-opt-in via the `SampleReceived` event).

## Conventions

- Public API is async-first: `...Async` methods returning `Task`, all taking an
  optional `CancellationToken`. Times exposed in seconds (`Sample.TimeMs` keeps
  the raw device value).
- Test parameters (`GetParamAsync`/`SetParamAsync`) are firmware-defined
  free-form JSON — passed as `JsonObject`/`JsonNode`, deliberately untyped.
- Errors from the device map to the `PotentiostatException` hierarchy in
  `Exceptions.cs`; invalid caller arguments use `ArgumentException`.
- New protocol behavior gets a test against `FakeTransport` (scripted via its
  `Responder` callback) — hardware is never required for `dotnet test`.

## Hardware testing

The development machine usually has a Rodeostat on **COM4** (Adafruit USB
device, VID 239A): variant `10V_10MilliAmpV0.2`, firmware `FW0.0.9`. COM1 is a
motherboard port and COM3/COM6 are Bluetooth links — don't probe those. The
demo app doubles as an end-to-end smoke test; a short cyclic run is
`quietTime:500, period:1000, numCycles:2` → 250 samples at the default 10 ms
sample period.
