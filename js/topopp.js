// Top Opportunity tab

const TopOpp = (() => {

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function fmtDuration(ms) {
    if (ms === null || ms === undefined || ms < 0) return '—';
    const totalMins = Math.round(ms / 60000);
    if (totalMins < 60) return `${totalMins}m`;
    const h = Math.floor(totalMins / 60);
    const m = totalMins % 60;
    return m ? `${h}h ${m}m` : `${h}h`;
  }

  function holdMs(t) {
    if (!t.openTime || !t.closeTime) return null;
    return t.closeTime.valueOf() - t.openTime.valueOf();
  }

  function avgHold(trades) {
    const valid = trades.map(holdMs).filter(v => v !== null && v >= 0);
    if (!valid.length) return null;
    return valid.reduce((a, b) => a + b, 0) / valid.length;
  }

  function stats(trades) {
    if (!trades.length) return { count: 0, pnl: 0, winRate: 0, avgWin: 0, avgLoss: 0, avgPnl: 0, avgLots: 0 };
    const R      = RMode.isActive();
    const wins   = trades.filter(t => (t.pnlEUR ?? 0) > 0);
    const losses = trades.filter(t => (t.pnlEUR ?? 0) < 0);
    const pnl    = R ? RMode.sumR(trades) : trades.reduce((s, t) => s + (t.pnlEUR ?? 0), 0);
    const avgWin  = wins.length   ? (R ? RMode.sumR(wins)   / wins.length   : wins.reduce((s,t)   => s + t.pnlEUR, 0) / wins.length)   : 0;
    const avgLoss = losses.length ? (R ? RMode.sumR(losses) / losses.length : losses.reduce((s,t) => s + t.pnlEUR, 0) / losses.length) : 0;
    const avgLots = trades.reduce((s, t) => s + (t.totalContracts ?? 0), 0) / trades.length;
    return {
      count: trades.length,
      pnl,
      winRate: (wins.length + losses.length) > 0 ? wins.length / (wins.length + losses.length) : 0,
      avgWin,
      avgLoss,
      avgPnl: pnl / trades.length,
      avgLots,
    };
  }

  // Format a P&L value respecting R-mode
  function pf(val, date) { return RMode.fmt(val, date); }
  // Format a pre-aggregated value (already in R or EUR depending on mode)
  function pfAgg(val) { return RMode.isActive() ? RMode.fmtR(val) : fmtEUR(val); }

  function avgLots(arr) {
    return arr.length ? arr.reduce((s, t) => s + (t.totalContracts ?? 0), 0) / arr.length : null;
  }

  function escHtml(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  function render(trades, dateRange) {
    const el       = document.getElementById('tab-topopp');
    const filtered = App.filterTrades(trades, dateRange);

    const monthTrades = filtered.filter(t => t.topOpp === 'month');
    const weekTrades  = filtered.filter(t => t.topOpp === 'week');
    const allOpp      = [...monthTrades, ...weekTrades];
    const nonOpp      = filtered.filter(t => !t.topOpp);

    if (!filtered.length) {
      el.innerHTML = `<div class="empty-state">No trades in the selected period.</div>`;
      return;
    }

    if (!allOpp.length) {
      el.innerHTML = `<div class="empty-state" style="padding:60px 20px">
        No Top Opportunity trades in this period.<br>
        <span style="font-size:13px;color:var(--muted)">Tag trades as ★ Week or ★★ Month from the Trade Log.</span>
      </div>`;
      return;
    }

    el.innerHTML = `
      <div style="max-width:1200px;display:flex;flex-direction:column;gap:24px">

        <!-- Row 1: KPI cards -->
        <div class="kpi-grid">
          ${skewCard(allOpp, monthTrades, weekTrades, filtered)}
          ${holdTimeCard(monthTrades, weekTrades, nonOpp)}
          ${sizingCard(monthTrades, weekTrades, nonOpp)}
          ${winRateCard(monthTrades, weekTrades, nonOpp)}
        </div>

        <!-- Row 2: Cumulative P&L chart + Sizing by strategy table -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px">
          <div class="chart-card">
            <div class="chart-title">Cumulative P&amp;L — Top Opps vs Rest</div>
            <div style="position:relative;height:240px"><canvas id="topopp-cumulative-chart"></canvas></div>
          </div>
          <div class="chart-card">
            <div class="chart-title">Sizing vs Normal — by Strategy</div>
            ${sizingTable(filtered)}
          </div>
        </div>

        <!-- Row 3: Hold time breakdown + Sizing bar chart -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px">
          <div class="chart-card">
            <div class="chart-title">Hold Time — Winners vs Losers</div>
            ${holdTimeTable(allOpp, monthTrades, weekTrades)}
          </div>
          <div class="chart-card">
            <div class="chart-title">Avg Lot Size — Top Opp vs Normal</div>
            <div style="position:relative;height:240px"><canvas id="topopp-sizing-chart"></canvas></div>
          </div>
        </div>

        <!-- Row 4: Trade tables -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px">
          ${oppTable('★★ Month Top Opportunities', monthTrades, 'month')}
          ${oppTable('★ Week Top Opportunities', weekTrades, 'week')}
        </div>

      </div>
    `;

    drawCumulativeChart(filtered, allOpp);
    drawSizingChart(filtered);
  }

  // ── KPI Cards ────────────────────────────────────────────────────────────────

  function skewCard(allOpp, monthTrades, weekTrades, filtered) {
    const totalPnl = filtered.reduce((s, t) => s + (t.pnlEUR ?? 0), 0);
    const oppPnl   = allOpp.reduce((s, t) => s + (t.pnlEUR ?? 0), 0);
    const pnlPct   = totalPnl !== 0 ? (oppPnl / Math.abs(totalPnl)) * 100 : 0;
    const countPct = filtered.length ? (allOpp.length / filtered.length) * 100 : 0;
    const punch    = countPct > 0 ? pnlPct / countPct : 0;
    const pnlCls   = oppPnl >= 0 ? 'green' : 'red';
    const punchCls = punch >= 1 ? 'var(--green)' : 'var(--red)';

    const mPnl = monthTrades.reduce((s, t) => s + (t.pnlEUR ?? 0), 0);
    const wPnl = weekTrades.reduce((s, t)  => s + (t.pnlEUR ?? 0), 0);
    const mPct = totalPnl !== 0 ? (mPnl / Math.abs(totalPnl) * 100).toFixed(1) : '—';
    const wPct = totalPnl !== 0 ? (wPnl / Math.abs(totalPnl) * 100).toFixed(1) : '—';

    return `<div class="kpi-card">
      <div class="kpi-label">P&amp;L Skew</div>
      <div class="kpi-value ${pnlCls}">${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(1)}%</div>
      <div class="kpi-sub">${allOpp.length} trades · ${countPct.toFixed(1)}% of volume</div>
      <div style="margin-top:8px;font-size:12px;color:var(--muted)">
        Punch factor: <strong style="color:${punchCls}">${punch.toFixed(2)}×</strong> their weight
      </div>
      <div style="margin-top:6px;font-size:12px;display:flex;gap:12px">
        <span style="color:#f0a500">★★ ${mPct}%</span>
        <span style="color:#5b8dee">★ ${wPct}%</span>
      </div>
    </div>`;
  }

  function holdTimeCard(monthTrades, weekTrades, nonOpp) {
    const mHold    = avgHold(monthTrades);
    const wHold    = avgHold(weekTrades);
    const restHold = avgHold(nonOpp);

    return `<div class="kpi-card">
      <div class="kpi-label">Avg Hold Time</div>
      <div style="margin-top:10px;display:flex;flex-direction:column;gap:8px;font-size:13px">
        <div style="display:flex;justify-content:space-between">
          <span style="color:#f0a500">★★ Month</span>
          <span style="color:var(--text);font-weight:600">${fmtDuration(mHold)}</span>
        </div>
        <div style="display:flex;justify-content:space-between">
          <span style="color:#5b8dee">★ Week</span>
          <span style="color:var(--text);font-weight:600">${fmtDuration(wHold)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding-top:6px;border-top:1px solid var(--border)">
          <span style="color:var(--muted)">Rest</span>
          <span style="color:var(--muted);font-weight:600">${fmtDuration(restHold)}</span>
        </div>
      </div>
    </div>`;
  }

  function sizingCard(monthTrades, weekTrades, nonOpp) {
    const mLots    = avgLots(monthTrades);
    const wLots    = avgLots(weekTrades);
    const restLots = avgLots(nonOpp);

    const fmt  = v => v !== null ? v.toFixed(1) : '—';
    const mult = (opp, rest) => (opp !== null && rest > 0)
      ? `<span style="color:var(--muted);font-size:11px">${(opp / rest).toFixed(2)}×</span>`
      : '';

    return `<div class="kpi-card">
      <div class="kpi-label">Avg Lot Size</div>
      <div style="margin-top:10px;display:flex;flex-direction:column;gap:8px;font-size:13px">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span style="color:#f0a500">★★ Month</span>
          <span style="color:var(--text);font-weight:600">${fmt(mLots)} lots ${mult(mLots, restLots)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span style="color:#5b8dee">★ Week</span>
          <span style="color:var(--text);font-weight:600">${fmt(wLots)} lots ${mult(wLots, restLots)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding-top:6px;border-top:1px solid var(--border)">
          <span style="color:var(--muted)">Rest</span>
          <span style="color:var(--muted);font-weight:600">${fmt(restLots)} lots</span>
        </div>
      </div>
    </div>`;
  }

  function winRateCard(monthTrades, weekTrades, nonOpp) {
    const mWr    = stats(monthTrades).winRate;
    const wWr    = stats(weekTrades).winRate;
    const restWr = stats(nonOpp).winRate;
    const mDiff  = ((mWr - restWr) * 100).toFixed(1);
    const wDiff  = ((wWr - restWr) * 100).toFixed(1);

    const diffBadge = diff => {
      const v = parseFloat(diff);
      const col = v >= 0 ? 'var(--green)' : 'var(--red)';
      return `<span style="color:${col};font-size:11px">${v >= 0 ? '+' : ''}${diff}pp</span>`;
    };

    return `<div class="kpi-card">
      <div class="kpi-label">Win Rate vs Rest</div>
      <div style="margin-top:10px;display:flex;flex-direction:column;gap:8px;font-size:13px">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span style="color:#f0a500">★★ Month</span>
          <span style="color:var(--text);font-weight:600">${(mWr * 100).toFixed(1)}% ${diffBadge(mDiff)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span style="color:#5b8dee">★ Week</span>
          <span style="color:var(--text);font-weight:600">${(wWr * 100).toFixed(1)}% ${diffBadge(wDiff)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding-top:6px;border-top:1px solid var(--border)">
          <span style="color:var(--muted)">Rest</span>
          <span style="color:var(--muted);font-weight:600">${(restWr * 100).toFixed(1)}%</span>
        </div>
      </div>
    </div>`;
  }

  // ── Sizing Table by Asset Class → Strategy ───────────────────────────────────

  function sizingTable(filtered) {
    const assetMap = {};
    for (const t of filtered) {
      const ac  = t.assetClass || 'Other';
      const str = t.strategy   || 'Untagged';
      if (!assetMap[ac]) assetMap[ac] = {};
      if (!assetMap[ac][str]) assetMap[ac][str] = { normal: [], week: [], month: [] };
      if      (t.topOpp === 'month') assetMap[ac][str].month.push(t);
      else if (t.topOpp === 'week')  assetMap[ac][str].week.push(t);
      else                           assetMap[ac][str].normal.push(t);
    }

    const fmt  = v => v !== null ? v.toFixed(1) : '—';
    const multStyle = v => {
      if (v === null) return 'color:var(--muted)';
      if (v >= 1.5)  return 'color:var(--green);font-weight:600';
      if (v >= 1.0)  return 'color:var(--text);font-weight:600';
      return 'color:var(--red);font-weight:600';
    };

    let html = `<div style="overflow:auto;max-height:260px">
      <table class="stats-table" style="font-size:12px">
        <thead><tr>
          <th>Strategy</th>
          <th style="text-align:right">Normal</th>
          <th style="text-align:right;color:#5b8dee">★ Week</th>
          <th style="text-align:right;color:#f0a500">★★ Month</th>
          <th style="text-align:right">Mult</th>
        </tr></thead>
        <tbody>`;

    for (const [ac, strategies] of Object.entries(assetMap)) {
      const hasOpp = Object.values(strategies).some(s => s.week.length || s.month.length);
      if (!hasOpp) continue;

      html += `<tr><td colspan="5" style="color:var(--muted);font-size:11px;padding:6px 4px 2px;font-weight:600;text-transform:uppercase;letter-spacing:.5px">${escHtml(ac)}</td></tr>`;

      for (const [str, g] of Object.entries(strategies)) {
        const hasOppRow = g.week.length || g.month.length;
        if (!hasOppRow) continue;

        const normAvg  = avgLots(g.normal);
        const weekAvg  = avgLots(g.week);
        const monthAvg = avgLots(g.month);
        const oppAll   = [...g.week, ...g.month];
        const oppAvg   = avgLots(oppAll);
        const multVal  = (oppAvg !== null && normAvg > 0) ? oppAvg / normAvg : null;
        const multTxt  = multVal !== null ? multVal.toFixed(2) + '×' : '—';

        html += `<tr>
          <td>${escHtml(str)}</td>
          <td class="mono" style="text-align:right">${fmt(normAvg)}</td>
          <td class="mono" style="text-align:right;color:#5b8dee">${fmt(weekAvg)}</td>
          <td class="mono" style="text-align:right;color:#f0a500">${fmt(monthAvg)}</td>
          <td class="mono" style="text-align:right;${multStyle(multVal)}">${multTxt}</td>
        </tr>`;
      }
    }

    html += `</tbody></table></div>`;
    return html;
  }

  // ── Hold Time — Winners vs Losers ────────────────────────────────────────────

  function holdTimeTable(allOpp, monthTrades, weekTrades) {
    const tiers = [
      { label: '★★ Month',    trades: monthTrades, col: '#f0a500' },
      { label: '★ Week',      trades: weekTrades,  col: '#5b8dee' },
      { label: 'All Top Opps', trades: allOpp,     col: 'var(--accent)' },
    ];

    let html = `<table class="stats-table" style="font-size:12px">
      <thead><tr>
        <th>Tier</th>
        <th style="text-align:right">Avg Hold</th>
        <th style="text-align:right;color:var(--green)">Winners</th>
        <th style="text-align:right;color:var(--red)">Losers</th>
        <th style="text-align:right">Diff</th>
      </tr></thead><tbody>`;

    for (const { label, trades, col } of tiers) {
      if (!trades.length) continue;
      const winners  = trades.filter(t => (t.pnlEUR ?? 0) > 0);
      const losers   = trades.filter(t => (t.pnlEUR ?? 0) < 0);
      const wHold    = avgHold(winners);
      const lHold    = avgHold(losers);
      const diff     = (wHold !== null && lHold !== null) ? wHold - lHold : null;
      const diffCol  = diff === null ? 'var(--muted)' : diff >= 0 ? 'var(--green)' : 'var(--red)';
      const diffTxt  = diff !== null ? (diff >= 0 ? '+' : '−') + fmtDuration(Math.abs(diff)) : '—';

      html += `<tr>
        <td style="color:${col};font-weight:600">${label}</td>
        <td class="mono" style="text-align:right">${fmtDuration(avgHold(trades))}</td>
        <td class="mono" style="text-align:right;color:var(--green)">${fmtDuration(wHold)}</td>
        <td class="mono" style="text-align:right;color:var(--red)">${fmtDuration(lHold)}</td>
        <td class="mono" style="text-align:right;color:${diffCol}">${diffTxt}</td>
      </tr>`;
    }

    html += `</tbody></table>
    <div style="margin-top:10px;font-size:11px;color:var(--muted)">
      Diff = winner avg hold minus loser avg hold. Positive means winners were held longer.
    </div>`;
    return html;
  }

  // ── Charts ───────────────────────────────────────────────────────────────────

  function drawCumulativeChart(filtered, allOpp) {
    const canvas = document.getElementById('topopp-cumulative-chart');
    if (!canvas) return;

    const R      = RMode.isActive();
    const oppIds = new Set(allOpp.map(t => t.tradeId));
    const sorted = [...filtered]
      .filter(t => t.openTime)
      .sort((a, b) => a.openTime.valueOf() - b.openTime.valueOf());

    const oppLine = [], restLine = [];
    let oppSum = 0, restSum = 0;

    for (const t of sorted) {
      const pnl = R ? (RMode.toR(t.pnlEUR ?? 0, t.openTime) ?? 0) : (t.pnlEUR ?? 0);
      if (oppIds.has(t.tradeId)) {
        oppSum += pnl;
        oppLine.push({ x: t.openTime.valueOf(), y: R ? parseFloat(oppSum.toFixed(2)) : Math.round(oppSum) });
      } else {
        restSum += pnl;
        restLine.push({ x: t.openTime.valueOf(), y: R ? parseFloat(restSum.toFixed(2)) : Math.round(restSum) });
      }
    }

    new Chart(canvas, {
      type: 'line',
      data: {
        datasets: [
          {
            label: 'Top Opps',
            data: oppLine,
            borderColor: '#f0a500',
            backgroundColor: 'rgba(240,165,0,0.08)',
            borderWidth: 2,
            pointRadius: 3,
            pointHoverRadius: 5,
            tension: 0.2,
            fill: false,
          },
          {
            label: 'Rest',
            data: restLine,
            borderColor: '#8b949e',
            backgroundColor: 'rgba(139,148,158,0.06)',
            borderWidth: 1.5,
            pointRadius: 2,
            pointHoverRadius: 4,
            tension: 0.2,
            fill: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { labels: { color: '#8b949e', font: { size: 11 } } },
          tooltip: {
            callbacks: {
              title: items => dayjs(items[0].parsed.x).format('DD MMM HH:mm'),
              label: item => ` ${item.dataset.label}: ${RMode.isActive() ? RMode.fmtR(item.parsed.y) : fmtEUR(item.parsed.y)}`,
            },
          },
        },
        scales: {
          x: {
            type: 'linear',
            ticks: {
              color: '#8b949e',
              font: { size: 10 },
              callback: v => dayjs(v).format('DD MMM'),
              maxTicksLimit: 6,
            },
            grid: { color: '#ffffff08' },
          },
          y: {
            ticks: { color: '#8b949e', font: { size: 10 }, callback: v => RMode.isActive() ? RMode.fmtR(v) : fmtEUR(v) },
            grid: { color: '#ffffff08' },
          },
        },
      },
    });
  }

  function drawSizingChart(filtered) {
    const canvas = document.getElementById('topopp-sizing-chart');
    if (!canvas) return;

    // Group by assetClass · strategy, only include strategies with at least one top opp
    const map = {};
    for (const t of filtered) {
      const key = `${t.assetClass || 'Other'} · ${t.strategy || 'Untagged'}`;
      if (!map[key]) map[key] = { opp: [], normal: [] };
      if (t.topOpp) map[key].opp.push(t);
      else          map[key].normal.push(t);
    }

    const labels = [], oppData = [], normalData = [];
    for (const [key, g] of Object.entries(map)) {
      if (!g.opp.length) continue;
      labels.push(key);
      oppData.push(parseFloat((avgLots(g.opp) ?? 0).toFixed(2)));
      normalData.push(parseFloat((avgLots(g.normal) ?? 0).toFixed(2)));
    }

    if (!labels.length) return;

    new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'Top Opp avg', data: oppData,    backgroundColor: 'rgba(240,165,0,0.75)', borderRadius: 4 },
          { label: 'Normal avg',  data: normalData, backgroundColor: 'rgba(139,148,158,0.4)', borderRadius: 4 },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: 'y',
        plugins: {
          legend: { labels: { color: '#8b949e', font: { size: 11 } } },
          tooltip: {
            callbacks: {
              label: item => ` ${item.dataset.label}: ${item.parsed.x.toFixed(1)} lots`,
            },
          },
        },
        scales: {
          x: {
            ticks: { color: '#8b949e', font: { size: 10 } },
            grid: { color: '#ffffff08' },
            title: { display: true, text: 'Avg Lots', color: '#8b949e', font: { size: 10 } },
          },
          y: { ticks: { color: '#8b949e', font: { size: 10 } }, grid: { color: '#ffffff08' } },
        },
      },
    });
  }

  // ── Trade Tables ─────────────────────────────────────────────────────────────

  function oppTable(title, trades, tier) {
    const col = tier === 'month' ? '#f0a500' : '#5b8dee';
    if (!trades.length) return `<div class="chart-card">
      <div class="chart-title" style="color:${col}">${escHtml(title)}</div>
      <div style="color:var(--muted);font-size:13px;padding:12px 0">None in this period.</div>
    </div>`;

    const sorted = [...trades].sort((a, b) => (b.openTime?.valueOf() ?? 0) - (a.openTime?.valueOf() ?? 0));
    const s = stats(trades);

    const rows = sorted.map(t => {
      const pnl    = t.pnlEUR ?? 0;
      const pnlCls = pnl > 0 ? 'pos' : pnl < 0 ? 'neg' : 'zero';
      const strat  = [t.strategy, t.substrategy].filter(Boolean).join(' / ');
      return `<tr>
        <td class="mono">${t.openTime ? t.openTime.format('DD MMM HH:mm') : '—'}</td>
        <td>${escHtml(t.baseProduct || t.product)}</td>
        <td><span class="dir-badge ${t.direction}">${t.direction === 'long' ? 'L' : t.direction === 'short' ? 'S' : '~'}</span></td>
        <td class="mono">${t.totalContracts}</td>
        <td class="pnl-cell ${pnlCls}">${RMode.fmt(pnl, t.openTime)}</td>
        <td class="mono" style="color:var(--muted)">${fmtDuration(holdMs(t))}</td>
        <td style="color:var(--muted);font-size:12px">${escHtml(strat)}</td>
      </tr>`;
    }).join('');

    return `<div class="chart-card" style="overflow:auto">
      <div class="chart-title" style="color:${col}">${escHtml(title)}</div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:10px">
        ${s.count} trade${s.count !== 1 ? 's' : ''} &nbsp;·&nbsp;
        ${(s.winRate * 100).toFixed(1)}% win &nbsp;·&nbsp;
        Total ${pfAgg(RMode.isActive() ? s.pnl : Math.round(s.pnl))} &nbsp;·&nbsp;
        Avg hold ${fmtDuration(avgHold(trades))}
      </div>
      <table class="stats-table">
        <thead><tr>
          <th>Time</th><th>Contract</th><th>Dir</th><th>Lots</th><th>P&amp;L</th><th>Hold</th><th>Strategy</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  }

  return { render };
})();
