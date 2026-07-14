using System.IO.Ports;
using IoRodeo.SharpStatDriver;
using IoRodeo.SharpStatDriver.Protocol;
using IoRodeo.SharpStatDriver.Simulation;
using Microsoft.AspNetCore.SignalR;
using Potentiostat.Web.Hubs;
using Potentiostat.Web.Models.Dtos;

namespace Potentiostat.Web.Services;

/// <summary>
/// Singleton owner of the one physical serial connection. All device access goes through
/// this service — controllers never touch a <see cref="Potentiostat"/> instance directly.
/// </summary>
public sealed class PotentiostatSessionService : IPotentiostatSessionService
{
    /// <summary>
    /// Permanent, always-listed port name that connects to an in-process <see cref="DummyTransport"/>
    /// instead of real hardware, so the UI can be exercised without a Rodeostat plugged in.
    /// </summary>
    public const string DummyPortName = "Simulated Device (no hardware)";

    private readonly IHubContext<AcquisitionHub, IAcquisitionClient> _hub;
    private readonly ILogger<PotentiostatSessionService> _logger;
    private readonly SemaphoreSlim _gate = new(1, 1);

    private IoRodeo.SharpStatDriver.Potentiostat? _device;
    private CancellationTokenSource? _runCts;
    private Task? _runTask;
    private DeviceStatusDto _status = DeviceStatusDto.Disconnected;

    public PotentiostatSessionService(
        IHubContext<AcquisitionHub, IAcquisitionClient> hub,
        ILogger<PotentiostatSessionService> logger)
    {
        _hub = hub;
        _logger = logger;
    }

    public IReadOnlyList<PortInfoDto> ListPorts()
    {
        var realPorts = SerialPort.GetPortNames()
            .OrderBy(name => name, StringComparer.OrdinalIgnoreCase)
            .Select(name => new PortInfoDto(name));
        return new[] { new PortInfoDto(DummyPortName) }.Concat(realPorts).ToArray();
    }

    public DeviceStatusDto GetStatus() => _status;

