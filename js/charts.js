// Chart.js wrappers — each function creates or updates a chart in a canvas element

const Charts = (() => {
  dayjs.extend(dayjs_plugin_customParseFormat);
  dayjs.extend(dayjs_plugin_isoWeek);

  const registry = {}; // canvasId -> Chart instance

  function destroy(id) {
    if (registry[id]) { registry[id].destroy(); delete registry[id]; }
  }

  function create(id, config) {
    destroy(id);
    const canvas = document.getElementById(id);
    if (!canvas) return null;
    const chart = new Chart(canvas, config);
    registry[id] = chart;
    return chart;
  }

  // Respects R-mode when formatting P&L values on axes and tooltips
  function pnlFmt(v) {
    return (typeof RMode !== 'undefined' && RMode.isActive()) ? RMode.fmtR(v) : fmtEUR(v);
  }

  const GRID_COLOR = '#30363d44';
  const FONT = { family: "'Consolas','Menlo',monospace", size: 11 };
  const GREEN = '#3fb950';
  const RED   = '#f85149';
  const BLUE  = '#388bfd';
  const MUTED = '#8b949e';

  function baseScales(showX = true) {
    return {
      x: {
        display: showX,
        grid: { color: GRID_COLOR },
        ticks: { color: MUTED, font: FONT, maxRotation: 0, maxTicksLimit: 8 },
      },
      y: {
        display: true,
        grid: { color: GRID_COLOR },
        ticks: {
          color: MUTED, font: FONT,
          callback: v => pnlFmt(v),
        },
        suggestedMin: 0,
        suggestedMax: 0,
      },
    };
  }

  // Equity curve
  function equityCurve(canvasId, data) {
    create(canvasId, {
      type: 'line',
      data: {
        labels: data.map(d => d.label),
        datasets: [{
          data: data.map(d => d.cumPnl),
          borderColor: BLUE,
          backgroundColor: 'rgba(56,139,253,0.08)',
          borderWidth: 2,
          pointRadius: data.length < 80 ? 3 : 0,
          pointHoverRadius: 5,
          fill: true,
          tension: 0.2,
        }],
      },
      options: {
        animation: false,
        responsive: true, maintainAspectRatio: true,
        plugins: { legend: { display: false }, tooltip: {
          callbacks: { label: ctx => pnlFmt(ctx.raw) },
        }},
        scales: baseScales(),
      },
    });
  }

  // Drawdown chart
  function drawdown(canvasId, data) {
    create(canvasId, {
      type: 'line',
      data: {
        labels: data.map(d => d.label),
        datasets: [{
          data: data.map(d => d.drawdown),
          borderColor: RED,
          backgroundColor: 'rgba(248,81,73,0.1)',
          borderWidth: 2,
          pointRadius: 0,
          fill: true,
          tension: 0.2,
        }],
      },
      options: {
        animation: false,
        responsive: true, maintainAspectRatio: true,
        plugins: { legend: { display: false }, tooltip: {
          callbacks: { label: ctx => pnlFmt(ctx.raw) },
        }},
        scales: baseScales(),
      },
    });
  }

  // Daily P&L bars
  function dailyPnl(canvasId, data) {
    create(canvasId, {
      type: 'bar',
      data: {
        labels: data.map(d => d.label),
        datasets: [{
          data: data.map(d => d.pnl),
          backgroundColor: data.map(d => d.pnl >= 0 ? 'rgba(63,185,80,0.7)' : 'rgba(248,81,73,0.7)'),
          borderRadius: 3,
        }],
      },
      options: {
        animation: false,
        responsive: true, maintainAspectRatio: true,
        plugins: { legend: { display: false }, tooltip: {
          callbacks: { label: ctx => pnlFmt(ctx.raw) },
        }},
        scales: baseScales(),
      },
    });
  }

  // P&L by strategy (horizontal bars)
  function pnlByGroup(canvasId, groups, labelKey = 'key') {
    const colors = groups.map(g => g.pnl >= 0 ? 'rgba(63,185,80,0.75)' : 'rgba(248,81,73,0.75)');
    create(canvasId, {
      type: 'bar',
      data: {
        labels: groups.map(g => g[labelKey]),
        datasets: [{
          data: groups.map(g => g.pnl),
          backgroundColor: colors,
          borderRadius: 3,
        }],
      },
      options: {
        animation: false,
        indexAxis: 'y',
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: {
          callbacks: { label: ctx => pnlFmt(ctx.raw) },
        }},
        scales: {
          x: { grid: { color: GRID_COLOR }, ticks: { color: MUTED, font: FONT, callback: v => fmtEUR(v) }},
          y: { grid: { color: GRID_COLOR }, ticks: { color: MUTED, font: FONT }},
        },
      },
    });
  }

  // P&L histogram
  function pnlHistogram(canvasId, histData) {
    const colors = histData.data.map((_, i) => {
      const mid = histData.min + (i + 0.5) * histData.step;
      return mid >= 0 ? 'rgba(63,185,80,0.7)' : 'rgba(248,81,73,0.7)';
    });
    create(canvasId, {
      type: 'bar',
      data: {
        labels: histData.labels,
        datasets: [{ data: histData.data, backgroundColor: colors, borderRadius: 2 }],
      },
      options: {
        animation: false,
        responsive: true, maintainAspectRatio: true,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { color: GRID_COLOR }, ticks: { color: MUTED, font: FONT, maxRotation: 45, maxTicksLimit: 10 }},
          y: { grid: { color: GRID_COLOR }, ticks: { color: MUTED, font: FONT }},
        },
      },
    });
  }

  // Long vs Short side-by-side bars
  function longShort(canvasId, longData, shortData) {
    create(canvasId, {
      type: 'bar',
      data: {
        labels: ['P&L', 'Win Rate', 'Avg Win', 'Avg Loss'],
        datasets: [
          { label: 'Long',  data: longData,  backgroundColor: 'rgba(63,185,80,0.75)', borderRadius: 3 },
          { label: 'Short', data: shortData, backgroundColor: 'rgba(56,139,253,0.75)', borderRadius: 3 },
        ],
      },
      options: {
        animation: false,
        responsive: true, maintainAspectRatio: true,
        plugins: { legend: { display: true, labels: { color: MUTED, font: FONT }}},
        scales: {
          x: { grid: { color: GRID_COLOR }, ticks: { color: MUTED, font: FONT }},
          y: { grid: { color: GRID_COLOR }, ticks: { color: MUTED, font: FONT }},
        },
      },
    });
  }

  // Hourly P&L bar
  function byHour(canvasId, data) {
    create(canvasId, {
      type: 'bar',
      data: {
        labels: data.map(d => d.label),
        datasets: [{
          data: data.map(d => d.pnl),
          backgroundColor: data.map(d => d.pnl >= 0 ? 'rgba(63,185,80,0.7)' : 'rgba(248,81,73,0.7)'),
          borderRadius: 2,
        }],
      },
      options: {
        animation: false,
        responsive: true, maintainAspectRatio: true,
        plugins: { legend: { display: false }, tooltip: {
          callbacks: { label: ctx => pnlFmt(ctx.raw) },
        }},
        scales: baseScales(),
      },
    });
  }

  // Day of week bar
  function byDayOfWeek(canvasId, data) {
    create(canvasId, {
      type: 'bar',
      data: {
        labels: data.map(d => d.label),
        datasets: [{
          data: data.map(d => d.pnl),
          backgroundColor: data.map(d => d.pnl >= 0 ? 'rgba(63,185,80,0.7)' : 'rgba(248,81,73,0.7)'),
          borderRadius: 4,
        }],
      },
      options: {
        animation: false,
        responsive: true, maintainAspectRatio: true,
        plugins: { legend: { display: false }, tooltip: {
          callbacks: { label: ctx => pnlFmt(ctx.raw) },
        }},
        scales: baseScales(),
      },
    });
  }

  function monthlyBar(id, labels, pnls) {
    create(id, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          data: pnls,
          backgroundColor: pnls.map(v => v >= 0 ? GREEN + 'cc' : RED + 'cc'),
          borderColor:     pnls.map(v => v >= 0 ? GREEN : RED),
          borderWidth: 1,
          borderRadius: 3,
        }],
      },
      options: {
        animation: false,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: {
          callbacks: { label: ctx => pnlFmt(ctx.raw) },
        }},
        scales: {
          ...baseScales(),
          y: { ...baseScales().y, grid: { color: GRID_COLOR },
            ticks: { ...baseScales().y.ticks, callback: v => fmtEUR(v) }},
        },
      },
    });
  }

  function monthlyCumulative(id, labels, values) {
    create(id, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          data: values,
          borderColor: BLUE,
          borderWidth: 2,
          pointRadius: labels.length > 24 ? 0 : 3,
          pointBackgroundColor: BLUE,
          fill: { target: 'origin', above: GREEN + '22', below: RED + '22' },
          tension: 0.3,
        }],
      },
      options: {
        animation: false,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: {
          callbacks: { label: ctx => pnlFmt(ctx.raw) },
        }},
        scales: {
          ...baseScales(),
          y: { ...baseScales().y, grid: { color: GRID_COLOR },
            ticks: { ...baseScales().y.ticks, callback: v => fmtEUR(v) },
            suggestedMin: 0, suggestedMax: 0 },
        },
      },
    });
  }

  // Intraday/weekly equity curve — cumulative P&L trade-by-trade
  // labelFmt: 'HH:mm' for single day, 'DD MMM HH:mm' for multi-day week view
  function intradayPnl(canvasId, trades, labelFmt = 'HH:mm') {
    const R = typeof RMode !== 'undefined' && RMode.isActive();
    const sorted = [...trades]
      .filter(t => t.closeTime && t.pnlEUR !== null)
      .sort((a, b) => a.closeTime.valueOf() - b.closeTime.valueOf());

    if (!sorted.length) { destroy(canvasId); return; }

    const labels = [sorted[0].openTime ? sorted[0].openTime.format(labelFmt) : ''];
    const data   = [0];
    let cum = 0;
    for (const t of sorted) {
      const pnl = R ? (RMode.toR(t.pnlEUR, t.openTime) ?? 0) : (t.pnlEUR ?? 0);
      cum += pnl;
      labels.push(t.closeTime.format(labelFmt));
      data.push(R ? parseFloat(cum.toFixed(2)) : Math.round(cum));
    }

    create(canvasId, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          data,
          borderColor: BLUE,
          backgroundColor: 'rgba(56,139,253,0.08)',
          borderWidth: 2,
          pointRadius: 4,
          pointHoverRadius: 6,
          fill: true,
          tension: 0.2,
        }],
      },
      options: {
        animation: false,
        responsive: true, maintainAspectRatio: true,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: ctx => pnlFmt(ctx.raw) } },
        },
        scales: baseScales(),
      },
    });
  }

  // Per-trade P&L bars — used for single-day and weekly views
  function perTradePnl(canvasId, trades, labelFmt = 'HH:mm') {
    const R = typeof RMode !== 'undefined' && RMode.isActive();
    const sorted = [...trades]
      .filter(t => t.closeTime && t.pnlEUR !== null)
      .sort((a, b) => a.closeTime.valueOf() - b.closeTime.valueOf());

    if (!sorted.length) { destroy(canvasId); return; }

    const labels = sorted.map(t => t.baseProduct || t.product || '');
    const data   = sorted.map(t => {
      const v = R ? (RMode.toR(t.pnlEUR, t.openTime) ?? 0) : (t.pnlEUR ?? 0);
      return R ? parseFloat(v.toFixed(2)) : Math.round(v);
    });

    create(canvasId, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          data,
          backgroundColor: data.map(v => v >= 0 ? 'rgba(63,185,80,0.7)' : 'rgba(248,81,73,0.7)'),
          borderRadius: 3,
        }],
      },
      options: {
        animation: false,
        responsive: true, maintainAspectRatio: true,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: ctx => pnlFmt(ctx.raw),
              title: (items) => {
                const t = sorted[items[0].dataIndex];
                return `${t.baseProduct} · ${t.closeTime.format(labelFmt)}`;
              },
            },
          },
        },
        scales: baseScales(),
      },
    });
  }

  return { equityCurve, drawdown, dailyPnl, intradayPnl, perTradePnl, pnlByGroup, pnlHistogram, longShort, byHour, byDayOfWeek, monthlyBar, monthlyCumulative };
})();
