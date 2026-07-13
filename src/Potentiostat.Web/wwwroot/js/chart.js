// Chart.js-based line chart wrapper. Keeps the same public surface the
// previous hand-rolled SVG engine exposed (setData/resetZoom/exportPng) so
// app.js only needed to change its constructor calls.
(function (global) {
  'use strict';

  if (global.Chart && global.ChartZoom) {
    global.Chart.register(global.ChartZoom);
  }

  const COLOR_PLOT_BG = 'oklch(0.985 0.002 250)';
  const COLOR_GRID_LINE = 'oklch(0.9 0.005 250)';
  const COLOR_PLOT_BORDER = 'oklch(0.82 0.006 250)';
  const COLOR_TICK_TEXT = 'oklch(0.5 0.01 250)';
  const COLOR_AXIS_LABEL = 'oklch(0.4 0.01 250)';
  const COLOR_HOVER_BOX = 'oklch(0.2 0.01 250)';

  // How strongly an axis-strip drag rescales that axis: a drag across the
  // full plot width/height multiplies the visible span by e^AXIS_DRAG_SENSITIVITY.
  const AXIS_DRAG_SENSITIVITY = 2;

  // Which axis strip (if any) a point (in canvas CSS-pixel coords) falls in:
  // below the plot area -> x-axis labels, left of the plot area -> y-axis labels.
  function axisStripAt(chart, x, y) {
    const area = chart.chartArea;
    if (!area) return null;
    if (y > area.bottom && x >= area.left && x <= area.right) return 'x';
    if (x < area.left && y >= area.top && y <= area.bottom) return 'y';
    return null;
  }

  function niceNum(v) {
    if (!isFinite(v)) return '0';
    const av = Math.abs(v);
    if (av >= 1000) return v.toFixed(0);
    if (av >= 1) return v.toFixed(2);
    if (av >= 0.001) return v.toFixed(3);
    return v.toExponential(1);
  }

  const canvasBackgroundPlugin = {
    id: 'canvasBackground',
    beforeDraw(chart) {
      const { ctx, width, height } = chart;
      ctx.save();
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      ctx.restore();
    },
  };

  const chartAreaPlugin = {
    id: 'chartAreaBackground',
    beforeDraw(chart) {
      const { ctx, chartArea } = chart;
      if (!chartArea) return;
      ctx.save();
      ctx.fillStyle = COLOR_PLOT_BG;
      ctx.fillRect(chartArea.left, chartArea.top, chartArea.right - chartArea.left, chartArea.bottom - chartArea.top);
      ctx.restore();
    },
    afterDraw(chart) {
      const { ctx, chartArea } = chart;
      if (!chartArea) return;
      ctx.save();
      ctx.strokeStyle = COLOR_PLOT_BORDER;
      ctx.lineWidth = 1;
      ctx.strokeRect(
        chartArea.left + 0.5, chartArea.top + 0.5,
        chartArea.right - chartArea.left - 1, chartArea.bottom - chartArea.top - 1,
      );
      ctx.restore();
    },
  };

  const watermarkPlugin = {
    id: 'watermark',
    afterDraw(chart) {
      const { ctx, chartArea } = chart;
      if (!chartArea) return;
      const cx = (chartArea.left + chartArea.right) / 2;
      const cy = (chartArea.top + chartArea.bottom) / 2;
      ctx.save();
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = '#000000';
      ctx.font = "600 16px 'IBM Plex Sans', sans-serif";
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('SharpStat By IoTech LLC', cx, cy);
      ctx.restore();
    },
  };

  const crosshairPlugin = {
    id: 'crosshair',
    afterDraw(chart) {
      const active = chart.getActiveElements();
      if (!active || !active.length) return;
      const { ctx, chartArea } = chart;
      const point = active[0].element;
      const color = chart.data.datasets[0].borderColor;
      ctx.save();
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.6;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(point.x, chartArea.top);
      ctx.lineTo(point.x, chartArea.bottom);
      ctx.moveTo(chartArea.left, point.y);
      ctx.lineTo(chartArea.right, point.y);
      ctx.stroke();
      ctx.restore();
    },
  };

  class LineChart {
    constructor(canvas, options) {
      this.xKey = options.xKey;
      this.yKey = options.yKey;
      this.xLabel = options.xLabel;
      this.yLabel = options.yLabel;
      this.color = options.color;
      this.data = [];

      const tickFont = { family: "'IBM Plex Mono', monospace", size: 9 };
      const axisLabelFont = { family: "'IBM Plex Sans', sans-serif", size: 10 };
      const xLabel = this.xLabel;
      const yLabel = this.yLabel;

      this.chart = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
          datasets: [{
            data: [],
            borderColor: this.color,
            backgroundColor: this.color,
            borderWidth: 1.8,
            pointRadius: 0,
            pointHoverRadius: 3.5,
            pointHoverBackgroundColor: this.color,
            pointHoverBorderColor: '#fff',
            pointHoverBorderWidth: 1,
            tension: 0,
            fill: false,
          }],
        },
        options: {
          parsing: false,
          animation: false,
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'nearest', intersect: false, axis: 'x' },
          scales: {
            x: {
              type: 'linear',
              title: { display: true, text: xLabel, color: COLOR_AXIS_LABEL, font: axisLabelFont },
              grid: { color: COLOR_GRID_LINE },
              border: { display: false },
              ticks: { color: COLOR_TICK_TEXT, font: tickFont, stepSize: 0.01, maxTicksLimit: 20, callback: (v) => niceNum(v) },
            },
            y: {
              type: 'linear',
              title: { display: true, text: yLabel, color: COLOR_AXIS_LABEL, font: axisLabelFont },
              grid: { color: COLOR_GRID_LINE },
              border: { display: false },
              ticks: { color: COLOR_TICK_TEXT, font: tickFont, stepSize: 0.01, maxTicksLimit: 20, callback: (v) => niceNum(v) },
            },
          },
          plugins: {
            legend: { display: false },
            tooltip: {
              enabled: true,
              backgroundColor: COLOR_HOVER_BOX,
              titleFont: { family: "'IBM Plex Mono', monospace", size: 10 },
              bodyFont: { family: "'IBM Plex Mono', monospace", size: 10 },
              displayColors: false,
              padding: 6,
              cornerRadius: 4,
              callbacks: {
                title: () => '',
                label: (ctx) => {
                  const p = ctx.raw;
                  return `${xLabel.split(' ')[0]}: ${niceNum(p.x)}   ${yLabel.split(' ')[0]}: ${niceNum(p.y)}`;
                },
              },
            },
            zoom: {
              zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'xy' },
              pan: {
                enabled: true,
                mode: 'xy',
                // Dragging in an axis label strip is handled independently below;
                // don't let the plugin's own xy pan hijack that gesture.
                onPanStart: ({ chart, point }) => {
                  if (point && axisStripAt(chart, point.x, point.y)) return false;
                },
              },
            },
          },
        },
        plugins: [canvasBackgroundPlugin, chartAreaPlugin, watermarkPlugin, crosshairPlugin],
      });

      canvas.addEventListener('dblclick', () => this.resetZoom());
      this._setupAxisDrag(canvas);
    }

    _setupAxisDrag(canvas) {
      this._axisDrag = null;
      this._onAxisDragMove = this._onAxisDragMove.bind(this);
      this._onAxisDragEnd = this._onAxisDragEnd.bind(this);

      canvas.addEventListener('mousedown', (e) => {
        const rect = canvas.getBoundingClientRect();
        const region = axisStripAt(this.chart, e.clientX - rect.left, e.clientY - rect.top);
        if (!region) return;
        e.preventDefault();
        const scale = this.chart.scales[region];
        const area = this.chart.chartArea;
        this._axisDrag = {
          region,
          startClientX: e.clientX,
          startClientY: e.clientY,
          startMin: scale.min,
          startMax: scale.max,
          span: region === 'x' ? (area.right - area.left) : (area.bottom - area.top),
        };
        canvas.style.cursor = region === 'x' ? 'ew-resize' : 'ns-resize';
        window.addEventListener('mousemove', this._onAxisDragMove);
        window.addEventListener('mouseup', this._onAxisDragEnd);
      });

      canvas.addEventListener('mousemove', (e) => {
        if (this._axisDrag) return;
        const rect = canvas.getBoundingClientRect();
        const region = axisStripAt(this.chart, e.clientX - rect.left, e.clientY - rect.top);
        canvas.style.cursor = region === 'x' ? 'ew-resize' : region === 'y' ? 'ns-resize' : '';
      });
      canvas.addEventListener('mouseleave', () => {
        if (!this._axisDrag) canvas.style.cursor = '';
      });

      this._axisDragCanvas = canvas;
    }

    _onAxisDragMove(e) {
      const drag = this._axisDrag;
      if (!drag || !drag.span) return;
      const delta = drag.region === 'x' ? (e.clientX - drag.startClientX) : (e.clientY - drag.startClientY);
      const factor = Math.exp((delta / drag.span) * AXIS_DRAG_SENSITIVITY);
      const center = (drag.startMin + drag.startMax) / 2;
      const halfRange = ((drag.startMax - drag.startMin) / 2) * factor;
      this.chart.zoomScale(drag.region, { min: center - halfRange, max: center + halfRange }, 'none');
    }

    _onAxisDragEnd() {
      if (!this._axisDrag) return;
      this._axisDrag = null;
      if (this._axisDragCanvas) this._axisDragCanvas.style.cursor = '';
      window.removeEventListener('mousemove', this._onAxisDragMove);
      window.removeEventListener('mouseup', this._onAxisDragEnd);
    }

    setData(points) {
      this.data = points;
      this.chart.data.datasets[0].data = points.map((p) => ({ x: p[this.xKey], y: p[this.yKey] }));
      this.chart.update('none');
    }

    resetZoom() {
      this.chart.resetZoom();
    }

    exportPng(filenamePrefix) {
      const url = this.chart.toBase64Image('image/png', 1);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${filenamePrefix}_${Date.now()}.png`;
      a.click();
    }
  }

  global.LineChart = LineChart;
})(window);
