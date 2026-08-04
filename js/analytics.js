// Renders the Analytics tab — scrollable grid of stat cards

const Analytics = (() => {
  let _cache          = null;
  let _filteredTrades = [];
  let _sizingWindow   = 40;

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
      byProduct     = gBy(filtered.map(t => ({ ...t, _analyticsProduct: productDisplayKey(t) })), '_analyticsProduct');
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
          ${statsTable(byStrategy, filtered)}
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

        <div class="analytics-card wide">
          <div class="chart-title" style="display:flex;align-items:center;gap:12px;margin-bottom:4px">
            Sizing Discipline
            <select id="sizing-window-select" class="log-filter" style="margin-left:auto;width:110px">
              <option value="20"${_sizingWindow===20?' selected':''}>20 days</option>
              <option value="30"${_sizingWindow===30?' selected':''}>30 days</option>
              <option value="40"${_sizingWindow===40?' selected':''}>40 days</option>
            </select>
          </div>
          <div id="sizing-discipline-body">
            ${sizingDisciplineBody(trades, _sizingWindow)}
          </div>
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
    bindSizingWindow(trades);
  }

  function statsTable(groups, allTrades) {
    if (!groups.length) return `<div class="empty-state" style="padding:20px">Tag trades with a strategy to see breakdown.</div>`;
    const R   = RMode.isActive();
    const pf  = R ? RMode.fmtR.bind(RMode) : fmtEUR;
    const lbl = R ? 'R' : '€';
    const pnlOf = t => R ? RMode.toR(t.netPnlEUR ?? t.pnlEUR ?? 0, t.openTime) : (t.netPnlEUR ?? t.pnlEUR ?? 0);

    const rows = groups.map(g => {
      const isUntagged = g.key === '(untagged)';
      const ts = allTrades.filter(t => isUntagged ? !t.strategy : t.strategy === g.key);
      const winner = ts.reduce((best, t) => pnlOf(t) > pnlOf(best) ? t : best, ts[0]);
      const loser  = ts.reduce((worst, t) => pnlOf(t) < pnlOf(worst) ? t : worst, ts[0]);
      const maxSize = Math.max(...ts.map(t => t.totalContracts ?? 0));
      return { g, winner, loser, maxSize };
    });

    return `<table class="stats-table">
      <thead><tr>
        <th>Setup</th><th>Trades</th><th>Win%</th>
        <th>P&amp;L (${lbl})</th><th>Avg Win</th><th>Avg Loss</th>
        <th>Best Trade</th><th>Worst Trade</th><th>Max Size</th>
      </tr></thead>
      <tbody>
        ${rows.map(({ g, winner, loser, maxSize }) => `<tr>
          <td>${escHtml(g.key)}</td>
          <td>${g.total}</td>
          <td>${fmtPct(g.winRate)}</td>
          <td style="color:${g.pnl >= 0 ? 'var(--green)' : 'var(--red)'}">${pf(g.pnl)}</td>
          <td>${pf(g.avgWin)}</td>
          <td>${pf(g.avgLoss)}</td>
          <td style="color:var(--green)">${winner ? pf(pnlOf(winner)) : '—'}</td>
          <td style="color:var(--red)">${loser  ? pf(pnlOf(loser))  : '—'}</td>
          <td class="mono">${maxSize}</td>
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
      const stripped = stripMonths(t.baseProduct || t.product);
      // Calendar spread: after stripping months, no '-' remains (e.g. "Silver May26-Aug26" → "Silver")
      // Outright spread: '-' remains (e.g. "ICE Brent-WTI Jul26" → "ICE Brent-WTI")
      const key = (t.isSpread && !stripped.includes('-') && !stripped.includes('/')) ? stripped + ' Cal' : stripped;
      if (!byProduct[key]) byProduct[key] = [];
      byProduct[key].push(t);
    }

    const rows = Object.entries(byProduct)
      .map(([product, ts]) => {
        const wins    = ts.filter(t => (t.pnlEUR ?? 0) > 0);
        const losers  = ts.filter(t => (t.pnlEUR ?? 0) < 0);
        const winRate = ts.length ? wins.length / ts.length : 0;
        const pnl     = R ? RMode.sumR(ts) : ts.reduce((s, t) => s + (t.pnlEUR ?? 0), 0);
        const maxSize = Math.max(...ts.map(t => t.totalContracts ?? 0));
        const avgSize = ts.reduce((s, t) => s + (t.totalContracts ?? 0), 0) / ts.length;
        const lossPerLot = losers.map(t => (t.pnlEUR ?? 0) / (t.totalContracts || 1))
                                 .sort((a, b) => a - b); // ascending (most negative first)
        const avgLossPerLot = lossPerLot.length
          ? lossPerLot.reduce((s, v) => s + v, 0) / lossPerLot.length
          : null;
        const medLossPerLot = lossPerLot.length
          ? (lossPerLot.length % 2 === 1
              ? lossPerLot[Math.floor(lossPerLot.length / 2)]
              : (lossPerLot[lossPerLot.length / 2 - 1] + lossPerLot[lossPerLot.length / 2]) / 2)
          : null;
        const top5 = lossPerLot.slice(0, 5);
        const avg5LossPerLot = top5.length
          ? top5.reduce((s, v) => s + v, 0) / top5.length
          : null;
        const candidates = [avgLossPerLot, medLossPerLot, avg5LossPerLot].filter(v => v !== null);
        const worstPerLot = candidates.length ? Math.min(...candidates) : null;
        const downside    = RMode.getCurrent();
        const maxLots     = (worstPerLot !== null && worstPerLot < 0 && downside)
          ? Math.floor(downside / Math.abs(worstPerLot))
          : null;
        return { product, count: ts.length, winRate, pnl, maxSize, avgSize, maxLots };
      })
      .sort((a, b) => b.pnl - a.pnl);

    const lbl = R ? 'R' : '€';
    return `<table class="stats-table">
      <thead><tr>
        <th>Product</th><th>Trades</th><th>Win%</th>
        <th>P&amp;L (${lbl})</th><th>Max Size (lots)</th><th>Avg Size (lots)</th>
        <th style="color:var(--accent)">Theoretical Max Size</th>
      </tr></thead>
      <tbody>
        ${rows.map(r => `<tr>
          <td style="font-weight:500">${escHtml(r.product)}</td>
          <td>${r.count}</td>
          <td>${fmtPct(r.winRate)}</td>
          <td style="color:${r.pnl >= 0 ? 'var(--green)' : 'var(--red)'}">${pf(r.pnl)}</td>
          <td class="mono">${r.maxSize}</td>
          <td class="mono">${r.avgSize.toFixed(1)}</td>
          <td class="mono" style="font-weight:600;color:var(--accent)">${r.maxLots !== null ? r.maxLots : '—'}</td>
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

  function bindSizingWindow(allTrades) {
    const sel = document.getElementById('sizing-window-select');
    if (!sel) return;
    sel.addEventListener('change', () => {
      _sizingWindow = parseInt(sel.value);
      const body = document.getElementById('sizing-discipline-body');
      if (body) body.innerHTML = sizingDisciplineBody(allTrades, _sizingWindow);
    });
  }

  function pearsonCorr(xs, ys) {
    const n = xs.length;
    if (n < 3) return null;
    const mx = xs.reduce((a, b) => a + b, 0) / n;
    const my = ys.reduce((a, b) => a + b, 0) / n;
    const num = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0);
    const dx  = Math.sqrt(xs.reduce((s, x) => s + (x - mx) ** 2, 0));
    const dy  = Math.sqrt(ys.reduce((s, y) => s + (y - my) ** 2, 0));
    return (dx && dy) ? num / (dx * dy) : null;
  }

  function sizingDisciplineBody(allTrades, windowDays) {
    const R      = RMode.isActive();
    const cutoff = dayjs().subtract(windowDays, 'day');
    const recent = allTrades.filter(t => !t.isOpen && t.openTime && t.openTime.isAfter(cutoff) && (t.netPnlEUR ?? t.pnlEUR) !== null);

    if (!recent.length) return `<div class="empty-state" style="padding:20px">No closed trades in the last ${windowDays} days.</div>`;

    const pf = R ? RMode.fmtR.bind(RMode) : fmtEUR;
    const rplFmt = v => R ? ((v >= 0 ? '+' : '') + v.toFixed(3) + 'R') : fmtEUR(Math.round(v));
    const arrow = pct => pct > 0.05
      ? `<span style="color:var(--green)">↑${(pct*100).toFixed(0)}%</span>`
      : pct < -0.05
      ? `<span style="color:var(--red)">↓${Math.abs(pct*100).toFixed(0)}%</span>`
      : `<span style="color:var(--muted)">→ flat</span>`;

    const stratMap = {};
    for (const t of recent) {
      if (!t.strategy) continue;
      if (!stratMap[t.strategy]) stratMap[t.strategy] = [];
      stratMap[t.strategy].push(t);
    }

    const allStratMap = {};
    for (const t of allTrades) {
      if (!t.strategy || t.isOpen) continue;
      if (!allStratMap[t.strategy]) allStratMap[t.strategy] = [];
      allStratMap[t.strategy].push(t);
    }

    const rows = Object.entries(stratMap).map(([key, ts]) => {
      const recentR     = R ? RMode.sumR(ts) : ts.reduce((s, t) => s + (t.netPnlEUR ?? t.pnlEUR ?? 0), 0);
      const totalLots   = ts.reduce((s, t) => s + (t.totalContracts ?? 0), 0);
      const recentAvg   = totalLots / ts.length;
      const allTs       = allStratMap[key] || ts;
      const allTimeAvg  = allTs.reduce((s, t) => s + (t.totalContracts ?? 0), 0) / allTs.length;
      const rPerLot     = totalLots > 0 ? recentR / totalLots : null;
      const pct         = allTimeAvg > 0 ? (recentAvg - allTimeAvg) / allTimeAvg : 0;
      return { key, count: ts.length, recentR, recentAvg, allTimeAvg, rPerLot, pct };
    }).sort((a, b) => b.recentR - a.recentR);

    const allClosed             = allTrades.filter(t => !t.isOpen && (t.netPnlEUR ?? t.pnlEUR) !== null);
    const recentOverallAvg      = recent.reduce((s, t) => s + (t.totalContracts ?? 0), 0) / recent.length;
    const allTimeOverallAvg     = allClosed.reduce((s, t) => s + (t.totalContracts ?? 0), 0) / (allClosed.length || 1);
    const overallTrend          = allTimeOverallAvg > 0 ? (recentOverallAvg - allTimeOverallAvg) / allTimeOverallAvg : 0;

    const winners       = recent.filter(t => !t.isScratch && (t.netPnlEUR ?? t.pnlEUR ?? 0) > 0);
    const losers        = recent.filter(t => !t.isScratch && (t.netPnlEUR ?? t.pnlEUR ?? 0) < 0);
    const winAvgLots    = winners.length ? winners.reduce((s, t) => s + (t.totalContracts ?? 0), 0) / winners.length : null;
    const lossAvgLots   = losers.length  ? losers.reduce((s, t)  => s + (t.totalContracts ?? 0), 0) / losers.length  : null;

    const pairs   = recent.filter(t => !t.isScratch);
    const corr    = pearsonCorr(
      pairs.map(t => t.totalContracts ?? 0),
      pairs.map(t => RMode.toR(t.netPnlEUR ?? t.pnlEUR ?? 0, t.openTime) ?? 0)
    );
    const corrColor   = corr === null ? 'var(--muted)' : corr > 0.2 ? 'var(--green)' : corr < -0.2 ? 'var(--red)' : 'var(--muted)';
    const corrVerdict = corr === null ? 'Not enough data'
      : corr > 0.2  ? 'Sizing up on winners'
      : corr < -0.2 ? 'Bigger on losers'
      : 'No clear pattern';

    let alignMsg = '';
    if (rows.length >= 2) {
      const half   = Math.ceil(rows.length / 2);
      const topAvg = rows.slice(0, half).reduce((s, r) => s + r.recentAvg, 0) / half;
      const botAvg = rows.slice(half).reduce((s, r) => s + r.recentAvg, 0) / (rows.length - half);
      if (topAvg > botAvg * 1.1) {
        alignMsg = `Your best setups are sized ${((topAvg/botAvg - 1)*100).toFixed(0)}% larger than your weaker ones — good allocation.`;
      } else if (topAvg < botAvg * 0.9) {
        alignMsg = `You're going ${((botAvg/topAvg - 1)*100).toFixed(0)}% bigger on your weaker setups than your best ones — consider pushing size where you're performing.`;
      } else {
        alignMsg = `Sizing is roughly even across setups — no strong preference toward your best strategies yet.`;
      }
    }

    const lbl = R ? 'R' : '€';
    return `
      ${rows.length ? `
      <table class="stats-table" style="margin-bottom:16px">
        <thead><tr>
          <th>Setup</th>
          <th>${lbl} (${windowDays}d)</th>
          <th>Avg lots (${windowDays}d)</th>
          <th>vs all-time</th>
          <th>${lbl}/lot</th>
        </tr></thead>
        <tbody>
          ${rows.map(r => `<tr>
            <td>${escHtml(r.key)}</td>
            <td style="color:${r.recentR >= 0 ? 'var(--green)' : 'var(--red)'}">${pf(r.recentR)}</td>
            <td class="mono">${r.recentAvg.toFixed(1)}</td>
            <td class="mono">${arrow(r.pct)}</td>
            <td class="mono" style="color:${r.rPerLot !== null && r.rPerLot >= 0 ? 'var(--green)' : 'var(--red)'}">${r.rPerLot !== null ? rplFmt(r.rPerLot) : '—'}</td>
          </tr>`).join('')}
        </tbody>
      </table>` : `<p style="color:var(--muted);font-size:13px;margin-bottom:16px">Tag trades with strategies to see the per-strategy breakdown.</p>`}
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px">
        <div style="background:var(--card);border:1px solid var(--border);border-radius:8px;padding:14px 16px">
          <div style="font-size:11px;color:var(--muted);letter-spacing:.06em;text-transform:uppercase;margin-bottom:8px">Overall sizing trend</div>
          <div style="font-size:20px;font-weight:500">${recentOverallAvg.toFixed(1)} lots</div>
          <div style="font-size:12px;color:var(--muted);margin-top:4px">${arrow(overallTrend)} vs ${allTimeOverallAvg.toFixed(1)} all-time avg</div>
        </div>
        <div style="background:var(--card);border:1px solid var(--border);border-radius:8px;padding:14px 16px">
          <div style="font-size:11px;color:var(--muted);letter-spacing:.06em;text-transform:uppercase;margin-bottom:8px">Winners vs losers</div>
          <div style="font-size:15px;font-weight:500;display:flex;gap:10px;align-items:baseline">
            <span style="color:var(--green)">${winAvgLots !== null ? winAvgLots.toFixed(1) : '—'}</span>
            <span style="font-size:11px;color:var(--muted)">wins</span>
            <span style="color:var(--red)">${lossAvgLots !== null ? lossAvgLots.toFixed(1) : '—'}</span>
            <span style="font-size:11px;color:var(--muted)">losses</span>
          </div>
          <div style="font-size:12px;color:var(--muted);margin-top:4px">${
            winAvgLots !== null && lossAvgLots !== null && lossAvgLots > 0
              ? winAvgLots > lossAvgLots * 1.05
                ? `${((winAvgLots/lossAvgLots - 1)*100).toFixed(0)}% bigger on wins`
                : lossAvgLots > winAvgLots * 1.05
                ? `${((lossAvgLots/winAvgLots - 1)*100).toFixed(0)}% bigger on losses`
                : 'roughly equal sizing'
              : '&nbsp;'
          }</div>
        </div>
        <div style="background:var(--card);border:1px solid var(--border);border-radius:8px;padding:14px 16px">
          <div style="font-size:11px;color:var(--muted);letter-spacing:.06em;text-transform:uppercase;margin-bottom:8px">Size-outcome correlation</div>
          <div style="font-size:20px;font-weight:500;color:${corrColor}">${corr !== null ? (corr >= 0 ? '+' : '') + corr.toFixed(2) : '—'}</div>
          <div style="font-size:12px;color:var(--muted);margin-top:4px">${corrVerdict}</div>
        </div>
      </div>
      ${alignMsg ? `<div style="margin-top:12px;font-size:13px;padding:10px 14px;background:var(--card);border-left:3px solid var(--accent);border-radius:0 6px 6px 0">${alignMsg}</div>` : ''}
    `;
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

  // Key used for top/bottom 10 product grouping:
  // - Outrights + attempts: unchanged (baseProduct already has no month)
  // - Calendar spreads: strip months → "ICE Brent Crude Cal"
  // - Inter-product spreads: strip months → "FESX / FSMI" or "ICE Brent-WTI"
  function productDisplayKey(t) {
    if (!t.isSpread) return t.baseProduct;
    const stripped = stripMonths(t.baseProduct);
    return (!stripped.includes('-') && !stripped.includes('/')) ? stripped + ' Cal' : stripped;
  }

  function escHtml(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  return { render, invalidateCache };
})();
