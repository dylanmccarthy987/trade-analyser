// Manages manual attempt groupings — same-product, same-direction repeated entries
// merged into one combined display row. Parallel to spreads.js.

const Attempts = (() => {
  const KEY = 'ta_attempts';

  function loadAll() {
    try { return JSON.parse(localStorage.getItem(KEY) || '{}'); }
    catch { return {}; }
  }

  function saveAll(data) {
    localStorage.setItem(KEY, JSON.stringify(data));
  }

  // Create a new attempt group from an array of tradeIds
  function merge(tradeIds) {
    const all = loadAll();
    const attemptId = 'attempt_' + Date.now();
    all[attemptId] = { tradeIds: [...tradeIds], createdAt: Date.now() };
    saveAll(all);
    return attemptId;
  }

  // Delete an attempt group (restores individual trades)
  function unmerge(attemptId) {
    const all = loadAll();
    delete all[attemptId];
    saveAll(all);
  }

  // Build a synthetic combined trade object from a set of attempt legs
  function buildAttemptTrade(trades, attemptId) {
    const pnlEUR = trades.every(t => t.pnlEUR !== null)
      ? trades.reduce((s, t) => s + t.pnlEUR, 0)
      : null;

    const byOpen  = [...trades].sort((a, b) => (a.openTime?.valueOf()  ?? 0) - (b.openTime?.valueOf()  ?? 0));
    const byClose = [...trades].sort((a, b) => (b.closeTime?.valueOf() ?? 0) - (a.closeTime?.valueOf() ?? 0));
    const first   = byOpen[0];
    const last    = byClose[0];

    // Lots: use the largest single entry (best representation of sizing intent)
    const totalContracts = Math.max(...trades.map(t => t.totalContracts ?? 0));

    return {
      tradeId:        attemptId,
      attemptId,
      isAttempt:      true,
      product:        first.product,
      baseProduct:    first.baseProduct,
      direction:      first.direction,   // preserved — all legs must be same direction
      assetClass:     first.assetClass ?? '',
      totalContracts,
      avgEntry:       null,
      avgExit:        null,
      openTime:       first.openTime,
      closeTime:      last.closeTime,
      pnlEUR,
      strategy:       trades.map(t => t.strategy).find(Boolean)    ?? '',
      substrategy:    trades.map(t => t.substrategy).find(Boolean) ?? '',
      notes:          trades.map(t => t.notes).filter(Boolean).join(' | '),
      topOpp: (() => {
        if (trades.some(t => t.topOpp === 'month')) return 'month';
        if (trades.some(t => t.topOpp === 'week'))  return 'week';
        return '';
      })(),
      isOpen: false,
    };
  }

  function exportAll() { return loadAll(); }

  function importAll(data) {
    if (data && typeof data === 'object') {
      const existing = loadAll();
      saveAll({ ...existing, ...data });
    }
  }

  return { loadAll, merge, unmerge, buildAttemptTrade, exportAll, importAll };
})();
