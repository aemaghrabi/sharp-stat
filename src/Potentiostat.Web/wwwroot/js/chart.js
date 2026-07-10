// Ported from the Potentiostat Control GUI design mock's hand-built SVG chart
// (buildChart/handleChartWheel/handleChartMouseDown/handleChartMouseMove/computeDomain/
// buildTicks/niceNum/exportPNG), adapted from React setState re-render to a plain class
// that mutates the SVG DOM directly. setData() is called once per incoming sample.
(function (global) {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const W = 560;
  const H = 230;
  const M = { l: 58, r: 14, t: 10, b: 34 };
  const PLOT_W = W - M.l - M.r;
  const PLOT_H = H - M.t - M.b;

  const COLOR_PLOT_BG = 'oklch(0.985 0.002 250)';
  const COLOR_GRID_LINE = 'oklch(0.9 0.005 250)';
  const COLOR_PLOT_BORDER = 'oklch(0.82 0.006 250)';
  const COLOR_TICK_TEXT = 'oklch(0.5 0.01 250)';
  const COLOR_AXIS_LABEL = 'oklch(0.4 0.01 250)';
  const COLOR_HOVER_BOX = 'oklch(0.2 0.01 250)';

  function computeDomain(points, key) {
    if (!points || points.length === 0) {
      return key === 't' ? [0, 10] : [-1, 1];
    }
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < points.length; i++) {
      const v = points[i][key];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (min === max) {
      min -= 0.5;
      max += 0.5;
    }
    const pad = (max - min) * 0.08 || 0.1;
    return [min - pad, max + pad];
  }

  function buildTicks(domain) {
    const [a, b] = domain;
    const n = 5;
    const ticks = [];
    for (let i = 0; i < n; i++) ticks.push(a + (i / (n - 1)) * (b - a));
    return ticks;
  }

  function niceNum(v) {
    if (!isFinite(v)) return '0';
    const av = Math.abs(v);
    if (av >= 1000) return v.toFixed(0);
    if (av >= 1) return v.toFixed(2);
    if (av >= 0.001) return v.toFixed(3);
    return v.toExponential(1);
  }

  function svgEl(tag, attrs) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const key in attrs) {
      if (Object.prototype.hasOwnProperty.call(attrs, key)) {
        el.setAttribute(key, attrs[key]);
      }
    }
    return el;
  }

  class SvgChart {
    constructor(svg, options) {
      this.svg = svg;
      this.xKey = options.xKey;
      this.yKey = options.yKey;
      this.xLabel = options.xLabel;
      this.yLabel = options.yLabel;
      this.color = options.color;
      this.data = [];
      this.zoom = null;
      this.hover = null;
      this._drag = null;

      svg.addEventListener('mousedown', (e) => this._onMouseDown(e));
      svg.addEventListener('mousemove', (e) => this._onMouseMove(e));
      window.addEventListener('mouseup', () => {
        this._drag = null;
      });
      svg.addEventListener('mouseleave', () => {
        this._drag = null;
        if (this.hover) {
          this.hover = null;
          this._render();
        }
      });
      svg.addEventListener('wheel', (e) => this._onWheel(e), { passive: false });
      svg.addEventListener('dblclick', () => {
        this.zoom = null;
        this._render();
      });

      this._render();
    }

    setData(points) {
      this.data = points;
      this._render();
    }

    resetZoom() {
      this.zoom = null;
      this._render();
    }

    exportPng(filenamePrefix) {
      const serializer = new XMLSerializer();
      const svgStr = serializer.serializeToString(this.svg);
      const svgBlob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(svgBlob);
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = W * 2;
        canvas.height = H * 2;
        const ctx = canvas.getContext('2d');
        ctx.scale(2, 2);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, W, H);
        ctx.drawImage(img, 0, 0);
        URL.revokeObjectURL(url);
        canvas.toBlob((blob) => {
          const dlUrl = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = dlUrl;
          a.download = `${filenamePrefix}_${Date.now()}.png`;
          a.click();
          URL.revokeObjectURL(dlUrl);
        });
      };
      img.src = url;
    }

    _getDomain() {
      if (this.zoom) {
        return { x: [this.zoom.xMin, this.zoom.xMax], y: [this.zoom.yMin, this.zoom.yMax] };
      }
      return { x: computeDomain(this.data, this.xKey), y: computeDomain(this.data, this.yKey) };
    }

    _rectScale() {
      const rect = this.svg.getBoundingClientRect();
      return { scaleX: W / rect.width, scaleY: H / rect.height, rect };
    }

    _onMouseDown(e) {
      const domain = this._getDomain();
      this._drag = {
        startClientX: e.clientX,
        startClientY: e.clientY,
        startXDomain: [...domain.x],
        startYDomain: [...domain.y],
      };
    }

    _onMouseMove(e) {
      const { scaleX, scaleY, rect } = this._rectScale();
      const localX = (e.clientX - rect.left) * scaleX;

      if (this._drag) {
        const dxPx = (e.clientX - this._drag.startClientX) * scaleX;
        const dyPx = (e.clientY - this._drag.startClientY) * scaleY;
        const [sx0, sx1] = this._drag.startXDomain;
        const [sy0, sy1] = this._drag.startYDomain;
        const dataDeltaX = -(dxPx / PLOT_W) * (sx1 - sx0);
        const dataDeltaY = (dyPx / PLOT_H) * (sy1 - sy0);
        this.zoom = {
          xMin: sx0 + dataDeltaX,
          xMax: sx1 + dataDeltaX,
          yMin: sy0 + dataDeltaY,
          yMax: sy1 + dataDeltaY,
        };
        this._render();
        return;
      }

      const fracX = (localX - M.l) / PLOT_W;
      if (fracX < 0 || fracX > 1 || !this.data.length) {
        if (this.hover) {
          this.hover = null;
          this._render();
        }
        return;
      }
      const idx = Math.max(0, Math.min(this.data.length - 1, Math.round(fracX * (this.data.length - 1))));
      this.hover = this.data[idx];
      this._render();
    }

    _onWheel(e) {
      e.preventDefault();
      const { scaleX, scaleY, rect } = this._rectScale();
      const localX = (e.clientX - rect.left) * scaleX;
      const localY = (e.clientY - rect.top) * scaleY;
      const domain = this._getDomain();
      const fracX = Math.max(0, Math.min(1, (localX - M.l) / PLOT_W));
      const fracY = Math.max(0, Math.min(1, 1 - (localY - M.t) / PLOT_H));
      const dataX = domain.x[0] + fracX * (domain.x[1] - domain.x[0]);
      const dataY = domain.y[0] + fracY * (domain.y[1] - domain.y[0]);
      const zf = e.deltaY > 0 ? 1.15 : 0.87;
      const newXSpan = (domain.x[1] - domain.x[0]) * zf;
      const newYSpan = (domain.y[1] - domain.y[0]) * zf;
      const newX = [dataX - fracX * newXSpan, dataX + (1 - fracX) * newXSpan];
      const newY = [dataY - fracY * newYSpan, dataY + (1 - fracY) * newYSpan];
      this.zoom = { xMin: newX[0], xMax: newX[1], yMin: newY[0], yMax: newY[1] };
      this._render();
    }

    _render() {
      const svg = this.svg;
      while (svg.firstChild) svg.removeChild(svg.firstChild);

      const domain = this._getDomain();
      const xDomain = domain.x;
      const yDomain = domain.y;
      const toPxX = (v) => M.l + ((v - xDomain[0]) / ((xDomain[1] - xDomain[0]) || 1)) * PLOT_W;
      const toPxY = (v) => M.t + (1 - (v - yDomain[0]) / ((yDomain[1] - yDomain[0]) || 1)) * PLOT_H;

      svg.appendChild(svgEl('rect', { x: M.l, y: M.t, width: PLOT_W, height: PLOT_H, fill: COLOR_PLOT_BG }));

      const xTicks = buildTicks(xDomain);
      const yTicks = buildTicks(yDomain);

      xTicks.forEach((tv) => {
        const px = toPxX(tv);
        svg.appendChild(svgEl('line', {
          x1: px, y1: M.t, x2: px, y2: M.t + PLOT_H, stroke: COLOR_GRID_LINE, 'stroke-width': 1,
        }));
        const label = svgEl('text', {
          x: px, y: M.t + PLOT_H + 16, 'font-size': 9, 'font-family': "'IBM Plex Mono',monospace",
          fill: COLOR_TICK_TEXT, 'text-anchor': 'middle',
        });
        label.textContent = niceNum(tv);
        svg.appendChild(label);
      });

      yTicks.forEach((tv) => {
        const py = toPxY(tv);
        svg.appendChild(svgEl('line', {
          x1: M.l, y1: py, x2: M.l + PLOT_W, y2: py, stroke: COLOR_GRID_LINE, 'stroke-width': 1,
        }));
        const label = svgEl('text', {
          x: M.l - 6, y: py + 3, 'font-size': 9, 'font-family': "'IBM Plex Mono',monospace",
          fill: COLOR_TICK_TEXT, 'text-anchor': 'end',
        });
        label.textContent = niceNum(tv);
        svg.appendChild(label);
      });

      svg.appendChild(svgEl('rect', {
        x: M.l, y: M.t, width: PLOT_W, height: PLOT_H, fill: 'none', stroke: COLOR_PLOT_BORDER, 'stroke-width': 1,
      }));

      let pathD = '';
      const data = this.data;
      for (let i = 0; i < data.length; i++) {
        const p = data[i];
        const px = toPxX(p[this.xKey]);
        const py = toPxY(p[this.yKey]);
        pathD += (i === 0 ? 'M' : 'L') + px.toFixed(2) + ',' + py.toFixed(2) + ' ';
      }
      svg.appendChild(svgEl('path', {
        d: pathD.trim(), fill: 'none', stroke: this.color, 'stroke-width': 1.8,
        'stroke-linejoin': 'round', 'stroke-linecap': 'round',
      }));

      if (this.hover) {
        const hp = this.hover;
        const hx = toPxX(hp[this.xKey]);
        const hy = toPxY(hp[this.yKey]);
        svg.appendChild(svgEl('line', {
          x1: hx, y1: M.t, x2: hx, y2: M.t + PLOT_H, stroke: this.color, 'stroke-width': 1,
          'stroke-dasharray': '3,3', opacity: 0.6,
        }));
        svg.appendChild(svgEl('line', {
          x1: M.l, y1: hy, x2: M.l + PLOT_W, y2: hy, stroke: this.color, 'stroke-width': 1,
          'stroke-dasharray': '3,3', opacity: 0.6,
        }));
        svg.appendChild(svgEl('circle', { cx: hx, cy: hy, r: 3.5, fill: this.color, stroke: '#fff', 'stroke-width': 1 }));

        const label = `${this.xLabel.split(' ')[0]}: ${niceNum(hp[this.xKey])}   ${this.yLabel.split(' ')[0]}: ${niceNum(hp[this.yKey])}`;
        const boxW = Math.min(PLOT_W - 10, label.length * 5.6 + 16);
        let boxX = hx + 8;
        if (boxX + boxW > M.l + PLOT_W) boxX = hx - boxW - 8;
        svg.appendChild(svgEl('rect', {
          x: boxX, y: M.t + 4, width: boxW, height: 18, rx: 4, fill: COLOR_HOVER_BOX, opacity: 0.92,
        }));
        const boxText = svgEl('text', {
          x: boxX + 8, y: M.t + 16, 'font-size': 10, 'font-family': "'IBM Plex Mono',monospace", fill: '#fff',
        });
        boxText.textContent = label;
        svg.appendChild(boxText);
      }

      const xLabelEl = svgEl('text', {
        x: M.l + PLOT_W / 2, y: H - 4, 'font-size': 10, 'font-family': "'IBM Plex Sans',sans-serif",
        fill: COLOR_AXIS_LABEL, 'text-anchor': 'middle',
      });
      xLabelEl.textContent = this.xLabel;
      svg.appendChild(xLabelEl);

      const yLabelEl = svgEl('text', {
        x: 12, y: M.t + PLOT_H / 2, 'font-size': 10, 'font-family': "'IBM Plex Sans',sans-serif",
        fill: COLOR_AXIS_LABEL, 'text-anchor': 'middle', transform: `rotate(-90 12 ${M.t + PLOT_H / 2})`,
      });
      yLabelEl.textContent = this.yLabel;
      svg.appendChild(yLabelEl);
    }
  }

  global.SvgChart = SvgChart;
})(window);
