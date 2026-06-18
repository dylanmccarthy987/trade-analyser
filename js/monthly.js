// Renders the Monthly P&L tab

const Monthly = (() => {

  function render(trades, dateRange) {
    const filtered = App.filterTrades(trades, dateRange);
    const el = document.getElementById('tab-monthly');

    if (!filtered.length) {
      el.innerHTML = `<div class="empty-state">No completed trades in the selected period.</div>`;
      return;
    }

    const months = RMode.isActive() ? RMode.monthlyBreakdownR(filtered) : Metrics.monthlyBreakdown(filtered);
    const cumulative = (() => {
      let cum = 0;
      return months.map(m => { cum += m.pnl; return cum; });
    })();

    el.innerHTML = `
      <div class="monthly-layout">
        <div class="chart-card wide" style="margin-bottom:0">
          <div class="chart-title">Monthly P&amp;L</div>
          <canvas id="chart-monthly-bar" height="60"></canvas>
        </div>
        <div class="chart-card wide" style="margin-bottom:0">
          <div class="chart-title">Cumulative P&amp;L</div>
          <canvas id="chart-monthly-cum" height="50"></canvas>
        </div>
        <div class="chart-card wide">
          <div class="chart-title">Breakdown</div>
          ${tableHTML(months)}
        </div>
      </div>
    `;

    drawCharts(months, cumulative);
  }

  function drawCharts(months, cumulative) {
    const labels = months.map(m => m.label);
    const pnls   = months.map(m => m.pnl);

    Charts.monthlyBar('chart-monthly-bar', labels, pnls);
    Charts.monthlyCumulative('chart-monthly-cum', labels, cumulative);
  }

  function tableHTML(months) {
    const totPnl  = months.reduce((s, m) => s + m.pnl, 0);
    const totTrades = months.reduce((s, m) => s + m.total, 0);
    const totWins   = months.reduce((s, m) => s + m.wins, 0);
    const totLosses = months.reduce((s, m) => s + m.losses, 0);
    const totWr     = (totWins + totLosses) > 0 ? totWins / (totWins + totLosses) : 0;

    const rows = [...months].reverse().map(m => {
      const pnlCls = m.pnl > 0 ? 'pos' : m.pnl < 0 ? 'neg' : 'zero';
      const bar    = sparkBar(m.pnl, months);
      return `<tr>
        <td class="mono">${m.label}</td>
        <td class="mono">${m.total}</td>
        <td class="mono">${m.wins}</td>
        <td class="mono">${m.losses}</td>
        <td class="mono">${fmtPct(m.winRate)}</td>
        <td class="mono">${RMode.isActive() ? RMode.fmtR(m.avgWin) : fmtEUR(m.avgWin)}</td>
        <td class="mono">${RMode.isActive() ? RMode.fmtR(m.avgLoss) : fmtEUR(m.avgLoss)}</td>
        <td class="mono">${m.profitFactor ? m.profitFactor.toFixed(2) : '—'}</td>
        <td class="pnl-cell ${pnlCls}" style="font-weight:600">${RMode.isActive() ? RMode.fmtR(m.pnl) : fmtEUR(m.pnl)}</td>
        <td style="width:120px;padding:0 8px">${bar}</td>
      </tr>`;
    }).join('');

    const totCls = totPnl > 0 ? 'pos' : totPnl < 0 ? 'neg' : 'zero';

    return `<table class="stats-table">
      <thead><tr>
        <th>Month</th><th>Trades</th><th>Wins</th><th>Losses</th>
        <th>Win%</th><th>Avg Win</th><th>Avg Loss</th><th>PF</th>
        <th>P&amp;L (€)</th><th></th>
      </tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr style="border-top:1px solid var(--border);font-weight:600">
        <td>Total</td>
        <td class="mono">${totTrades}</td>
        <td class="mono">${totWins}</td>
        <td class="mono">${totLosses}</td>
        <td class="mono">${fmtPct(totWr)}</td>
        <td></td><td></td><td></td>
        <td class="pnl-cell ${totCls}" style="font-weight:700">${RMode.isActive() ? RMode.fmtR(totPnl) : fmtEUR(totPnl)}</td>
        <td></td>
      </tr></tfoot>
    </table>`;
  }

  // Inline mini bar showing relative size of this month vs the largest month
  function sparkBar(pnl, months) {
    const maxAbs = Math.max(...months.map(m => Math.abs(m.pnl)), 1);
    const pct    = Math.round(Math.abs(pnl) / maxAbs * 100);
    const color  = pnl >= 0 ? 'var(--green)' : 'var(--red)';
    return `<div style="height:10px;border-radius:2px;width:${pct}%;background:${color};min-width:${pnl !== 0 ? 2 : 0}px"></div>`;
  }

  return { render };
})();
