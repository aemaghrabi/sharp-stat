(function () {
  'use strict';

  const FIELD_IDS = {
    cv: { value: 'cv-value', duration: 'cv-duration' },
    ca: {
      step1Duration: 'ca-step1-duration', step1Value: 'ca-step1-value',
      step2Duration: 'ca-step2-duration', step2Value: 'ca-step2-value',
    },
    cyclic: {
      amplitude: 'cyclic-amplitude', offset: 'cyclic-offset',
      period: 'cyclic-period', numCycles: 'cyclic-cycles', shift: 'cyclic-shift',
    },
    ls: { startValue: 'ls-start-value', finalValue: 'ls-final-value', duration: 'ls-duration' },
    sine: {
      amplitude: 'sine-amplitude', offset: 'sine-offset',
      period: 'sine-period', numCycles: 'sine-cycles', shift: 'sine-shift',
    },
    square: {
      amplitude: 'square-amplitude', startValue: 'square-start-value', finalValue: 'square-final-value',
      stepValue: 'square-step-value', window: 'square-window',
    },
  };

  const el = (id) => document.getElementById(id);

  const state = {
    status: { connected: false, connecting: false, testRunning: false },
    data: [],
    connection: null,
  };

  let charts;

  document.addEventListener('DOMContentLoaded', () => {
    charts = {
      tv: new LineChart(el('chart-tv'), { xKey: 't', yKey: 'v', xLabel: 'Time (s)', yLabel: 'Voltage (V)', color: '#3E7BD6' }),
      ti: new LineChart(el('chart-ti'), { xKey: 't', yKey: 'i', xLabel: 'Time (s)', yLabel: 'Current (µA)', color: '#D97E33' }),
      vi: new LineChart(el('chart-vi'), { xKey: 'v', yKey: 'i', xLabel: 'Voltage (V)', yLabel: 'Current (µA)', color: '#8B5CC9' }),
    };

    wireStaticControls();
    startSignalR();
    loadPorts();
    refreshStatus();
  });

  // ---------------------------------------------------------------
  // Log panel
  // ---------------------------------------------------------------

  function addLogEntry(entry) {
    const container = el('log-entries');
    const div = document.createElement('div');
    div.className = 'log-entry' + (entry.level === 'error' ? ' log-error' : entry.level === 'warn' ? ' log-warn' : '');
    const time = new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const timeSpan = document.createElement('span');
    timeSpan.className = 'log-time';
    timeSpan.textContent = time;
    div.appendChild(timeSpan);
    div.appendChild(document.createTextNode(' — ' + entry.message));
    container.appendChild(div);
    while (container.children.length > 60) container.removeChild(container.firstChild);
  }

  function localLog(level, message) {
    addLogEntry({ timestamp: new Date().toISOString(), level, message });
  }

  // ---------------------------------------------------------------
  // SignalR
  // ---------------------------------------------------------------

  function startSignalR() {
    const connection = new signalR.HubConnectionBuilder()
      .withUrl('/hubs/acquisition')
      .withAutomaticReconnect()
      .build();

    connection.on('SampleReceived', (sample) => {
      state.data.push({ t: sample.timeSeconds, v: sample.volt, i: sample.curr });
      charts.tv.setData(state.data);
      charts.ti.setData(state.data);
      charts.vi.setData(state.data);
      el('point-count').textContent = `${state.data.length.toLocaleString()} samples`;
      el('export-csv-btn').disabled = state.data.length === 0;
    });

    connection.on('ProgressChanged', (progress) => {
      el('sim-time-display').textContent = formatSeconds(progress.elapsedSeconds);
      el('total-duration-display').textContent = formatSeconds(progress.totalSeconds);
      el('progress-fill').style.width = `${Math.round(progress.fraction * 100)}%`;
    });

    connection.on('LogEntry', (entry) => addLogEntry(entry));

    connection.on('StatusChanged', (status) => applyStatus(status));

    connection.on('TestCompleted', (result) => {
      el('progress-fill').style.width = '0%';
      if (result.errorMessage) {
        localLog('error', `Acquisition failed: ${result.errorMessage}`);
      }
    });

    connection.start().catch((err) => localLog('error', `SignalR connection failed: ${err.message}`));
    state.connection = connection;
  }

  // ---------------------------------------------------------------
  // Status / connection UI
  // ---------------------------------------------------------------

  function applyStatus(status) {
    state.status = status;

    const dotClass = status.connected ? 'is-connected' : status.connecting ? 'is-connecting' : '';
    for (const dotId of ['status-dot', 'main-status-dot']) {
      const dot = el(dotId);
      dot.className = 'status-dot' + (dotClass ? ' ' + dotClass : '');
    }

    const text = status.connecting
      ? `Connecting to ${status.portName}…`
      : status.connected
        ? `Connected · ${status.portName}`
        : 'Disconnected';
    el('status-text').textContent = text;
    el('main-status-text').textContent = text;

    const connectBtn = el('connect-btn');
    connectBtn.textContent = status.connecting ? 'Connecting…' : status.connected ? 'Disconnect' : 'Connect';
    connectBtn.disabled = status.connecting;
    connectBtn.className = 'btn' + (status.connected ? ' btn-danger' : '');
    el('port-select').disabled = status.connected || status.connecting;

    const infoLine = el('device-info-line');
    if (status.connected) {
      infoLine.hidden = false;
      infoLine.textContent = `${status.hardwareVariant} · ${status.firmwareVersion} · ${status.hardwareVersion}`;
    } else {
      infoLine.hidden = true;
    }

    el('acquiring-badge').className = 'acquiring-badge' + (status.testRunning ? ' is-visible' : '');

    const startBtn = el('start-btn');
    startBtn.disabled = !status.connected;
    startBtn.textContent = status.testRunning ? 'Stop Acquisition' : 'Start Acquisition';
    startBtn.className = 'btn btn-start' + (status.testRunning ? ' btn-danger' : ' btn-success');

    setFormDisabled(!status.connected || status.testRunning);

    if (!status.connected) {
      loadPorts();
    }
  }

  function setFormDisabled(disabled) {
    el('technique-select').disabled = disabled;
    el('curr-range-select').disabled = disabled;
    el('sample-rate').disabled = disabled;
    el('quiet-time').disabled = disabled;
    el('quiet-value').disabled = disabled;
    document.querySelectorAll('.technique-params input').forEach((input) => {
      input.disabled = disabled;
    });
  }

  async function refreshStatus() {
    try {
      const res = await fetch('/api/device/status');
      if (res.ok) applyStatus(await res.json());
    } catch (err) {
      localLog('error', `Could not read device status: ${err.message}`);
    }
  }

  // ---------------------------------------------------------------
  // Ports / connect / disconnect
  // ---------------------------------------------------------------

  async function loadPorts() {
    try {
      const res = await fetch('/api/device/ports');
      if (!res.ok) return;
      const ports = await res.json();
      const select = el('port-select');
      const previous = select.value;
      select.innerHTML = '';
      for (const port of ports) {
        const option = document.createElement('option');
        option.value = port.name;
        option.textContent = port.name;
        select.appendChild(option);
      }
      if (ports.some((p) => p.name === previous)) select.value = previous;
    } catch (err) {
      localLog('error', `Could not list serial ports: ${err.message}`);
    }
  }

  async function connect() {
    const portName = el('port-select').value;
    if (!portName) {
      localLog('warn', 'No serial port selected.');
      return;
    }
    try {
      const res = await fetch('/api/device/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ portName }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        localLog('error', body && body.error ? body.error : `Connect failed (${res.status}).`);
        return;
      }
      applyStatus(body);
      await loadCatalog();
      await loadTechniqueDefaults(el('technique-select').value);
    } catch (err) {
      localLog('error', `Connect failed: ${err.message}`);
    }
  }

  async function disconnect() {
    try {
      const res = await fetch('/api/device/disconnect', { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        localLog('error', body && body.error ? body.error : `Disconnect failed (${res.status}).`);
        return;
      }
      applyStatus(Object.assign({}, state.status, {
        connected: false, connecting: false, testRunning: false,
        portName: null, hardwareVariant: null, firmwareVersion: null, hardwareVersion: null,
      }));
    } catch (err) {
      localLog('error', `Disconnect failed: ${err.message}`);
    }
  }

  // ---------------------------------------------------------------
  // Technique catalog / defaults
  // ---------------------------------------------------------------

  async function loadCatalog() {
    try {
      const res = await fetch('/api/technique/catalog');
      if (!res.ok) return;
      const catalog = await res.json();

      const currSelect = el('curr-range-select');
      currSelect.innerHTML = '';
      for (const range of catalog.currRanges) {
        const option = document.createElement('option');
        option.value = range;
        option.textContent = range;
        currSelect.appendChild(option);
      }

      document.querySelectorAll('#technique-select option').forEach((option) => {
        option.hidden = !catalog.availableTechniqueKeys.includes(option.value);
      });
    } catch (err) {
      localLog('error', `Could not load technique catalog: ${err.message}`);
    }
  }

  async function loadTechniqueDefaults(key) {
    try {
      const res = await fetch(`/api/technique/${key}/default-params`);
      if (!res.ok) return;
      const defaults = await res.json();

      el('quiet-time').value = defaults.quietTimeSeconds;
      el('quiet-value').value = defaults.quietValueVolts;
      el('sample-rate').value = defaults.sampleRateHz;
      if (defaults.currRange) el('curr-range-select').value = defaults.currRange;

      const fieldIds = FIELD_IDS[key];
      for (const fieldName in fieldIds) {
        const value = defaults.fields[fieldName];
        if (value !== undefined) el(fieldIds[fieldName]).value = value;
      }
    } catch (err) {
      localLog('error', `Could not load defaults for ${key}: ${err.message}`);
    }
  }

  function showTechniqueParams(key) {
    document.querySelectorAll('.technique-params').forEach((div) => {
      div.hidden = div.dataset.technique !== key;
    });
    const label = el('technique-select').selectedOptions[0].textContent;
    el('main-technique-label').textContent = label;
  }

  // ---------------------------------------------------------------
  // Acquisition
  // ---------------------------------------------------------------

  function collectFields(key) {
    const fieldIds = FIELD_IDS[key];
    const fields = {};
    for (const fieldName in fieldIds) {
      fields[fieldName] = parseFloat(el(fieldIds[fieldName]).value) || 0;
    }
    return fields;
  }

  async function startAcquisition() {
    const key = el('technique-select').value;
    const request = {
      techniqueKey: key,
      fields: collectFields(key),
      currRange: el('curr-range-select').value,
      sampleRateHz: parseFloat(el('sample-rate').value) || 10,
      quietTimeSeconds: parseFloat(el('quiet-time').value) || 0,
      quietValueVolts: parseFloat(el('quiet-value').value) || 0,
    };

    state.data = [];
    charts.tv.setData(state.data);
    charts.ti.setData(state.data);
    charts.vi.setData(state.data);
    el('point-count').textContent = '0 samples';
    el('sim-time-display').textContent = '0.0s';
    el('progress-fill').style.width = '0%';

    try {
      const res = await fetch('/api/acquisition/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        localLog('error', body && body.error ? body.error : `Start failed (${res.status}).`);
      }
    } catch (err) {
      localLog('error', `Start failed: ${err.message}`);
    }
  }

  async function stopAcquisition() {
    try {
      await fetch('/api/acquisition/stop', { method: 'POST' });
    } catch (err) {
      localLog('error', `Stop failed: ${err.message}`);
    }
  }

  function formatSeconds(t) {
    if (t == null || !isFinite(t)) return '0.0s';
    return t.toFixed(1) + 's';
  }

  // ---------------------------------------------------------------
  // Static control wiring
  // ---------------------------------------------------------------

  function wireStaticControls() {
    el('connect-btn').addEventListener('click', () => {
      if (state.status.connected) {
        disconnect();
      } else {
        connect();
      }
    });

    el('technique-select').addEventListener('change', (e) => {
      const key = e.target.value;
      showTechniqueParams(key);
      if (state.status.connected && !state.status.testRunning) {
        loadTechniqueDefaults(key);
      }
    });

    el('start-btn').addEventListener('click', () => {
      if (state.status.testRunning) {
        stopAcquisition();
      } else {
        startAcquisition();
      }
    });

    el('export-csv-btn').addEventListener('click', () => {
      exportCsv(state.data, `potentiostat_${el('technique-select').value}`);
    });

    el('reset-tv').addEventListener('click', () => charts.tv.resetZoom());
    el('reset-ti').addEventListener('click', () => charts.ti.resetZoom());
    el('reset-vi').addEventListener('click', () => charts.vi.resetZoom());
    el('export-tv').addEventListener('click', () => charts.tv.exportPng('chart_voltage_time'));
    el('export-ti').addEventListener('click', () => charts.ti.exportPng('chart_current_time'));
    el('export-vi').addEventListener('click', () => charts.vi.exportPng('chart_voltage_current'));

    showTechniqueParams(el('technique-select').value);
  }
})();
