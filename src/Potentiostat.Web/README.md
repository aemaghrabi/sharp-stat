# Potentiostat.Web — Potentiostat Console

Self-hosted ASP.NET Core GUI for the Rodeostat driver (`src/Potentiostat`). A
single `.exe` that opens a browser to connect to the device over serial,
configure one of six voltammetry techniques, run a live acquisition with
three interactive charts, and export the results — no dev tools required.

See the top-level [README.md](../../README.md) for the repo layout and the
driver library's own usage; see [PLAN.md](PLAN.md) for the original design
rationale.

## Run it

```
dotnet run --project src/Potentiostat.Web
```

`Program.cs` binds Kestrel to an OS-assigned free port (`http://127.0.0.1:0`)
and auto-launches the default browser once the app has started, so there's no
fixed URL to remember and no "port already in use" failures. The `http`
launch profile (`dotnet run`, no browser auto-launch, fixed port 5120) is
used for local development; the packaged `.exe` always uses the port-0 path
in `Program.cs`, not `launchSettings.json`.

## What it does

- **Connect** — lists serial ports (`GET /api/device/ports`), connects to one
  (`POST /api/device/connect`), and shows the device's hardware
  variant/firmware/hardware version once connected.
- **Configure** — six techniques (Constant Voltage, Chronoamperometry, Cyclic
  Voltammetry, Linear Sweep, Sinusoidal, Square Wave), restricted to whatever
  the connected device actually reports supporting. Parameter fields use the
  firmware's own native names and units (not a reparametrized UI shape) and
  are pre-populated with live defaults read off the device.
- **Acquire** — starts a run (`POST /api/acquisition/start`), which streams
  live samples to the browser over a SignalR hub (`/hubs/acquisition`) rather
  than HTTP polling. Three charts (voltage/time, current/time, voltage/current)
  update live and are independently zoomable/pannable, with per-chart PNG
  export.
- **Export** — CSV export is entirely client-side, downloading the
  browser-accumulated sample array — no server round-trip and no server-side
  buffering, so memory stays flat regardless of run length.

## Layout

```
Controllers/   DeviceController, TechniqueController, AcquisitionController (JSON endpoints), HomeController (single Index view)
Hubs/          AcquisitionHub — push-only SignalR hub (SampleReceived/ProgressChanged/LogEntry/StatusChanged/TestCompleted)
Services/      PotentiostatSessionService (singleton owning the one Potentiostat instance), TechniqueCatalog (UI-key <-> firmware testName + param mapping)
Models/Dtos/   Request/response shapes for the controllers and hub
Views/Home/    Index.cshtml — static shell; all dynamic content is filled in by wwwroot/js/app.js
wwwroot/       css/site.css, js/app.js (SignalR + fetch wiring), js/chart.js (SVG chart), lib/ (vendored SignalR client, Chart.js, Hammer.js — no CDN dependency)
```

## Endpoints

```
GET  /                                    Index view
GET  /api/device/ports                    PortInfoDto[]
POST /api/device/connect   {portName}     DeviceStatusDto
POST /api/device/disconnect               204
GET  /api/device/status                   DeviceStatusDto

GET  /api/technique/catalog               TechniqueCatalogDto
GET  /api/technique/{key}/default-params  live device defaults for that technique

POST /api/acquisition/start  StartTestRequest  202 Accepted (409 if already running)
POST /api/acquisition/stop                     202 Accepted
GET  /api/acquisition/state                    { running }
```

There is exactly one `Potentiostat` instance per running app (one physical
serial device), so the session service is a singleton, not per-request.
`RunTestAsync` blocks for the run's duration and is kicked off on a
background `Task` — the `start` call returns immediately and the run streams
over the SignalR hub instead.

## Build, test, package

```
dotnet build                              # whole solution
dotnet test                               # includes tests/Potentiostat.Web.Tests (no hardware needed)
```

Packaging a distributable Windows installer (self-contained win-x64 single
file + Inno Setup) is automated by [scripts/publish-release.ps1](../../scripts/publish-release.ps1):

```
scripts/publish-release.ps1 -Version 1.0.0
```

Requires the .NET 8 SDK and [Inno Setup 6](https://jrsoftware.org/isinfo.php)
(`ISCC.exe`); the .NET runtime itself is bundled into the published output,
so end users of the installer need neither. The Inno Setup script is
[installer/PotentiostatWeb.iss](../../installer/PotentiostatWeb.iss).
