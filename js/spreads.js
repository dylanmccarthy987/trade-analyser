// Manages manual spread groupings — stored in localStorage
// A spread links 2+ completed tradeIds into one combined display row

const Spreads = (() => {
  const KEY = 'ta_spreads';

  function loadAll() {
    try { return JSON.parse(localStorage.getItem(KEY) || '{}'); }
    catch { return {}; }
  }

  function saveAll(data) {
    localStorage.setItem(KEY, JSON.stringify(data));
  }

  // Returns the spread object a tradeId belongs to, or null
  function getSpreadFor(tradeId) {
    const all = loadAll();
    for (const [spreadId, spread] of Object.entries(all)) {
      if (spread.tradeIds.includes(tradeId)) return { spreadId, ...spread };
    }
    return null;
  }

  // Create a new spread from an array of tradeIds
  function merge(tradeIds) {
    const all = loadAll();
    const spreadId = 'spread_' + Date.now();
    all[spreadId] = { tradeIds: [...tradeIds], createdAt: Date.now() };
    saveAll(all);
    return spreadId;
  }

  // Delete a spread (restores individual trades)
  function unmerge(spreadId) {
    const all = loadAll();
    delete all[spreadId];
    saveAll(all);
  }

  // Build a synthetic combined trade object from a set of trades
  function buildSpreadTrade(trades, spreadId, spread) {
    const totalPnl = trades.reduce((s, t) => s + (t.pnlEUR ?? 0), 0);

    const earliest = trades.reduce((a, b) => (a.openTime?.valueOf() ?? 0) < (b.openTime?.valueOf() ?? 0) ? a : b);
    const latest   = trades.reduce((a, b) => (a.closeTime?.valueOf() ?? 0) > (b.closeTime?.valueOf() ?? 0) ? a : b);

    // Helper: extract contract month suffix e.g. "MAY26" → "May26"
    const fmtMonth = product => {
      const m = product.match(/\s+((?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\d{2})$/i);
      return m ? m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase() : '';
    };

    const isCalendar   = trades.every(t => t.baseProduct === trades[0].baseProduct);
    const isBrentWTI   = trades.length === 2 &&
      trades.some(t => /brent/i.test(t.baseProduct)) &&
      trades.some(t => /wti/i.test(t.baseProduct));
    const isBrentDubai = trades.length === 2 &&
      trades.some(t => /brent/i.test(t.baseProduct)) &&
      trades.some(t => /dubai/i.test(t.baseProduct));

    let spreadName;
    if (isCalendar) {
      // Earlier contract month first
      const byTime = [...trades].sort((a, b) => (a.openTime?.valueOf() ?? 0) - (b.openTime?.valueOf() ?? 0));
      const months = byTime.map(t => fmtMonth(t.product)).filter(Boolean);
      spreadName = months.length === byTime.length
        ? `${trades[0].baseProduct} ${months.join('-')}`
        : [...new Set(byTime.map(t => t.product))].join(' / ');
    } else if (isBrentWTI) {
      const month = fmtMonth(trades[0].product);
      spreadName = month ? `ICE Brent-WTI ${month}` : 'ICE Brent-WTI';
    } else if (isBrentDubai) {
      const month = fmtMonth(trades[0].product);
      spreadName = month ? `ICE Brent-Dubai 1st Line ${month}` : 'ICE Brent-Dubai 1st Line';
    } else {
      // Alphabetical for all other outright spreads
      spreadName = [...new Set(trades.map(t => t.product))].sort().join(' / ');
    }

    // Lot size: if all legs are equal use that number; otherwise use the front leg (opened first).
    // Summing legs double-counts — 80 Brent + 80 WTI is an 80-lot spread, not 160.
    const allSameSize = trades.every(t => t.totalContracts === trades[0].totalContracts);
    const spreadContracts = allSameSize ? trades[0].totalContracts : earliest.totalContracts;

    return {
      tradeId:        spreadId,
      isSpread:       true,
      spreadId,
      spreadTradeIds: spread.tradeIds,
      product:        spreadName,
      baseProduct:    spreadName,
      direction:      'spread',
      totalContracts: spreadContracts,
      avgEntry:       null,
      avgExit:        null,
      openTime:       earliest.openTime,
      closeTime:      latest.closeTime,
      pnlEUR:         totalPnl,
      assetClass:     trades[0]?.assetClass ?? '',
      // Inherit strategy/substrategy from whichever leg has it — don't rely on
      // leg order, which depends on the order trades were selected for merging.
      strategy:       trades.map(t => t.strategy).find(s => s)    ?? '',
      substrategy:    trades.map(t => t.substrategy).find(s => s) ?? '',
      notes:          trades.map(t => t.notes).filter(Boolean).join(' | '),
      // Inherit highest topOpp tier from any leg (month > week > none)
      topOpp: (() => {
        if (trades.some(t => t.topOpp === 'month')) return 'month';
        if (trades.some(t => t.topOpp === 'week'))  return 'week';
        return '';
      })(),
      isOpen:         false,
    };
  }

  function exportAll() {
    return loadAll();
  }

  function importAll(data) {
    if (data && typeof data === 'object') {
      const existing = loadAll();
      saveAll({ ...existing, ...data });
    }
  }

  return { loadAll, getSpreadFor, merge, unmerge, buildSpreadTrade, exportAll, importAll };
})();
