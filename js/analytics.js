// Renders the Analytics tab — scrollable grid of stat cards

const Analytics = (() => {
  let _cache          = null;
  let _filteredTrades = [];   // held so strategy dropdown can re-filter without a full render

  function invalidateCache() { _cache = null; }

  function render(trades, dateRange) {
    const filtered = App.filterTrades(trades, dateRange);
    _filteredTrades = filtered;
    const el = document.getElementById('tab-analytics');

    if (!filtered.length) {
      el.innerHTML = `<div class="empty-state">No completed trades in the selected period.</div>`;
      return;
    }

    const R        = RMode.isActive();
    const cacheKey = `${dateRange.from?.valueOf() ?? ''}|${dateRange.to?.valueOf() ?? ''}|${filtered.length}|${R ? 'r' : 'eur'}`;
    let byStrategy, bySubstrategy, byProduct, byClass, hourData, dowData, longs, shorts;

    if (_cache?.key === cacheKey) {
      ({ byStrategy, bySubstrategy, byProduct, byClass, hourData, dowData, longs, shorts } = _cache.data);
    } else {
      const gBy     = R ? RMode.groupByR.bind(RMode) : Metrics.groupBy.bind(Metrics);
      byStrategy    = gBy(filtered, 'strategy');
      bySubstrategy = gBy(filtered, 'substrategy');
      byProduct     = gBy(filtered, 'baseProduct');
      byClass       = gBy(filtered, 'assetClass');
      hourData      = R ? RMode.byHourR(filtered)  : Metrics.byHour(filtered);
      dowData       = R ? RMode.byDowR(filtered)   : Metrics.byDayOfWeek(filtered);
      longs         = filtered.filter(t => t.direction === 'long');
      shorts        = filtered.filter(t => t.direction === 'short');
      _cache = { key: cacheKey, data: { byStrategy, bySubstrategy, byProduct, byClass, hourData, dowData, longs, shorts } };
    }

    el.innerHTML = `
      <div class="analytics-grid">

        <div class="analytics-card wide">
          <div class="chart-title">Strategy Breakdown by Product</div>
          ${strategyBreakdownCard(filtered)}
        </div>

        <div class="analytics-card wide">
          <div class="chart-title">Performance by Strategy</div>
          ${statsTable(byStrategy)}
        </div>

        <div class="analytics-card" style="height:${Math.max(220, byStrategy.length * 32 + 60)}px">
          <div class="chart-title">P&amp;L by Strategy</div>
          <canvas id="ac-strategy" style="max-height:${Math.max(200, byStrategy.length * 32)}px"></canvas>
        </div>

        <div class="analytics-card" style="height:${Math.max(220, bySubstrategy.filter(g => g.key !== '(untagged)').length * 32 + 60)}px">
          <div class="chart-title">P&amp;L by Sub-strategy</div>
          <canvas id="ac-substrategy" style="max-height:${Math.max(200, bySubstrategy.length * 32)}px"></canvas>
        </div>

        <div class="analytics-card" style="height:380px">
          <div class="chart-title">Top 10 Symbols</div>
          <canvas id="ac-product-top" style="max-height:320px"></canvas>
        </div>

        <div class="analytics-card" style="height:380px">
          <div class="chart-title">Bottom 10 Symbols</div>
          <canvas id="ac-product-bot" style="max-height:320px"></canvas>
        </div>

        <div class="analytics-card">
          <div class="chart-title">P&amp;L by Asset Class</div>
          <canvas id="ac-class"></canvas>
        </div>

        <div class="analytics-card">
          <div class="chart-title">Long vs Short</div>
          <canvas id="ac-direction"></canvas>
        </div>

        <div class="analytics-card wide">
          <div class="chart-title">P&amp;L by Time of Day (trade open time)</div>
          <canvas id="ac-hour" height="80"></canvas>
        </div>

        <div class="analytics-card">
          <div class="chart-title">P&amp;L by Day of Week</div>
          <canvas id="ac-dow"></canvas>
        </div>

        <div class="analytics-card wide">
          <div class="chart-title">Avg Win vs Avg Loss by Setup</div>
          ${avgWinLossTable(byStrategy)}
        </div>

      </div>
    `;

    // Charts
    Charts.pnlByGroup('ac-strategy', byStrategy, 'key');
    Charts.pnlByGroup('ac-substrategy', bySubstrategy.filter(g => g.key !== '(untagged)'), 'key');
    Charts.pnlByGroup('ac-product-top', byProduct.slice(0, 10), 'key');
    Charts.pnlByGroup('ac-product-bot', byProduct.length > 10 ? [...byProduct].slice(-10).reverse() : [], 'key');
    Charts.pnlByGroup('ac-class', byClass, 'key');

    // Long vs short
    const longWr  = Metrics.winRate(longs);
    const shortWr = Metrics.winRate(shorts);
    const { avgWin: lwA, avgLoss: llA } = R ? { avgWin: RMode.sumR(longs.filter(t=>(t.pnlEUR??0)>0)) / (longs.filter(t=>(t.pnlEUR??0)>0).length||1), avgLoss: RMode.sumR(longs.filter(t=>(t.pnlEUR??0)<0)) / (longs.filter(t=>(t.pnlEUR??0)<0).length||1) } : Metrics.avgWinLoss(longs);
    const { avgWin: swA, avgLoss: slA } = R ? { avgWin: RMode.sumR(shorts.filter(t=>(t.pnlEUR??0)>0)) / (shorts.filter(t=>(t.pnlEUR??0)>0).length||1), avgLoss: RMode.sumR(shorts.filter(t=>(t.pnlEUR??0)<0)) / (shorts.filter(t=>(t.pnlEUR??0)<0).length||1) } : Metrics.avgWinLoss(shorts);
    Charts.longShort('ac-direction',
      [R ? RMode.sumR(longs)  : Metrics.pnl(longs),  longWr.rate  * 100, lwA, llA],
      [R ? RMode.sumR(shorts) : Metrics.pnl(shorts), shortWr.rate * 100, swA, slA]
    );

    Charts.byHour('ac-hour', hourData);
    Charts.byDayOfWeek('ac-dow', dowData);

    bindStrategyFilter();
  }

  function statsTable(groups) {
    if (!groups.length) return `<div class="empty-state" style="padding:20px">Tag trades with a strategy to see breakdown.</div>`;
    const pf  = RMode.isActive() ? RMode.fmtR.bind(RMode) : fmtEUR;
    const lbl = RMode.isActive() ? 'R' : '€';
    return `<table class="stats-table">
      <thead><tr>
        <th>Setup</th><th>Trades</th><th>Win%</th>
        <th>P&amp;L (${lbl})</th><th>Avg Win</th><th>Avg Loss</th><th>Profit Factor</th>
      </tr></thead>
      <tbody>
        ${groups.map(g => `<tr>
          <td>${escHtml(g.key)}</td>
          <td>${g.total}</td>
          <td>${fmtPct(g.winRate)}</td>
          <td class="${g.pnl >= 0 ? 'green' : 'red'}" style="color:${g.pnl >= 0 ? 'var(--green)' : 'var(--red)'}">${pf(g.pnl)}</td>
          <td>${pf(g.avgWin)}</td>
          <td>${pf(g.avgLoss)}</td>
          <td>${g.profitFactor ? g.profitFactor.toFixed(2) : '—'}</td>
        </tr>`).join('')}
      </tbody>
    </table>`;
  }

  function avgWinLossTable(groups) {
    if (!groups.length) return `<div class="empty-state" style="padding:20px">No tagged trades yet.</div>`;
    const pf = RMode.isActive() ? RMode.fmtR.bind(RMode) : fmtEUR;
    return `<table class="stats-table">
      <thead><tr>
        <th>Setup</th><th>Wins</th><th>Losses</th><th>Avg Win</th><th>Avg Loss</th><th>W:L Ratio</th>
      </tr></thead>
      <tbody>
        ${groups.map(g => {
          const ratio = g.avgLoss !== 0 ? Math.abs(g.avgWin / g.avgLoss).toFixed(2) : '—';
          return `<tr>
            <td>${escHtml(g.key)}</td>
            <td>${g.wins}</td>
            <td>${g.losses}</td>
            <td style="color:var(--green)">${pf(g.avgWin)}</td>
            <td style="color:var(--red)">${pf(g.avgLoss)}</td>
            <td>${ratio}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;
  }

  function strategyBreakdownCard(trades) {
    const strategies = [...new Set(trades.map(t => t.strategy).filter(Boolean))].sort();
    const options = strategies.map(s =>
      `<option value="${escHtml(s)}">${escHtml(s)}</option>`
    ).join('');
    const firstStrategy = strategies[0] || '';
    return `
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px">
        <label style="color:var(--muted);font-size:13px">Strategy</label>
        <select id="strat-breakdown-select" class="log-filter" style="width:220px">
          ${strategies.length
            ? options
            : '<option value="">No tagged trades in this period</option>'}
        </select>
      </div>
      <div id="strat-breakdown-table">
        ${strategyProductTable(trades, firstStrategy)}
      </div>`;
  }

  function strategyProductTable(trades, strategy) {
    if (!strategy) return `<div class="empty-state" style="padding:16px">No strategies tagged in this period.</div>`;
    const R  = RMode.isActive();
    const pf = R ? RMode.fmtR.bind(RMode) : fmtEUR;

    const subset = trades.filter(t => t.strategy === strategy);
    if (!subset.length) return `<div class="empty-state" style="padding:16px">No trades for this strategy.</div>`;

    // Group by baseProduct
    const byProduct = {};
    for (const t of subset) {
      const key = stripMonths(t.baseProduct || t.product);
      if (!byProduct[key]) byProduct[key] = [];
      byProduct[key].push(t);
    }

    const rows = Object.entries(byProduct)
      .map(([product, ts]) => {
        const wins    = ts.filter(t => (t.pnlEUR ?? 0) > 0);
        const winRate = ts.length ? wins.length / ts.length : 0;
        const pnl     = R ? RMode.sumR(ts) : ts.reduce((s, t) => s + (t.pnlEUR ?? 0), 0);
        const maxSize = Math.max(...ts.map(t => t.totalContracts ?? 0));
        const avgSize = ts.reduce((s, t) => s + (t.totalContracts ?? 0), 0) / ts.length;
        return { product, count: ts.length, winRate, pnl, maxSize, avgSize };
      })
      .sort((a, b) => b.pnl - a.pnl);

    const lbl = R ? 'R' : '€';
    return `<table class="stats-table">
      <thead><tr>
        <th>Product</th><th>Trades</th><th>Win%</th>
        <th>P&amp;L (${lbl})</th><th>Max Size (lots)</th><th>Avg Size (lots)</th>
      </tr></thead>
      <tbody>
        ${rows.map(r => `<tr>
          <td style="font-weight:500">${escHtml(r.product)}</td>
          <td>${r.count}</td>
          <td>${fmtPct(r.winRate)}</td>
          <td style="color:${r.pnl >= 0 ? 'var(--green)' : 'var(--red)'}">${pf(r.pnl)}</td>
          <td class="mono">${r.maxSize}</td>
          <td class="mono">${r.avgSize.toFixed(1)}</td>
        </tr>`).join('')}
      </tbody>
    </table>`;
  }

  function bindStrategyFilter() {
    const sel = document.getElementById('strat-breakdown-select');
    const tbl = document.getElementById('strat-breakdown-table');
    if (!sel || !tbl) return;
    sel.addEventListener('change', () => {
      tbl.innerHTML = strategyProductTable(_filteredTrades, sel.value);
    });
  }

  // Strips all contract month+year tokens (e.g. JUN26, Aug26) and cleans
  // up leftover separators — handles both trailing months and calendar
  // spread names like "Silver May26-Aug26" → "Silver".
  function stripMonths(str) {
    return String(str || '')
      .replace(/\s*(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\d{2}/gi, '')
      .replace(/-$/, '')
      .trim();
  }

  function escHtml(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  return { render, invalidateCache };
})();