    public async Task<DeviceStatusDto> ConnectAsync(string portName, CancellationToken ct)
    {
        await _gate.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            if (_status.Connected)
            {
                throw new InvalidOperationException("Already connected.");
            }

            var device = portName == DummyPortName
                ? new IoRodeo.SharpStatDriver.Potentiostat(new DummyTransport())
                : new IoRodeo.SharpStatDriver.Potentiostat(portName);
            try
            {
                await device.ConnectAsync(ct).ConfigureAwait(false);
            }
            catch
            {
                device.Dispose();
                throw;
            }

            _device = device;
            _status = new DeviceStatusDto(
                Connected: true,
                Connecting: false,
                TestRunning: false,
                PortName: portName,
                HardwareVariant: device.HardwareVariant,
                FirmwareVersion: device.FirmwareVersion,
                HardwareVersion: device.HardwareVersion);

            await BroadcastStatusAsync().ConfigureAwait(false);
            await BroadcastLogAsync(LogEntryDto.Info(
                $"Connected to {portName} — {device.HardwareVariant} · {device.FirmwareVersion} · {device.HardwareVersion}"))
                .ConfigureAwait(false);

            return _status;
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task DisconnectAsync()
    {
        await _gate.WaitAsync().ConfigureAwait(false);
        try
        {
            _runCts?.Cancel();
        }
        finally
        {
            _gate.Release();
        }

        if (_runTask is not null)
        {
            try
            {
                await _runTask.ConfigureAwait(false);
            }
            catch
            {
                // Already reported to clients via TestCompleted inside the background task.
            }
        }

        await _gate.WaitAsync().ConfigureAwait(false);
        try
        {
            var portName = _status.PortName;
            if (_device is not null)
            {
                await _device.DisposeAsync().ConfigureAwait(false);
                _device = null;
            }

            _status = DeviceStatusDto.Disconnected;
            await BroadcastStatusAsync().ConfigureAwait(false);
            await BroadcastLogAsync(LogEntryDto.Info($"Disconnected from {portName}")).ConfigureAwait(false);
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task<TechniqueCatalogDto> GetCatalogAsync(CancellationToken ct)
    {
        var device = RequireIdleConnectedDevice();
        var firmwareNames = await device.GetTestNamesAsync(ct).ConfigureAwait(false);
        var availableKeys = TechniqueCatalog.AllKeys
            .Where(key => firmwareNames.Contains(TechniqueCatalog.FirmwareTestName(key)))
            .ToArray();
        return new TechniqueCatalogDto(availableKeys, device.GetAllVoltRanges(), device.GetAllCurrRanges());
    }

    public async Task<TechniqueDefaultsDto> GetDefaultsAsync(string techniqueKey, CancellationToken ct)
    {
        var device = RequireIdleConnectedDevice();
        var firmwareTestName = TechniqueCatalog.FirmwareTestName(techniqueKey);

        var param = await device.GetParamAsync(firmwareTestName, ct).ConfigureAwait(false);
        var currRange = await device.GetCurrRangeAsync(ct).ConfigureAwait(false);
        var sampleRate = await device.GetSampleRateAsync(ct).ConfigureAwait(false);

        return new TechniqueDefaultsDto(
            TechniqueCatalog.UiQuietTimeSeconds(param),
            TechniqueCatalog.UiQuietValueVolts(param),
            currRange,
            sampleRate,
            TechniqueCatalog.ToUiFields(techniqueKey, param));
    }

    public async Task StartTestAsync(StartTestRequest request, CancellationToken ct)
    {
        await _gate.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            var device = RequireIdleConnectedDevice();

            var firmwareTestName = TechniqueCatalog.FirmwareTestName(request.TechniqueKey);
            var param = TechniqueCatalog.ToFirmwareParam(
                request.TechniqueKey, request.Fields, request.QuietTimeSeconds, request.QuietValueVolts);

            await device.SetCurrRangeAsync(request.CurrRange, ct).ConfigureAwait(false);
            await device.SetSampleRateAsync(request.SampleRateHz, ct).ConfigureAwait(false);

            var runCts = new CancellationTokenSource();
            _runCts = runCts;

            EventHandler<SampleEventArgs> onSample = (_, e) =>
                _ = _hub.Clients.All.SampleReceived(ToSampleDto(e.Sample));
            device.SampleReceived += onSample;

            var progress = new Progress<TestProgress>(p =>
                _ = _hub.Clients.All.ProgressChanged(new TestProgressDto(p.ElapsedSeconds, p.TotalSeconds, p.Fraction)));

            _status = _status with { TestRunning = true };
            await BroadcastStatusAsync().ConfigureAwait(false);
            await BroadcastLogAsync(LogEntryDto.Info(
                $"Acquisition started — {TechniqueCatalog.DisplayLabel(request.TechniqueKey)}")).ConfigureAwait(false);

            _runTask = Task.Run(
                () => RunTestBackgroundAsync(device, firmwareTestName, param, progress, onSample, runCts.Token),
                CancellationToken.None);
        }
        finally
        {
            _gate.Release();
        }
    }

    public Task StopTestAsync()
    {
        _runCts?.Cancel();
        return Task.CompletedTask;
    }

    private async Task RunTestBackgroundAsync(
        IoRodeo.SharpStatDriver.Potentiostat device,
        string firmwareTestName,
        System.Text.Json.Nodes.JsonObject param,
        IProgress<TestProgress> progress,
        EventHandler<SampleEventArgs> onSample,
        CancellationToken ct)
    {
        try
        {
            var result = await device.RunTestAsync(firmwareTestName, param, progress, cancellationToken: ct)
                .ConfigureAwait(false);
            await _hub.Clients.All.TestCompleted(new TestCompletedDto(result.Times.Count, result.LimitError, false, null))
                .ConfigureAwait(false);
            await BroadcastLogAsync(LogEntryDto.Info($"Acquisition complete — {result.Times.Count} samples"))
                .ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            await _hub.Clients.All.TestCompleted(new TestCompletedDto(0, false, true, null)).ConfigureAwait(false);
            await BroadcastLogAsync(LogEntryDto.Info("Acquisition stopped by user")).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Acquisition failed");
            await BroadcastLogAsync(LogEntryDto.Error(ex)).ConfigureAwait(false);
            await _hub.Clients.All.TestCompleted(new TestCompletedDto(0, false, false, ex.Message)).ConfigureAwait(false);
        }
        finally
        {
            device.SampleReceived -= onSample;
            await _gate.WaitAsync().ConfigureAwait(false);
            try
            {
                _status = _status with { TestRunning = false };
            }
            finally
            {
                _gate.Release();
            }

            await BroadcastStatusAsync().ConfigureAwait(false);
        }
    }

    private IoRodeo.SharpStatDriver.Potentiostat RequireIdleConnectedDevice()
    {
        if (_device is null)
        {
            throw new InvalidOperationException("Not connected.");
        }

        if (_status.TestRunning)
        {
            throw new InvalidOperationException("A test is already running.");
        }

        return _device;
    }

    private static SampleDto ToSampleDto(Sample sample) =>
        new(sample.Channel, sample.TimeSeconds, sample.Volt, sample.Curr, sample.LimitError);

    private Task BroadcastStatusAsync() => _hub.Clients.All.StatusChanged(_status);

    private Task BroadcastLogAsync(LogEntryDto entry) => _hub.Clients.All.LogEntry(entry);

    public async ValueTask DisposeAsync()
    {
        _runCts?.Cancel();
        if (_runTask is not null)
        {
            try
            {
                await _runTask.ConfigureAwait(false);
            }
            catch
            {
                // Best-effort shutdown.
            }
        }

        if (_device is not null)
        {
            await _device.DisposeAsync().ConfigureAwait(false);
        }
    }
}
