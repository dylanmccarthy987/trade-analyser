// All KPI and analytics calculations operate on filtered completed trades

const Metrics = (() => {

  function pnl(trades) {
    return trades.reduce((s, t) => s + (t.pnlEUR ?? 0), 0);
  }

  function winRate(trades) {
    if (!trades.length) return { rate: 0, wins: 0, losses: 0, scratches: 0, total: 0 };
    const wins     = trades.filter(t => (t.pnlEUR ?? 0) > 0).length;
    const losses   = trades.filter(t => (t.pnlEUR ?? 0) < 0).length;
    const scratches = trades.length - wins - losses;
    return { rate: (wins + losses) > 0 ? wins / (wins + losses) : 0, wins, losses, scratches, total: trades.length };
  }

  function profitFactor(trades) {
    const grossWin  = trades.filter(t => (t.pnlEUR ?? 0) > 0).reduce((s, t) => s + t.pnlEUR, 0);
    const grossLoss = trades.filter(t => (t.pnlEUR ?? 0) < 0).reduce((s, t) => s + Math.abs(t.pnlEUR), 0);
    return grossLoss === 0 ? null : grossWin / grossLoss;
  }

  function avgWinLoss(trades) {
    const winners = trades.filter(t => (t.pnlEUR ?? 0) > 0);
    const losers  = trades.filter(t => (t.pnlEUR ?? 0) < 0);
    return {
      avgWin:  winners.length ? winners.reduce((s, t) => s + t.pnlEUR, 0) / winners.length : 0,
      avgLoss: losers.length  ? losers.reduce((s, t)  => s + t.pnlEUR, 0) / losers.length  : 0,
    };
  }

  function bestWorst(trades) {
    if (!trades.length) return { best: null, worst: null };
    const sorted = [...trades].sort((a, b) => (b.pnlEUR ?? 0) - (a.pnlEUR ?? 0));
    return { best: sorted[0], worst: sorted[sorted.length - 1] };
  }

  // Streak of consecutive wins/losses by TRADE
  function tradeStreak(trades) {
    if (!trades.length) return { type: null, count: 0 };
    const sorted = [...trades].sort((a, b) => (a.closeTime?.valueOf() ?? 0) - (b.closeTime?.valueOf() ?? 0));
    let count = 1;
    const last = sorted[sorted.length - 1];
    const lastWin = (last.pnlEUR ?? 0) > 0;
    for (let i = sorted.length - 2; i >= 0; i--) {
      const isWin = (sorted[i].pnlEUR ?? 0) > 0;
      if (isWin === lastWin) count++;
      else break;
    }
    return { type: lastWin ? 'W' : 'L', count };
  }

  // Streak of consecutive profitable/losing DAYS
  function dayStreak(trades) {
    const byDay = {};
    for (const t of trades) {
      const d = t.closeTime ? t.closeTime.format('YYYY-MM-DD') : null;
      if (!d) continue;
      byDay[d] = (byDay[d] ?? 0) + (t.pnlEUR ?? 0);
    }
    const days = Object.keys(byDay).sort();
    if (!days.length) return { type: null, count: 0 };
    const lastDay = days[days.length - 1];
    const lastPos = byDay[lastDay] > 0;
    let count = 1;
    for (let i = days.length - 2; i >= 0; i--) {
      const pos = byDay[days[i]] > 0;
      if (pos === lastPos) count++;
      else break;
    }
    return { type: lastPos ? 'W' : 'L', count };
  }

  // Equity curve: one point per trading day (aggregated) for performance with large datasets
  // Trades with pnlEUR null or suspiciously large (likely bad multiplier) are excluded
  function equityCurve(trades) {
    const OUTLIER_CAP = 500000;
    const sorted = [...trades]
      .filter(t => {
        if (!t.closeTime || t.pnlEUR === null) return false;
        if (Math.abs(t.pnlEUR) > OUTLIER_CAP) {
          console.warn(`[Trade Analyser] Outlier excluded from equity curve: ${t.product} pnlEUR=${t.pnlEUR.toFixed(0)} — check multiplier in Settings`);
          return false;
        }
        return true;
      })
      .sort((a, b) => a.closeTime.valueOf() - b.closeTime.valueOf());

    const dayMap = {};
    for (const t of sorted) {
      const d = t.closeTime.format('YYYY-MM-DD');
      if (!dayMap[d]) dayMap[d] = { date: d, label: t.closeTime.format('DD MMM'), pnl: 0 };
      dayMap[d].pnl += t.pnlEUR;
    }

    let cum = 0;
    return Object.values(dayMap)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(day => { cum += day.pnl; return { date: day.date, label: day.label, cumPnl: cum, pnl: day.pnl }; });
  }

  // Drawdown from peak equity (always ≤ 0)
  function drawdown(equityCurveData) {
    if (!equityCurveData.length) return [];
    let peak = equityCurveData[0].cumPnl;
    return equityCurveData.map(pt => {
      if (pt.cumPnl > peak) peak = pt.cumPnl;
      return { ...pt, drawdown: pt.cumPnl - peak };
    });
  }

  // Daily P&L: { date, pnl }[]
  function dailyPnl(trades) {
    const byDay = {};
    for (const t of trades) {
      if (!t.closeTime || t.pnlEUR === null) continue;
      const d = t.closeTime.format('YYYY-MM-DD');
      byDay[d] = { date: d, label: t.closeTime.format('DD MMM'), pnl: (byDay[d]?.pnl ?? 0) + t.pnlEUR };
    }
    return Object.values(byDay).sort((a, b) => a.date.localeCompare(b.date));
  }

  // P&L histogram buckets
  function pnlHistogram(trades, buckets = 20) {
    const vals = trades.map(t => t.pnlEUR ?? 0).filter(v => v !== 0);
    if (!vals.length) return { labels: [], data: [] };
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const step = (max - min) / buckets || 1;
    const counts = new Array(buckets).fill(0);
    for (const v of vals) {
      const idx = Math.min(Math.floor((v - min) / step), buckets - 1);
      counts[idx]++;
    }
    const labels = counts.map((_, i) => fmtEUR(min + i * step));
    return { labels, data: counts, min, max, step };
  }

  // Group by a field and compute stats
  function groupBy(trades, field) {
    const map = {};
    for (const t of trades) {
      const key = t[field] || '(untagged)';
      if (!map[key]) map[key] = [];
      map[key].push(t);
    }
    return Object.entries(map).map(([key, ts]) => {
      const { rate, wins, losses, total } = winRate(ts);
      const { avgWin, avgLoss } = avgWinLoss(ts);
      const pf = profitFactor(ts);
      return {
        key,
        total,
        pnl: pnl(ts),
        winRate: rate,
        wins, losses,
        avgWin, avgLoss,
        profitFactor: pf,
      };
    }).sort((a, b) => b.pnl - a.pnl);
  }

  // P&L by hour of day (0-23)
  function byHour(trades) {
    const map = {};
    for (let h = 0; h < 24; h++) map[h] = 0;
    for (const t of trades) {
      if (!t.openTime || t.pnlEUR === null) continue;
      const h = t.openTime.hour();
      map[h] += t.pnlEUR;
    }
    return Object.entries(map).map(([h, pnl]) => ({ hour: parseInt(h), label: `${h.toString().padStart(2,'0')}:00`, pnl }));
  }

  // P&L by day of week (0=Mon … 4=Fri)
  function byDayOfWeek(trades) {
    const labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const map = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
    for (const t of trades) {
      if (!t.closeTime || t.pnlEUR === null) continue;
      const dow = (t.closeTime.day() + 6) % 7; // dayjs: 0=Sun → convert to 0=Mon
      map[dow] += t.pnlEUR;
    }
    return labels.map((label, i) => ({ label, pnl: map[i] }));
  }

  // Calendar data: { 'YYYY-MM-DD': pnl }
  function calendarMap(trades) {
    const map = {};
    for (const t of trades) {
      if (!t.closeTime || t.pnlEUR === null) continue;
      const d = t.closeTime.format('YYYY-MM-DD');
      map[d] = (map[d] ?? 0) + t.pnlEUR;
    }
    return map;
  }

  function monthlyBreakdown(trades) {
    const map = {};
    for (const t of trades) {
      if (!t.closeTime) continue;
      const key   = t.closeTime.format('YYYY-MM');
      const label = t.closeTime.format('MMM YYYY');
      if (!map[key]) map[key] = { key, label, trades: [] };
      map[key].trades.push(t);
    }
    return Object.values(map)
      .sort((a, b) => a.key.localeCompare(b.key))
      .map(m => {
        const wr = winRate(m.trades);
        const pf = profitFactor(m.trades);
        const { avgWin, avgLoss } = avgWinLoss(m.trades);
        return {
          key:    m.key,
          label:  m.label,
          total:  m.trades.length,
          wins:   wr.wins,
          losses: wr.losses,
          winRate: wr.rate,
          pnl:    pnl(m.trades),
          avgWin,
          avgLoss,
          profitFactor: pf,
        };
      });
  }

  return {
    pnl, winRate, profitFactor, avgWinLoss, bestWorst,
    tradeStreak, dayStreak,
    equityCurve, drawdown, dailyPnl, pnlHistogram,
    groupBy, byHour, byDayOfWeek, calendarMap, monthlyBreakdown,
  };
})();

// Formatting helpers (used across all modules)
function fmtEUR(val) {
  if (val === null || val === undefined) return '—';
  const abs = Math.abs(val);
  const str = abs >= 10000
    ? abs.toLocaleString('en-IE', { maximumFractionDigits: 0 })
    : abs.toLocaleString('en-IE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (val >= 0 ? '+€' : '-€') + str;
}

function fmtPct(val) {
  if (val === null || val === undefined) return '—';
  return (val * 100).toFixed(1) + '%';
}

function fmtNum(val, dp = 2) {
  if (val === null || val === undefined) return '—';
  return val.toFixed(dp);
}
