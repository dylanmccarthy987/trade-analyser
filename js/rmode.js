// R-mode: converts P&L from EUR to R-multiples of daily downside
// R = pnlEUR / downside_active_on_that_date
// Downside is logged per date; the most recent entry on or before a trade date is used.

const RMode = (() => {
  const LOG_KEY  = 'ta_r_log';   // [{value:10000, from:'2026-05-19'}] sorted asc
  const MODE_KEY = 'ta_r_mode';  // 'r' | 'eur'

  let _active = localStorage.getItem(MODE_KEY) === 'r';

  // ── Log management ───────────────────────────────────────────────────────────

  function getLog() {
    try { return JSON.parse(localStorage.getItem(LOG_KEY) || '[]'); }
    catch { return []; }
  }

  function saveLog(log) {
    localStorage.setItem(LOG_KEY, JSON.stringify(log));
  }

  // Save a new downside value with today's date.
  // If an entry already exists for today it is overwritten, not duplicated.
  function setDownside(value) {
    const log   = getLog();
    const today = dayjs().format('YYYY-MM-DD');
    const idx   = log.findIndex(e => e.from === today);
    if (idx >= 0) {
      log[idx].value = value;
    } else {
      log.push({ value, from: today });
      log.sort((a, b) => a.from.localeCompare(b.from));
    }
    saveLog(log);
  }

  function deleteEntry(idx) {
    const log = getLog();
    log.splice(idx, 1);
    saveLog(log);
  }

  // Current (most recent) downside value
  function getCurrent() {
    const log = getLog();
    return log.length ? log[log.length - 1].value : null;
  }

  // Downside active on a given date: most recent entry whose 'from' <= date
  function getDownside(date) {
    if (!date) return null;
    const log = getLog();
    if (!log.length) return null;
    const ds = date.format ? date.format('YYYY-MM-DD') : dayjs(date).format('YYYY-MM-DD');
    let active = log[0].value;   // fallback: earliest entry covers all pre-log trades
    for (const entry of log) {
      if (entry.from <= ds) active = entry.value;
      else break;
    }
    return active;
  }

  // ── Mode toggle ──────────────────────────────────────────────────────────────

  function isActive() { return _active; }

  function toggle() {
    _active = !_active;
    localStorage.setItem(MODE_KEY, _active ? 'r' : 'eur');
    const btn = document.getElementById('r-toggle-btn');
    if (btn) btn.classList.toggle('r-mode-active', _active);
  }

  // ── Conversion & formatting ──────────────────────────────────────────────────

  function toR(pnlEUR, date) {
    if (pnlEUR === null || pnlEUR === undefined) return null;
    const d = getDownside(date);
    if (!d) return null;
    return pnlEUR / d;
  }

  // Format a single trade's P&L — R if mode active and downside exists, EUR otherwise
  function fmt(pnlEUR, date) {
    if (!_active) return fmtEUR(pnlEUR);
    const r = toR(pnlEUR, date);
    return r !== null ? fmtR(r) : fmtEUR(pnlEUR);
  }

  // Format a pre-computed R value
  function fmtR(r) {
    if (r === null || r === undefined || isNaN(r)) return '—';
    return (r >= 0 ? '+' : '') + r.toFixed(2) + 'R';
  }

  // P&L label for column headers / axis labels
  function pnlLabel() { return _active ? 'R' : '€'; }

  // Format an aggregated value (already summed across trades in R)
  function fmtAgg(val) {
    return _active ? fmtR(val) : fmtEUR(val);
  }

  // ── Aggregate helpers (trade-array → R) ──────────────────────────────────────

  function sumR(trades) {
    return trades.reduce((s, t) => s + (toR(t.pnlEUR ?? 0, t.openTime) ?? 0), 0);
  }

  // R-mode groupBy — same output shape as Metrics.groupBy
  function groupByR(trades, field) {
    const map = {};
    for (const t of trades) {
      const key = t[field] || '(untagged)';
      if (!map[key]) map[key] = [];
      map[key].push(t);
    }
    return Object.entries(map).map(([key, ts]) => {
      const wr    = Metrics.winRate(ts);
      const rVals = ts.map(t => toR(t.pnlEUR ?? 0, t.openTime) ?? 0);
      const winR  = rVals.filter(r => r > 0);
      const lossR = rVals.filter(r => r < 0);
      const totalR = rVals.reduce((a, b) => a + b, 0);
      const avgWin  = winR.length  ? winR.reduce((a, b)  => a + b, 0) / winR.length  : 0;
      const avgLoss = lossR.length ? lossR.reduce((a, b) => a + b, 0) / lossR.length : 0;
      return {
        key, total: wr.total, pnl: totalR,
        winRate: wr.rate, wins: wr.wins, losses: wr.losses,
        avgWin, avgLoss,
        profitFactor: avgLoss !== 0 ? Math.abs(avgWin) / Math.abs(avgLoss) : null,
      };
    }).sort((a, b) => b.pnl - a.pnl);
  }

  // R-mode equity curve — same output shape as Metrics.equityCurve
  function equityCurveR(trades) {
    const OUTLIER_CAP = 500000;
    const sorted = [...trades]
      .filter(t => t.closeTime && t.pnlEUR !== null && Math.abs(t.pnlEUR) <= OUTLIER_CAP)
      .sort((a, b) => a.closeTime.valueOf() - b.closeTime.valueOf());

    const dayMap = {};
    for (const t of sorted) {
      const d = t.closeTime.format('YYYY-MM-DD');
      if (!dayMap[d]) dayMap[d] = { date: d, label: t.closeTime.format('DD MMM'), pnl: 0 };
      dayMap[d].pnl += toR(t.pnlEUR, t.openTime) ?? 0;
    }
    let cum = 0;
    return Object.values(dayMap)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(day => { cum += day.pnl; return { date: day.date, label: day.label, cumPnl: cum, pnl: day.pnl }; });
  }

  // R-mode daily P&L — same output shape as Metrics.dailyPnl
  function dailyPnlR(trades) {
    const byDay = {};
    for (const t of trades) {
      if (!t.closeTime || t.pnlEUR === null) continue;
      const d = t.closeTime.format('YYYY-MM-DD');
      byDay[d] = { date: d, label: t.closeTime.format('DD MMM'), pnl: (byDay[d]?.pnl ?? 0) + (toR(t.pnlEUR, t.openTime) ?? 0) };
    }
    return Object.values(byDay).sort((a, b) => a.date.localeCompare(b.date));
  }

  // R-mode by hour — same output shape as Metrics.byHour
  function byHourR(trades) {
    const map = {};
    for (let h = 0; h < 24; h++) map[h] = 0;
    for (const t of trades) {
      if (!t.openTime || t.pnlEUR === null) continue;
      map[t.openTime.hour()] += toR(t.pnlEUR, t.openTime) ?? 0;
    }
    return Object.entries(map).map(([h, pnl]) => ({ hour: parseInt(h), label: `${h.toString().padStart(2,'0')}:00`, pnl }));
  }

  // R-mode by day of week — same output shape as Metrics.byDayOfWeek
  function byDowR(trades) {
    const labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const map = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
    for (const t of trades) {
      if (!t.closeTime || t.pnlEUR === null) continue;
      const dow = (t.closeTime.day() + 6) % 7;
      map[dow] += toR(t.pnlEUR, t.openTime) ?? 0;
    }
    return labels.map((label, i) => ({ label, pnl: map[i] }));
  }

  // R-mode monthly breakdown — same output shape as Metrics.monthlyBreakdown
  function monthlyBreakdownR(trades) {
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
        const wr    = Metrics.winRate(m.trades);
        const rVals = m.trades.map(t => toR(t.pnlEUR ?? 0, t.openTime) ?? 0);
        const winR  = rVals.filter(r => r > 0);
        const lossR = rVals.filter(r => r < 0);
        const totalR = rVals.reduce((a, b) => a + b, 0);
        return {
          key: m.key, label: m.label, total: m.trades.length,
          wins: wr.wins, losses: wr.losses, winRate: wr.rate,
          pnl:     totalR,
          avgWin:  winR.length  ? winR.reduce((a, b)  => a + b, 0) / winR.length  : 0,
          avgLoss: lossR.length ? lossR.reduce((a, b) => a + b, 0) / lossR.length : 0,
          profitFactor: null,
        };
      });
  }

  // ── Export / import (included in Settings backup) ────────────────────────────

  function exportLog() { return getLog(); }

  function importLog(data) {
    if (Array.isArray(data)) saveLog(data);
  }

  return {
    isActive, toggle, getLog, getCurrent, setDownside, deleteEntry, getDownside,
    toR, fmt, fmtR, fmtAgg, pnlLabel, sumR,
    groupByR, equityCurveR, dailyPnlR, byHourR, byDowR, monthlyBreakdownR,
    exportLog, importLog,
  };
})();
