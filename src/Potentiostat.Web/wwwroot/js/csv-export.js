// Near-verbatim port of the design mock's exportCSV(): builds a CSV from the in-memory
// sample array accumulated client-side and downloads it via a synthetic <a> click. No
// server round-trip — the browser already has everything that's been charted.
(function (global) {
  'use strict';

  function exportCsv(points, filenamePrefix) {
    if (!points.length) return;
    const header = 'time_s,voltage_V,current_uA\n';
    const rows = points.map((p) => `${p.t},${p.v},${p.i}`).join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filenamePrefix}_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  global.exportCsv = exportCsv;
})(window);
