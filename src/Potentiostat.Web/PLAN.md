# Plan: Potentiostat.Web — self-hosted ASP.NET Core MVC GUI

## Context

The C# driver (`src/Potentiostat`) is a deliberately UI-agnostic library — connect, configure, and stream a Rodeostat potentiostat over serial, with no console output or file I/O baked in (see CLAUDE.md invariants). So far it's only been exercised by a console demo. The goal now is a real operator-facing tool: a self-contained Windows `.exe` that anyone can double-click, which opens a browser GUI to connect to the device, configure one of six voltammetry techniques, run a live acquisition with three interactive charts, and export the results — no dev tools or manual setup required.

A design mock (`Potentiostat Control GUI.dc.html`, pulled from the linked claude.ai/design project, and also present locally as `src/Potentiostat/Potentiostat Control GUI-handoff.zip`) defines the exact visual layout and interaction model: a 352px sidebar (connection, technique, parameters, acquisition controls, event log) plus a main area with three hand-built interactive SVG charts (zoom/pan/hover/PNG export). It's a React-flavored prototype with simulated data, not real code — the interaction logic ports cleanly to vanilla JS since there's no framework-specific state magic involved, just DOM/SVG manipulation.

**Key decision**: the mock's Cyclic/Linear Sweep/Chronoamperometry/Sinusoidal parameter fields don't match the real firmware's parameter shape (e.g. mock's cyclic uses Min/Max Value + Scan Rate; firmware wants Amplitude/Offset/Period/Shift, confirmed against the Python driver's `docs/tests.rst`). Per your direction, **the UI will show the firmware's native field names/units directly** rather than the mock's reparametrized fields — this eliminates an entire class of physics-conversion bugs (there is no formula that could be wrong, because there's no formula). Only trivial, non-lossy unit conversions remain (seconds↔milliseconds for time fields, for readability), no different in kind from what the mock already did for Quiet Time.

**Boundary**: this project (`src/Potentiostat.Web`) is a pure consumer of `src/Potentiostat` via `ProjectReference`. All implementation work happens inside `src/Potentiostat.Web` (and its matching `tests/Potentiostat.Web.Tests`) plus the one-line addition of both to `Potentiostat.sln` — nothing under `src/Potentiostat` is modified.

## Verified ground truth (checked directly, not assumed)

