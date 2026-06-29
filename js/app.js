// Main app: CSV loading, tab routing, date filter, global state

dayjs.extend(dayjs_plugin_customParseFormat);
dayjs.extend(dayjs_plugin_isoWeek);

const App = (() => {
  const state = {
    trades: [],
    openTrades: [],
    dateRange: { from: null, to: null }, // null = all time
    activeTab: 'overview',
    csvFileName: '',
  };

  // ── Date Filter ─────────────────────────────────────────────────────────────

  function filterTrades(trades, dateRange) {
    const { from, to } = dateRange ?? state.dateRange;
    if (!from && !to) return trades;
    return trades.filter(t => {
      const d = t.closeTime;
      if (!d) return false;
      if (from && d.isBefore(from, 'day')) return false;
      if (to   && d.isAfter(to,   'day')) return false;
      return true;
    });
  }

  function applyPreset(preset) {
    const today = dayjs();
    let from = null, to = null;

    switch (preset) {
      case 'today':      from = today; to = today; break;
      case 'yesterday':  from = today.subtract(1,'day'); to = today.subtract(1,'day'); break;
      case 'this-week':  from = today.day(0); to = today.day(6); break;
      case 'last-week':  from = today.subtract(1,'week').day(0); to = today.subtract(1,'week').day(6); break;
      case 'this-month': from = today.startOf('month'); to = today.endOf('month'); break;
      case 'last-month': from = today.subtract(1,'month').startOf('month'); to = today.subtract(1,'month').endOf('month'); break;
      case '20d':        from = today.subtract(19,'day'); to = today; break;
      case '40d':        from = today.subtract(39,'day'); to = today; break;
      case 'ytd':        from = today.startOf('year'); to = today; break;
      case 'all':        from = null; to = null; break;
    }

    state.dateRange = { from, to };
    syncDateInputs();
    renderActiveTab();
  }

  function syncDateInputs() {
    const { from, to } = state.dateRange;
    document.getElementById('date-from').value = from ? from.format('YYYY-MM-DD') : '';
    document.getElementById('date-to').value   = to   ? to.format('YYYY-MM-DD')   : '';
    // Clear custom range fields when a preset is active
    if (!from && !to) document.getElementById('date-preset-select').value = 'all';
  }

  // ── Tab Routing ──────────────────────────────────────────────────────────────

  function switchTab(tab) {
    state.activeTab = tab;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `tab-${tab}`));
    renderActiveTab();
  }

  // Returns trades with spread/attempt legs replaced by their synthetic combined trade.
  // Used by Overview and Analytics so spreads/attempts appear as one row with combined P&L.
  // TradeLog handles this itself in buildDisplayRows().
  //
  // Supports spread-based attempts (where attempt.tradeIds contains spreadIds).
  // All-or-nothing: broken spreads/attempts are skipped, legs remain as individual trades.
  function getMergedTrades() {
    const allSpreads  = Spreads.loadAll();
    const allAttempts = Attempts.loadAll();
    if (!Object.keys(allSpreads).length && !Object.keys(allAttempts).length) return state.trades;

    const byId = {};
    for (const t of state.trades) byId[t.tradeId] = t;

    const excludedIds   = new Set();
    const synthetics    = [];

    // Phase 1: Build all valid spread synthetics (needed to resolve spread-based attempt legs)
    const spreadSynthetics = {};
    for (const [spreadId, spread] of Object.entries(allSpreads)) {
      const legs = spread.tradeIds.map(id => byId[id]);
      if (!legs.every(Boolean)) continue;
      const syn = Spreads.buildSpreadTrade(legs, spreadId, spread);
      Tags.applyToTrades([syn]);
      spreadSynthetics[spreadId] = syn;
    }

    // Phase 2: Identify which spreads are consumed by spread-based attempts
    const consumedSpreads = new Set();
    for (const [, attempt] of Object.entries(allAttempts)) {
      const legs = attempt.tradeIds.map(id => byId[id] || spreadSynthetics[id]);
      if (!legs.every(Boolean)) continue;
      attempt.tradeIds.forEach(id => { if (spreadSynthetics[id]) consumedSpreads.add(id); });
    }

    // Phase 3: Add non-consumed spread synthetics; exclude their raw legs
    for (const [spreadId, syn] of Object.entries(spreadSynthetics)) {
      if (consumedSpreads.has(spreadId)) continue;
      allSpreads[spreadId].tradeIds.forEach(id => excludedIds.add(id));
      synthetics.push(syn);
    }

    // Phase 4: Process attempts (trade-based and spread-based)
    for (const [attemptId, attempt] of Object.entries(allAttempts)) {
      const legs = attempt.tradeIds.map(id => byId[id] || spreadSynthetics[id]);
      if (!legs.every(Boolean)) continue;
      // Exclude all underlying raw trade IDs
      attempt.tradeIds.forEach(id => {
        if (byId[id]) {
          excludedIds.add(id);
        } else if (spreadSynthetics[id]) {
          allSpreads[id].tradeIds.forEach(rawId => excludedIds.add(rawId));
        }
      });
      const syn = Attempts.buildAttemptTrade(legs, attemptId);
      Tags.applyToTrades([syn]);
      synthetics.push(syn);
    }

    const merged = state.trades.filter(t => !excludedIds.has(t.tradeId));
    merged.push(...synthetics);
    return merged;
  }

  function renderActiveTab() {
    const merged = getMergedTrades();
    switch (state.activeTab) {
      case 'overview':  if (state.trades.length || state.openTrades.length) Overview.render(merged, state.openTrades, state.dateRange); break;
      case 'tradelog':  if (state.trades.length || state.openTrades.length) TradeLog.render(state.trades, state.openTrades, state.dateRange); break;
      case 'analytics': if (state.trades.length) Analytics.render(merged, state.dateRange); break;
      case 'topopp':    if (state.trades.length) TopOpp.render(merged, state.dateRange); break;
      case 'settings':  Settings.render(); break;
    }
  }

  // ── CSV Loading ──────────────────────────────────────────────────────────────

  const IDB_KEY      = 'ta_file_handle';
  const IDB_CSV_TEXT = 'ta_csv_text';
  const IDB_CSV_NAME = 'ta_csv_name';

  async function tryAutoLoad() {
    try {
      const db   = await openIDB();
      const text = await idbGet(db, IDB_CSV_TEXT);
      const name = await idbGet(db, IDB_CSV_NAME) || 'master.csv';
      if (!text) return false;
      // Load directly from stored text — no file system access needed
      await loadFromText(text, name);
      return true;
    } catch { return false; }
  }

  async function pickAndLoad() {
    if ('showOpenFilePicker' in window) {
      try {
        const [handle] = await window.showOpenFilePicker({
          types: [{ description: 'CSV files', accept: { 'text/csv': ['.csv', '.CSV'] } }],
          multiple: false,
        });
        const file = await handle.getFile();
        await loadFile(file);
      } catch (e) {
        if (e.name !== 'AbortError') fallbackPick();
      }
    } else {
      fallbackPick();
    }
  }

  function fallbackPick() {
    document.getElementById('file-input').click();
  }

  // Re-run parser on the last loaded text so updated product specs are applied
  async function reprocessTrades() {
    if (!state._lastCsvText) return;
    document.getElementById('csv-status').textContent = `Reprocessing…`;
    await new Promise(r => setTimeout(r, 0));
    try {
      const { completedTrades, openTrades } = Parser.parse(state._lastCsvText);
      Tags.applyToTrades(completedTrades);
      Tags.applyToTrades(openTrades);
      Commissions.applyToTrades(completedTrades);
      state.trades     = completedTrades;
      state.openTrades = openTrades;
      Analytics.invalidateCache();
      document.getElementById('csv-status').textContent = `${state.csvFileName} · ${completedTrades.length} trades`;
      await new Promise(r => setTimeout(r, 0));
      renderActiveTab();
    } catch (err) {
      console.error('[Trade Analyser] Reprocess error:', err);
      document.getElementById('csv-status').textContent = 'Reprocess failed — check console';
    }
  }

  async function loadFile(file) {
    const text = await file.text();
    // Persist CSV text to IDB so next startup is fully automatic
    const db = await openIDB();
    await idbSet(db, IDB_CSV_TEXT, text);
    await idbSet(db, IDB_CSV_NAME, file.name);
    await loadFromText(text, file.name);
  }

  async function loadFromText(text, name) {
    state._lastCsvText = text;
    state.csvFileName  = name;

    document.getElementById('csv-status').textContent = `Loading ${name}…`;
    document.getElementById('no-data-screen').classList.remove('visible');

    await new Promise(r => setTimeout(r, 0));

    try {
      const { completedTrades, openTrades } = Parser.parse(text);
      Tags.applyToTrades(completedTrades);
      Tags.applyToTrades(openTrades);
      Commissions.applyToTrades(completedTrades);
      state.trades     = completedTrades;
      state.openTrades = openTrades;
      Analytics.invalidateCache();

      document.getElementById('csv-status').textContent = `${name} · ${completedTrades.length} trades`;
      document.getElementById('fx-rate-display').textContent = FX.getRateDisplay();

      await new Promise(r => setTimeout(r, 0));

      renderActiveTab();
    } catch (err) {
      console.error('[Trade Analyser] Parse error:', err);
      document.getElementById('csv-status').textContent = `Error loading ${name} — check console`;
    }
  }

  // ── IndexedDB helpers (for FSA handle persistence) ───────────────────────────

  function openIDB() {
    return new Promise((res, rej) => {
      const req = indexedDB.open('trade-analyser', 3);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('store'))  db.createObjectStore('store');
        if (!db.objectStoreNames.contains('tags'))   db.createObjectStore('tags');
        if (!db.objectStoreNames.contains('charts')) db.createObjectStore('charts');
      };
      req.onsuccess = e => res(e.target.result);
      req.onerror   = e => rej(e);
    });
  }

  function idbGet(db, key) {
    return new Promise((res, rej) => {
      const tx = db.transaction('store', 'readonly');
      const req = tx.objectStore('store').get(key);
      req.onsuccess = () => res(req.result);
      req.onerror   = () => rej(req.error);
    });
  }

  function idbSet(db, key, val) {
    return new Promise((res, rej) => {
      const tx = db.transaction('store', 'readwrite');
      const req = tx.objectStore('store').put(val, key);
      req.onsuccess = () => res();
      req.onerror   = () => rej(req.error);
    });
  }

  // ── Init ─────────────────────────────────────────────────────────────────────

  async function init() {
    // Init trade log modal
    TradeLog.init();

    // Tab buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    // Date preset dropdown
    document.getElementById('date-preset-select').addEventListener('change', e => {
      applyPreset(e.target.value);
    });

    // Custom date range
    document.getElementById('apply-date-btn').addEventListener('click', () => {
      const from = document.getElementById('date-from').value;
      const to   = document.getElementById('date-to').value;
      state.dateRange = {
        from: from ? dayjs(from) : null,
        to:   to   ? dayjs(to)   : null,
      };
      document.getElementById('date-preset-select').value = '';
      renderActiveTab();
    });

    // R-mode toggle
    const rBtn = document.getElementById('r-toggle-btn');
    if (rBtn) {
      rBtn.classList.toggle('r-mode-active', RMode.isActive());
      rBtn.addEventListener('click', () => {
        RMode.toggle();
        rBtn.classList.toggle('r-mode-active', RMode.isActive());
        Analytics.invalidateCache();
        renderActiveTab();
      });
    }

    // CSV load buttons
    document.getElementById('load-csv-btn').addEventListener('click', pickAndLoad);
    document.getElementById('no-data-load-btn').addEventListener('click', pickAndLoad);

    // Fallback file input
    document.getElementById('file-input').addEventListener('change', e => {
      const file = e.target.files?.[0];
      if (file) loadFile(file);
    });

    // Init tags (loads from IDB, migrates from localStorage if needed)
    await Tags.init();

    // Fetch FX rates
    await FX.fetchRates();

    // Auto-load from stored CSV text — no file system permission needed
    const loaded = await tryAutoLoad();
    if (!loaded) {
      document.getElementById('no-data-screen').classList.add('visible');
    }
  }

  function setDateRange(from, to) {
    state.dateRange = { from, to };
    document.getElementById('date-from').value = from ? from.format('YYYY-MM-DD') : '';
    document.getElementById('date-to').value   = to   ? to.format('YYYY-MM-DD')   : '';
    document.getElementById('date-preset-select').value = '';
    renderActiveTab();
  }

  return { init, filterTrades, reprocessTrades, setDateRange, renderActiveTab, state };
})();

document.addEventListener('DOMContentLoaded', () => App.init());
