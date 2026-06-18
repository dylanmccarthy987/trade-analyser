// Renders the Overview tab

const Overview = (() => {
  let calMonth      = dayjs();
  let calMap        = {};
  let calDateRange  = { from: null, to: null };
  let filterStrategy = '';   // '' = all strategies

  function render(trades, openTrades, dateRange) {
    const el = document.getElementById('tab-overview');

    // Date-range filter first, then optional strategy filter
    const filtered     = App.filterTrades(trades, dateRange);
    const strategies   = [...new Set(filtered.map(t => t.strategy).filter(Boolean))].sort();
    // Reset filter if the selected strategy has no trades in the current period
    if (filterStrategy && !strategies.includes(filterStrategy)) filterStrategy = '';
    const strat        = filtered.filter(t => !filterStrategy || t.strategy === filterStrategy);

    const R               = RMode.isActive();
    const totalPnl        = R ? RMode.sumR(strat)        : Metrics.pnl(strat);
    const _wl             = Metrics.avgWinLoss(strat);
    const _wlR            = R ? (() => {
      const winners = strat.filter(t => (t.pnlEUR ?? 0) > 0);
      const losers  = strat.filter(t => (t.pnlEUR ?? 0) < 0);
      return {
        avgWin:  winners.length ? RMode.sumR(winners) / winners.length : 0,
        avgLoss: losers.length  ? RMode.sumR(losers)  / losers.length  : 0,
      };
    })() : null;
    const avgWin          = R ? _wlR.avgWin  : _wl.avgWin;
    const avgLoss         = R ? _wlR.avgLoss : _wl.avgLoss;
    const { best, worst } = Metrics.bestWorst(strat);
    const calTrades = trades.filter(t => !filterStrategy || t.strategy === filterStrategy);
    if (R) {
      calMap = {};
      for (const t of calTrades) {
        if (!t.closeTime || t.pnlEUR === null) continue;
        const day = t.closeTime.format('YYYY-MM-DD');
        calMap[day] = (calMap[day] ?? 0) + (RMode.toR(t.pnlEUR, t.openTime) ?? 0);
      }
    } else {
      calMap = Metrics.calendarMap(calTrades);
    }
    calDateRange          = dateRange;
    const months          = R ? RMode.monthlyBreakdownR(strat)       : Metrics.monthlyBreakdown(strat);
    const bySetup         = R ? RMode.groupByR(filtered.filter(t => t.strategy), 'strategy')
                               : Metrics.groupBy(filtered.filter(t => t.strategy), 'strategy');
    const setupSlice      = bySetup.length <= 10
                               ? bySetup
                               : [...bySetup.slice(0, 5), ...bySetup.slice(-5)];

    // Avg up day / down day
    const dailyMap = {};
    for (const t of strat) {
      if (!t.closeTime || t.pnlEUR === null) continue;
      const day = t.closeTime.format('YYYY-MM-DD');
      dailyMap[day] = (dailyMap[day] ?? 0) + t.pnlEUR;
    }
    // Daily map — in R mode, sum R per day
    const dailyMapR = {};
    for (const t of strat) {
      if (!t.closeTime || t.pnlEUR === null) continue;
      const day = t.closeTime.format('YYYY-MM-DD');
      dailyMapR[day] = (dailyMapR[day] ?? 0) + (R ? (RMode.toR(t.pnlEUR, t.openTime) ?? 0) : t.pnlEUR);
    }
    const upDays     = Object.values(dailyMapR).filter(v => v > 0);
    const downDays   = Object.values(dailyMapR).filter(v => v < 0);
    const avgUpDay   = upDays.length   ? upDays.reduce((a, b) => a + b, 0)   / upDays.length   : 0;
    const avgDownDay = downDays.length ? downDays.reduce((a, b) => a + b, 0) / downDays.length : 0;
    const totalDays  = Object.keys(dailyMapR).length;
    const upDayPct   = totalDays ? upDays.length / totalDays : null;

    const isSingleDay = dateRange?.from && dateRange?.to && dateRange.from.isSame(dateRange.to, 'day');
    const isWeek      = dateRange?.from && dateRange?.to && !isSingleDay && dateRange.to.diff(dateRange.from, 'day') <= 6;

    const wins    = strat.filter(t => (t.pnlEUR ?? 0) > 0).length;
    const losses  = strat.filter(t => (t.pnlEUR ?? 0) < 0).length;
    const winRate = (wins + losses) > 0 ? wins / (wins + losses) : null;

    // Ratios
    const winLossRatio   = avgLoss   ? (Math.abs(avgWin)        / Math.abs(avgLoss)).toFixed(2)        : null;
    const bestPnl        = R && best  ? RMode.toR(best.pnlEUR,  best.openTime)  : best?.pnlEUR;
    const worstPnl       = R && worst ? RMode.toR(worst.pnlEUR, worst.openTime) : worst?.pnlEUR;
    const bestWorstRatio = bestPnl != null && worstPnl != null ? (Math.abs(bestPnl) / Math.abs(worstPnl)).toFixed(2) : null;
    const dayRatio       = avgDownDay   ? (Math.abs(avgUpDay)    / Math.abs(avgDownDay)).toFixed(2)    : null;
    const pf             = R ? RMode.fmtR.bind(RMode) : fmtEUR;  // P&L formatter for this render

    el.innerHTML = `
      ${openTrades.length ? `
        <div class="open-positions-banner">
          <strong>&#9888; ${openTrades.length} open position${openTrades.length > 1 ? 's' : ''}</strong>
          ${openTrades.map(t => `${t.product} (${t.totalContracts} lots)`).join(' &nbsp;|&nbsp; ')}
        </div>` : ''}

      <div class="log-controls" style="margin-bottom:14px">
        <select class="log-filter" id="ov-filter-strat">
          <option value="">All Strategies</option>
          ${strategies.map(s => `<option value="${escHtml(s)}" ${s === filterStrategy ? 'selected' : ''}>${escHtml(s)}</option>`).join('')}
        </select>
        ${filterStrategy ? `<span style="font-size:12px;color:var(--accent)">Filtering: <strong>${escHtml(filterStrategy)}</strong> &mdash; ${strat.length} trade${strat.length !== 1 ? 's' : ''}</span>` : ''}
      </div>

      <div class="kpi-grid">
        ${kpi('Total P&L', R ? RMode.fmtR(totalPnl) : fmtEUR(totalPnl), pnlCls(totalPnl), `${strat.length} trade${strat.length !== 1 ? 's' : ''}`)}
        <div class="kpi-card">
          <div class="kpi-card-dual">
            <div>
              <div class="kpi-label">Avg Win</div>
              <div class="kpi-value green">${R ? RMode.fmtR(avgWin) : fmtEUR(Math.round(avgWin))}</div>
            </div>
            <div style="color:var(--border);align-self:center;font-size:18px">|</div>
            <div>
              <div class="kpi-label">Avg Loss</div>
              <div class="kpi-value red">${R ? RMode.fmtR(avgLoss) : fmtEUR(Math.round(avgLoss))}</div>
            </div>
          </div>
          ${winLossRatio ? `<div class="kpi-sub" style="margin-top:6px">Ratio ${winLossRatio}x</div>` : ''}
        </div>
        <div class="kpi-card">
          <div class="kpi-card-dual">
            <div>
              <div class="kpi-label">Best Trade</div>
              <div class="kpi-value green">${best ? (R ? RMode.fmtR(bestPnl) : fmtEUR(best.pnlEUR)) : '—'}</div>
            </div>
            <div style="color:var(--border);align-self:center;font-size:18px">|</div>
            <div>
              <div class="kpi-label">Worst Trade</div>
              <div class="kpi-value red">${worst ? (R ? RMode.fmtR(worstPnl) : fmtEUR(worst.pnlEUR)) : '—'}</div>
            </div>
          </div>
          ${bestWorstRatio ? `<div class="kpi-sub" style="margin-top:6px">Ratio ${bestWorstRatio}x</div>` : ''}
        </div>
        <div class="kpi-card">
          <div class="kpi-card-dual">
            <div>
              <div class="kpi-label">Avg Up Day</div>
              <div class="kpi-value green">${avgUpDay ? (R ? RMode.fmtR(avgUpDay) : fmtEUR(Math.round(avgUpDay))) : '—'}</div>
            </div>
            <div style="color:var(--border);align-self:center;font-size:18px">|</div>
            <div>
              <div class="kpi-label">Avg Down Day</div>
              <div class="kpi-value red">${avgDownDay ? (R ? RMode.fmtR(avgDownDay) : fmtEUR(Math.round(avgDownDay))) : '—'}</div>
            </div>
          </div>
          ${dayRatio ? `<div class="kpi-sub" style="margin-top:6px">Ratio ${dayRatio}x</div>` : ''}
        </div>
        <div class="kpi-card">
          <div class="kpi-card-dual">
            <div>
              <div class="kpi-label">Win Rate</div>
              <div class="kpi-value ${winRate === null ? 'neutral' : winRate >= 0.5 ? 'green' : 'red'}">${winRate !== null ? (winRate * 100).toFixed(1) + '%' : '—'}</div>
            </div>
            <div style="color:var(--border);align-self:center;font-size:18px">|</div>
            <div>
              <div class="kpi-label">Up Day %</div>
              <div class="kpi-value ${upDayPct === null ? 'neutral' : upDayPct >= 0.5 ? 'green' : 'red'}">${upDayPct !== null ? (upDayPct * 100).toFixed(1) + '%' : '—'}</div>
            </div>
          </div>
          <div class="kpi-sub" style="margin-top:6px">${wins}W · ${losses}L · ${upDays.length} up day${upDays.length !== 1 ? 's' : ''} of ${totalDays}</div>
        </div>
      </div>

      <div class="charts-grid">
        <div class="chart-card wide">
          <div class="chart-title">${isSingleDay ? `Intraday P&amp;L — ${dateRange.from.format('DD MMM YYYY')}` : isWeek ? `Weekly P&amp;L — ${dateRange.from.format('DD MMM')} – ${dateRange.to.format('DD MMM YYYY')}` : 'Equity Curve'}</div>
          <canvas id="chart-equity" height="80"></canvas>
          <div class="chart-title" style="margin-top:10px">${isSingleDay || isWeek ? 'P&amp;L per Trade' : 'Daily P&amp;L'}</div>
          <canvas id="chart-daily" height="35"></canvas>
        </div>
        <div class="chart-card">
          <div class="chart-title">P&amp;L Calendar — ${calMonth.format('MMMM YYYY')}</div>
          ${calendarHTML()}
        </div>
        <div class="chart-card" style="height:${Math.max(200, setupSlice.length * 28 + 60)}px">
          <div class="chart-title">P&amp;L by Setup</div>
          <canvas id="chart-setup" style="max-height:${Math.max(160, setupSlice.length * 28)}px"></canvas>
        </div>
        <div class="chart-card wide">
          <div class="chart-title">Recent Trades</div>
          ${recentTradesHTML(strat, dateRange)}
        </div>
        <div class="chart-card wide">
          <div class="chart-title">Best &amp; Worst Trades</div>
          ${topBottomTable(strat)}
        </div>
        <div class="chart-card wide" style="height:${Math.max(200, months.length * 28 + 60)}px">
          <div class="chart-title">Monthly P&amp;L</div>
          <canvas id="chart-monthly" style="max-height:${Math.max(160, months.length * 28)}px"></canvas>
        </div>
      </div>
    `;

    el.querySelector('#cal-prev')?.addEventListener('click', () => { calMonth = calMonth.subtract(1, 'month'); refreshCalCard(el); });
    el.querySelector('#cal-next')?.addEventListener('click', () => { calMonth = calMonth.add(1, 'month'); refreshCalCard(el); });

    el.querySelectorAll('.cal-day[data-date]').forEach(cell => {
      cell.addEventListener('click', () => {
        const d = dayjs(cell.dataset.date);
        App.setDateRange(d, d);
      });
    });

    drawCharts(strat, months, setupSlice, dateRange, isSingleDay, isWeek);

    document.getElementById('ov-filter-strat')?.addEventListener('change', e => {
      filterStrategy = e.target.value;
      render(trades, openTrades, dateRange);
    });
  }

  function drawCharts(filtered, months, bySetup, dateRange, isSingleDay, isWeek) {
    const R = RMode.isActive();

    if (isSingleDay) {
      Charts.intradayPnl('chart-equity', filtered, 'HH:mm');
      Charts.perTradePnl('chart-daily',  filtered, 'HH:mm');
    } else if (isWeek) {
      Charts.intradayPnl('chart-equity', filtered, 'DD MMM HH:mm');
      Charts.perTradePnl('chart-daily',  filtered, 'DD MMM HH:mm');
    } else {
      const curve = R ? RMode.equityCurveR(filtered) : Metrics.equityCurve(filtered);
      Charts.equityCurve('chart-equity', curve);
      Charts.dailyPnl('chart-daily', R ? RMode.dailyPnlR(filtered) : Metrics.dailyPnl(filtered));
    }

    Charts.pnlByGroup('chart-setup', bySetup);
    Charts.pnlByGroup('chart-monthly', [...months].reverse(), 'label');
  }

  function recentTradesHTML(trades, dateRange) {
    const sorted = [...trades]
      .filter(t => t.openTime)
      .sort((a, b) => b.openTime.valueOf() - a.openTime.valueOf());

    // Show all trades if the period is a week or shorter, otherwise cap at 10
    const { from, to } = dateRange ?? {};
    const days = (from && to) ? to.diff(from, 'day') + 1 : Infinity;
    const recent = days <= 7 ? sorted : sorted.slice(0, 10);

    if (!recent.length) return `<div style="color:var(--muted);font-size:12px;padding:8px 0">No trades yet.</div>`;
    return `<div class="recent-trades-scroll"><table class="stats-table">
      <thead><tr><th>Time</th><th>Contract</th><th>Dir</th><th>Lots</th><th>P&amp;L</th><th>Strategy</th></tr></thead>
      <tbody>${recent.map(t => {
        const pnlCls = (t.pnlEUR ?? 0) > 0 ? 'pos' : (t.pnlEUR ?? 0) < 0 ? 'neg' : 'zero';
        const strat  = [t.strategy, t.substrategy].filter(Boolean).join(' / ');
        return `<tr>
          <td class="mono">${t.openTime.format('DD MMM HH:mm')}</td>
          <td>${escHtml(t.baseProduct)}</td>
          <td><span class="dir-badge ${t.direction}">${t.direction === 'long' ? 'L' : 'S'}</span></td>
          <td class="mono">${t.totalContracts}</td>
          <td class="pnl-cell ${pnlCls}">${RMode.fmt(t.pnlEUR, t.openTime)}</td>
          <td style="color:var(--muted);font-family:var(--font-sans)">${escHtml(strat)}</td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>`;
  }

  function topBottomTable(trades) {
    const sorted = [...trades].sort((a, b) => (b.pnlEUR ?? 0) - (a.pnlEUR ?? 0));
    const top10  = sorted.slice(0, 10);
    const bot10  = sorted.slice(-10).reverse();

    const tradeRows = (list) => list.map(t => {
      const strat = [t.strategy, t.substrategy].filter(Boolean).join(' / ');
      return `<tr>
        <td class="mono">${t.closeTime ? t.closeTime.format('DD MMM YY') : '—'}</td>
        <td>${escHtml(t.product)}</td>
        <td><span class="dir-badge ${t.direction}">${t.direction === 'long' ? 'L' : 'S'}</span></td>
        <td class="mono">${t.totalContracts}</td>
        <td class="pnl-cell ${(t.pnlEUR ?? 0) > 0 ? 'pos' : (t.pnlEUR ?? 0) < 0 ? 'neg' : 'zero'}">${RMode.fmt(t.pnlEUR, t.openTime)}</td>
        <td style="color:var(--muted)">${escHtml(strat)}</td>
      </tr>`;
    }).join('');

    const thead = `<thead><tr><th>Date</th><th>Contract</th><th>Dir</th><th>Lots</th><th>P&amp;L</th><th>Strategy</th></tr></thead>`;

    return `<div style="overflow-x:auto">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;min-width:560px">
        <div>
          <div style="font-size:11px;color:var(--muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:.05em">Top 10</div>
          <table class="stats-table">${thead}<tbody>${tradeRows(top10)}</tbody></table>
        </div>
        <div>
          <div style="font-size:11px;color:var(--muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:.05em">Bottom 10</div>
          <table class="stats-table">${thead}<tbody>${tradeRows(bot10)}</tbody></table>
        </div>
      </div>
    </div>`;
  }

function fmtCalPnl(val) {
    if (RMode.isActive()) return RMode.fmtR(val);
    const abs = Math.abs(val);
    const str = abs >= 1000 ? (abs / 1000).toFixed(1) + 'k' : Math.round(abs).toString();
    return (val >= 0 ? '+' : '-') + str;
  }

  function escHtml(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function kpi(label, value, cls, sub) {
    return `<div class="kpi-card">
      <div class="kpi-label">${label}</div>
      <div class="kpi-value ${cls}">${value}</div>
      ${sub ? `<div class="kpi-sub">${sub}</div>` : ''}
    </div>`;
  }

  function pnlCls(v) { return v > 0 ? 'green' : v < 0 ? 'red' : 'neutral'; }

  function calendarHTML() {
    const month    = calMonth;
    const first    = month.startOf('month');
    const days     = month.daysInMonth();
    const startDow = (first.day() + 6) % 7; // Mon=0

    let cells = '';
    for (let i = 0; i < startDow; i++) cells += `<div class="cal-day empty"></div>`;
    for (let d = 1; d <= days; d++) {
      const ds  = month.date(d).format('YYYY-MM-DD');
      const pnl = calMap[ds];
      const cls = pnl === undefined ? 'no-trades' : pnl >= 0 ? 'profit' : 'loss';
      const pnlLabel = pnl === undefined ? '' : `<span class="cal-pnl">${fmtCalPnl(pnl)}</span>`;
      const selCls = (calDateRange.from && calDateRange.to && calDateRange.from.format('YYYY-MM-DD') === ds && calDateRange.to.format('YYYY-MM-DD') === ds) ? ' selected' : '';
      cells += `<div class="cal-day ${cls}${selCls}" data-date="${ds}" title="${ds}${pnl !== undefined ? ': ' + (RMode.isActive() ? RMode.fmtR(pnl) : fmtEUR(pnl)) : ''}"><span class="cal-day-num">${d}</span>${pnlLabel}</div>`;
    }

    return `
      <div class="cal-header" style="margin-bottom:6px">
        <button class="cal-nav" id="cal-prev">&#8249;</button>
        <span class="cal-title">${month.format('MMMM YYYY')}</span>
        <button class="cal-nav" id="cal-next">&#8250;</button>
      </div>
      <div class="cal-grid">
        <div class="cal-day-name">M</div><div class="cal-day-name">T</div>
        <div class="cal-day-name">W</div><div class="cal-day-name">T</div>
        <div class="cal-day-name">F</div><div class="cal-day-name">S</div>
        <div class="cal-day-name">S</div>
        ${cells}
      </div>`;
  }

  function refreshCalCard(el) {
    const calCard = [...el.querySelectorAll('.chart-card')].find(c => c.querySelector('.chart-title')?.textContent.startsWith('P&L Calendar'));
    if (!calCard) return;
    calCard.querySelector('.chart-title').textContent = `P&L Calendar — ${calMonth.format('MMMM YYYY')}`;
    // Remove only the calendar elements, leaving .chart-title intact
    [...calCard.children].forEach(child => {
      if (!child.classList.contains('chart-title')) child.remove();
    });
    calCard.insertAdjacentHTML('beforeend', calendarHTML());
    calCard.querySelector('#cal-prev')?.addEventListener('click', () => { calMonth = calMonth.subtract(1, 'month'); refreshCalCard(el); });
    calCard.querySelector('#cal-next')?.addEventListener('click', () => { calMonth = calMonth.add(1, 'month'); refreshCalCard(el); });
    calCard.querySelectorAll('.cal-day[data-date]').forEach(cell => {
      cell.addEventListener('click', () => {
        const d = dayjs(cell.dataset.date);
        App.setDateRange(d, d);
      });
    });
  }

  return { render };
})();