- `Potentiostat(string portName, TimeSpan? timeout = null)`, `RunTestAsync(string testName, JsonNode? param, IProgress<TestProgress>? progress, int? maxDecodeErrors, CancellationToken ct)` — confirmed at `src/Potentiostat/Potentiostat.cs:22` and `:449`. **`RunTestAsync` blocks for the entire test duration** (it *is* the streaming loop, not a "start" call) — the web layer must run it on a background `Task`, never awaited inline in a controller action.
- `SampleReceived` event, `Sample(Channel, TimeMs, TimeSeconds, Volt, Curr, LimitError)`, `TestProgress(ElapsedSeconds, TotalSeconds, Fraction)` — plain POCOs, serialize cleanly for SignalR.
- `GetAllVoltRanges()`/`GetAllCurrRanges()` — synchronous, keyed on live `HardwareVariant` after connect; **do not** hardcode range lists (the mock's `10/100/1000/10000 µA` dropdown happens to match the dev machine's `10V_10MilliAmpV0.2` variant but isn't general).
- `GetTestNamesAsync()` — firmware-reported test names; use to filter which of the six techniques the connected device actually supports.
- Exception hierarchy confirmed in `src/Potentiostat/Exceptions.cs`: `PotentiostatException` → `CommandFailedException`, `CommandMismatchException`, `DataDecodeException`, `HardwareVersionException`; plus bare `ArgumentException`, `TimeoutException` (not in the hierarchy — catch separately), `OperationCanceledException`.
- Firmware test names & native parameter shapes, confirmed against the Python driver's example scripts **and** `docs/tests.rst`:

  | UI technique | firmware `testName` | native params (unit) |
  |---|---|---|
  | Constant Voltage | `constant` | `value` (V), `duration` (ms) |
  | Chronoamperometry | `chronoamp` | `step`: exactly 2× `[duration_ms, value_V]` pairs |
  | Cyclic Voltammetry | `cyclic` | `amplitude`, `offset` (V), `period` (ms), `numCycles`, `shift` — **unitless fraction [0,1]**, 0 = start at minimum, 0.5 = start at maximum (`tests.rst:62-68`) |
  | Linear Sweep | `linearSweep` | `startValue`, `finalValue` (V), `duration` (ms) |
  | Sinusoidal | `sinusoid` | `amplitude`, `offset` (V), `period` (ms), `numCycles`, `shift` (same [0,1] fraction convention, `tests.rst:206-224`) |
  | Square Wave | `squareWave` | `amplitude`, `startValue`, `finalValue`, `stepValue` (V), `window` — [0,1] fraction of half-cycle (`tests.rst:239-249`) |

  All techniques also take common `quietValue` (V) / `quietTime` (ms). Since these are firmware/Python-driver conventions rather than a guaranteed hardware contract, seed real defaults live via `GetParamAsync(testName)` after connect rather than hardcoding numbers, and restrict the technique dropdown to `GetTestNamesAsync() ∩ {six known keys}`.
- `CsvSampleWriter` writes directly to a filesystem path — not reused for the web app; CSV export is done client-side from the JS-accumulated sample array (mirrors the mock, needs no server round-trip).

## Architecture

### Project layout: `src/Potentiostat.Web/`

```
src/Potentiostat.Web/
  PLAN.md                         (this file)
  Potentiostat.Web.csproj         (Sdk.Web, net8.0, ProjectReference → ../Potentiostat/Potentiostat.csproj)
  Program.cs                      (Kestrel host, port-0 bind, auto-launch browser, DI)
  Controllers/
    HomeController.cs             (single Index view)
    DeviceController.cs           (ports, connect, disconnect, status)
    TechniqueController.cs        (catalog, default-params per technique)
    AcquisitionController.cs      (start, stop, state)
  Hubs/
    AcquisitionHub.cs             (push-only; no client-invokable RPC needed)
    IAcquisitionClient.cs         (SampleReceived, ProgressChanged, LogEntry, StatusChanged, TestCompleted)
  Services/
    IPotentiostatSessionService.cs / PotentiostatSessionService.cs   (singleton, owns the one Potentiostat instance)
    TechniqueCatalog.cs            (UI-key → firmware testName map, param field metadata per technique)
  Models/Dtos/
    SampleDto, TestProgressDto, LogEntryDto, DeviceStatusDto, TestCompletedDto,
    TechniqueCatalogDto, PortInfoDto, StartTestRequest
  Views/Home/Index.cshtml          (ports the mock's layout; dynamic content is client-driven, no Razor model binding needed)
  wwwroot/
    css/site.css                  (ported mock styles + local @font-face for IBM Plex)
    fonts/ibm-plex/*.woff2        (vendored — offline requirement, no Google Fonts CDN)
    lib/signalr/signalr.min.js    (vendored from the Microsoft.AspNetCore.SignalR.Client package — no CDN, no npm build step)
    js/app.js                     (SignalR wiring, fetch() calls to controllers, DOM updates)
    js/chart.js                   (ported SVG zoom/pan/hover/PNG-export module)
    js/csv-export.js              (ported client-side CSV blob download)

tests/Potentiostat.Web.Tests/
  Potentiostat.Web.Tests.csproj
  TechniqueCatalogTests.cs         (unit conversion + step-array packing tests — no hardware needed)
```

Add both new projects to `Potentiostat.sln` via `dotnet sln add`, matching the existing project layout pattern. This is the only touch point outside `src/Potentiostat.Web`/`tests/Potentiostat.Web.Tests` — `src/Potentiostat` itself is never edited.

### Service/session layer (`PotentiostatSessionService`)

Singleton — there is exactly one physical serial device, so this is process-scoped, not per-request. Holds `Potentiostat? _device`, a `SemaphoreSlim _gate` guarding connect/disconnect/start/stop **state transitions**, and the currently-running `CancellationTokenSource`/`Task` for an in-progress `RunTestAsync`.

- `ConnectAsync(portName)` — refuses if a test is running; `new Potentiostat(portName)` → `ConnectAsync()` → cache `HardwareVariant`/`FirmwareVersion`/`HardwareVersion` → broadcast `StatusChanged`.
- `StartTestAsync(request)` — refuses if already connected==false or already running (409-mapped); resolves UI technique key → firmware `testName` via `TechniqueCatalog`; packs the request's native-named fields into a `JsonObject` (chronoamp's two step fields become the `step` array — this is array-packing, not a physics formula, so it's mechanical and safe); subscribes `SampleReceived` → `hub.Clients.All.SampleReceived(...)`; kicks off `Task.Run(() => _device.RunTestAsync(testName, param, progress, cancellationToken: cts.Token))` — **not awaited inline**, so the HTTP call returns immediately (202 Accepted) while the run streams via SignalR. `finally` unsubscribes the event handler and broadcasts `StatusChanged`/`TestCompleted`.
- `StopTestAsync()` — cancels the run's `CancellationTokenSource` and returns immediately; the background task's own `finally` (after `RunTestAsync`'s internal drain-then-throw) broadcasts completion. The UI should show a brief "Stopping…" state between the Stop click and the `TestCompleted` event, since the drain isn't instantaneous.
- No server-side sample buffering — the service is a pure forwarder; CSV/export lives entirely client-side against the browser's accumulated array, keeping server memory flat regardless of run length.
- `IAsyncDisposable` on the service (registered against `IHostApplicationLifetime.ApplicationStopping`) cancels any active run and disposes `_device`, mirroring the demo app's `await using` pattern.

### Real-time transport: SignalR

One-way server→client push (sample/progress/log/status), so a plain `Hub<IAcquisitionClient>` with **no client-invokable methods** is enough — control actions (connect/start/stop/etc.) stay ordinary MVC JSON endpoints, easy to test independently of the socket. `signalr.min.js` is vendored into `wwwroot/lib/` (pulled from the `Microsoft.AspNetCore.SignalR.Client` NuGet package's `dist/browser/` output) rather than referenced from a CDN, since the whole point of the exe is running with no network dependency.

### Controller surface

```
GET  /                                    → Index view
GET  /api/device/ports                    → PortInfoDto[]                (SerialPort.GetPortNames())
POST /api/device/connect   {portName}     → DeviceStatusDto
POST /api/device/disconnect               → 204
GET  /api/device/status                   → DeviceStatusDto              (resync on page load/reconnect)

GET  /api/technique/catalog               → TechniqueCatalogDto          (six keys ∩ GetTestNamesAsync(), + volt/curr ranges)
GET  /api/technique/{key}/default-params  → JsonObject                   (live GetParamAsync(firmwareName), ms→s display conversion only)

POST /api/acquisition/start  StartTestRequest → 202 Accepted / 409 if already running
POST /api/acquisition/stop                    → 202 Accepted
GET  /api/acquisition/state                   → { running, elapsedSeconds, totalSeconds }   (poll fallback)
```

### Frontend

- `Views/Home/Index.cshtml` ports the mock's inline-styled flex layout near-verbatim — it's already plain HTML with no framework dependency, so it's mostly a direct port with `{{ }}` placeholders replaced by empty elements that `app.js` fills in after SignalR/fetch calls resolve. Two intentional additions beyond the mock: a live Serial Port list (mock hardcoded COM1–6) and a live Current Range list (mock hardcoded 4 values) — both populated from the endpoints above — plus a device-info line (variant/firmware/hardware version) in the Connection card, since the mock didn't show one and requirement 3 asks for it.
- **Parameter cards use firmware-native fields** per your decision: Cyclic/Sinusoidal show Amplitude (V), Offset (V), Period (s, converted ×1000 to ms on submit), Cycles, Shift (0–1, with inline help text "0 = start at minimum, 0.5 = start at maximum"); Linear Sweep shows Start/Final Value (V) and Duration (s→ms); Chronoamperometry keeps the mock's Step 1/Step 2 Duration+Value fields (packed into the `step` array — mechanical, not a formula); Square Wave keeps the mock's fields with `sampleWindow` relabeled `Window (0–1)` to match firmware naming. This removes the need for any inverse-formula "UI-shape" mapping — `GET .../default-params` only does the trivial ms→s conversion before returning, and unit tests only need to cover that conversion and the chronoamp array packing, not reparametrization math.
- `js/chart.js` — a `SvgChart` class per chart (`tv`, `ti`, `vi`) porting the mock's `buildChart`/wheel-zoom/drag-pan/hover-crosshair/`exportPNG` functions, adapted from React `setState` re-render to plain `_render()` calls triggered directly by SignalR's `SampleReceived` handler appending to one shared `{t,v,i}` array in `app.js`. Each chart is independently zoomable/pannable (satisfies "flexibility to control the graph and change axis resolution"); PNG export ports the mock's SVG→canvas→blob→download flow unchanged.
- `js/csv-export.js` — near-verbatim port of the mock's `exportCSV()`, downloading the same in-memory sample array as a `time_s,voltage_V,current_uA` CSV — satisfies the "downloadable CSV" requirement with no server involvement.
- Fonts: vendor IBM Plex Sans/Mono `.woff2` files locally (SIL OFL, redistributable) into `wwwroot/fonts/` with a local `@font-face` block, replacing the mock's Google Fonts `<link>` — keeps the exe fully offline-capable.

### Error handling

`PotentiostatException` subtypes map to 4xx/5xx JSON error responses on the synchronous endpoints (connect, etc.); errors that occur *inside* the long-running `RunTestAsync` background task (any exception, `DataDecodeException`, device-side `TimeoutException`) are caught in that task's own try/catch and surfaced via the `LogEntry` + `TestCompleted{ErrorMessage=...}` hub events instead of an HTTP status, since there's no open request to respond to by the time they happen. `OperationCanceledException` from a user-initiated Stop is the expected happy path, not an error (`TestCompleted{Cancelled:true}`, neutral log styling).

### Packaging

```
dotnet publish src/Potentiostat.Web -c Release -r win-x64 --self-contained true `
  -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -p:EnableCompressionInSingleFile=true -o publish/
```
`Program.cs` binds Kestrel to `http://127.0.0.1:0` (OS picks a free port — avoids "port in use" failures with no config UI) and launches the default browser via `Process.Start` against the resolved URL once `ApplicationStarted` fires.

**Note**: `PublishSingleFile` bundles managed assemblies into the one `.exe`, but `wwwroot/` and `appsettings.json` remain as loose files beside it — this is normal ASP.NET Core single-file behavior. The deliverable is the `publish/` folder (one `.exe` + a small `wwwroot/` folder), zipped for distribution; the user still only ever double-clicks the `.exe`. (A fully embedded-resources approach for zero companion files is possible but adds real complexity for marginal benefit — not pursued unless you want it later.)

## Verification

1. `dotnet build` / `dotnet test` — confirm the existing 21 driver tests are untouched (the new project only adds a `ProjectReference`, never modifies `src/Potentiostat`).
2. New `tests/Potentiostat.Web.Tests`: unit tests for the seconds↔ms conversions and chronoamp's step-array packing (pure functions, no `Potentiostat`/`FakeTransport` dependency needed).
3. Manual end-to-end smoke test on the dev machine's COM4 device (`10V_10MilliAmpV0.2`, `FW0.0.9`, per CLAUDE.md):
   - Publish and run the `.exe` from a copied-elsewhere `publish/` folder (proves it's portable, not just "works on the build machine").
   - Confirm it auto-opens the browser with no manual URL entry.
   - Serial Port dropdown shows real enumerated ports (COM4 present); Connect → status turns green, device info line populates, Event Log logs it.
   - Select Cyclic Voltammetry; confirm Amplitude/Offset/Period/Shift fields populate from `GetParamAsync("cyclic")`, not hardcoded numbers.
   - Run a short cyclic test (`quietTime≈0.5s`, `period≈1000ms`, `numCycles=2`) — reproduces CLAUDE.md's documented ~250-sample smoke test shape at the default 10ms sample period.
   - Verify all three charts update live, progress bar/sample count advance, "ACQUIRING" pulses.
   - Stop mid-run — confirm the brief "Stopping…" state, then "stopped by user" log entry, charts retain partial data.
   - Export CSV — verify rows match the charted data.
   - Export PNG on each chart — verify visual match.
   - Independently zoom/pan each chart (scroll wheel, drag), confirm no cross-chart interference; double-click and "Reset View" both reset only that chart.
   - Run once with `shift=0.5` on the cyclic technique and visually confirm the trace starts at the maximum (not minimum) voltage, per `tests.rst`'s documented behavior — cheap confirmation now that shift is passed straight through with no invented conversion.

## Open items for you

- **CSV**: client-side only (matches the mock, zero server work) vs. also adding a server-side fallback for very long runs or a closed browser tab — plan defaults to client-side only; easy additive follow-up if you want the fallback.
- **Chart rendering at high sample rates**: the mock rebuilds the whole SVG path every sample; fine for the demo's data volumes, but worth revisiting (incremental path append) if the COM4 smoke test shows jank on long/high-rate runs — not blocking for the initial port.
- **Multiple browser tabs**: the hub broadcasts to all connected clients and there's one shared device session — fine for a single-operator local tool, flagging in case you want a "device busy" state for a second tab instead.
