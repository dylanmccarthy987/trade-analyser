// Persists trade tags (strategy, substrategy, notes).
//
// Storage architecture — four independent layers, all written on every change:
//   1. IndexedDB 'tags' store  (primary; async; survives browser restarts)
//   2. localStorage slot 0  ──┐
//   3. localStorage slot 1    ├─ three rotating synchronous copies written
//   4. localStorage slot 2  ──┘  in round-robin so one failed write never
//                                 eliminates the most recent backup
//
// Every cache entry carries a _ts (Unix ms) timestamp so that when multiple
// sources are merged on startup the newest edit wins — not an arbitrary source.
//
// The in-memory _cache is the single source of truth at runtime; all storage
// writes are derived from it.

const Tags = (() => {
  const IDB_STORE  = 'tags';
  const IDB_KEY    = '__tags__';
  const LEGACY_KEY = 'ta_trade_tags';          // old key kept for one-time migration
  const LS_SLOTS   = ['ta_tags_0', 'ta_tags_1', 'ta_tags_2'];
  const LS_IDX_KEY = 'ta_tags_slot';           // index of the slot written last
  const LS_LEGACY2 = 'ta_tags_ls';             // single-slot key from a prior version — read on startup only

  let _cache   = {};   // { [tradeId]: { strategy, substrategy, notes, _ts } }
  let _slotIdx = 0;    // which LS slot gets the next write

  // ── IndexedDB ────────────────────────────────────────────────────────────────

  function _openDB() {
    return new Promise((res, rej) => {
      const req = indexedDB.open('trade-analyser', 3);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('store'))  db.createObjectStore('store');
        if (!db.objectStoreNames.contains('tags'))   db.createObjectStore('tags');
        if (!db.objectStoreNames.contains('charts')) db.createObjectStore('charts');
      };
      req.onsuccess = e => res(e.target.result);
      req.onerror   = () => rej(req.error);
    });
  }

  async function _persist() {
    try {
      const db = await _openDB();
      await new Promise((res, rej) => {
        const tx  = db.transaction(IDB_STORE, 'readwrite');
        const req = tx.objectStore(IDB_STORE).put(_cache, IDB_KEY);
        req.onsuccess = () => res();
        req.onerror   = () => rej(req.error);
      });
    } catch (e) {
      console.warn('[Tags] IDB persist failed:', e);
    }
  }

  // ── Synchronous localStorage backup ─────────────────────────────────────────

  // Writes _cache to the next slot in round-robin order.
  // Runs synchronously inside set() so data is safe even if the tab closes
  // immediately afterwards, before the async IDB write can complete.
  function _syncLS() {
    try {
      _slotIdx = (_slotIdx + 1) % LS_SLOTS.length;
      localStorage.setItem(LS_SLOTS[_slotIdx], JSON.stringify(_cache));
      localStorage.setItem(LS_IDX_KEY, String(_slotIdx));
    } catch {
      // Quota exceeded: try the other slots — they may have room.
      for (let i = 1; i < LS_SLOTS.length; i++) {
        try {
          const s = (_slotIdx + i) % LS_SLOTS.length;
          localStorage.setItem(LS_SLOTS[s], JSON.stringify(_cache));
          break;
        } catch {}
      }
    }
  }

  // Loads all LS slots (three rotating + the legacy single slot) and returns valid
  // cache objects, null for slots that are missing or corrupt.
  function _loadLS() {
    const keys = [...LS_SLOTS, LS_LEGACY2];
    return keys.map(key => {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        const p = JSON.parse(raw);
        return (p && typeof p === 'object') ? p : null;
      } catch { return null; }
    });
  }

  // ── Merge logic ──────────────────────────────────────────────────────────────

  // Merges any number of cache objects into one.
  // For the same tradeId in multiple sources, the entry with the highest _ts wins.
  // If neither has a _ts (legacy data), the first non-null value is kept.
  // A key present in ANY source is included — tags are never silently discarded.
  function _mergeAll(...sources) {
    const merged = {};
    for (const src of sources) {
      if (!src || typeof src !== 'object') continue;
      for (const [id, tag] of Object.entries(src)) {
        if (!tag || typeof tag !== 'object') continue;
        const existing = merged[id];
        if (!existing) {
          merged[id] = { ...tag };
        } else {
          // Newer timestamp wins; ties keep the already-merged version.
          if ((tag._ts || 0) > (existing._ts || 0)) {
            merged[id] = { ...tag };
          }
        }
      }
    }
    return merged;
  }

  // ── Init ─────────────────────────────────────────────────────────────────────

  async function init() {
    // Restore the slot index so we continue round-robin correctly.
    try { _slotIdx = parseInt(localStorage.getItem(LS_IDX_KEY) || '0', 10) || 0; } catch {}

    // Load IDB.
    let idbCache = null;
    try {
      const db = await _openDB();
      idbCache = await new Promise((res, rej) => {
        const tx  = db.transaction(IDB_STORE, 'readonly');
        const req = tx.objectStore(IDB_STORE).get(IDB_KEY);
        req.onsuccess = () => res(req.result);
        req.onerror   = () => rej(req.error);
      });
    } catch (e) {
      console.warn('[Tags] IDB load failed — relying on localStorage backup:', e);
    }

    // Load all three LS slots.
    const lsCaches = _loadLS();

    const haveData =
      (idbCache && typeof idbCache === 'object') ||
      lsCaches.some(c => c !== null);

    if (haveData) {
      // Merge all four sources: newest _ts wins for each tradeId.
      _cache = _mergeAll(idbCache, ...lsCaches);
      // Write the merged result back to all stores so they're consistent.
      _syncLS();
      await _persist();
      localStorage.removeItem(LEGACY_KEY);
      return;
    }

    // Nothing in any store — try one-time migration from the old localStorage key.
    try {
      const ls = JSON.parse(localStorage.getItem(LEGACY_KEY) || '{}');
      if (Object.keys(ls).length > 0) {
        _cache = ls;
        _syncLS();
        await _persist();
        localStorage.removeItem(LEGACY_KEY);
      }
    } catch (e) {
      console.warn('[Tags] Legacy migration failed:', e);
    }
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  function get(tradeId) {
    const t = _cache[tradeId];
    return t
      ? { strategy: t.strategy || '', substrategy: t.substrategy || '', notes: t.notes || '' }
      : { strategy: '', substrategy: '', notes: '' };
  }

  function set(tradeId, data) {
    _cache[tradeId] = {
      ...(_cache[tradeId] || {}),
      ...data,
      _ts: Date.now(),   // timestamp lets merge logic know this is the newest edit
    };
    _syncLS();   // synchronous — data is safe even if tab closes immediately
    _persist();  // async — durable long-term storage
  }

  // Merge tags into an array of trades (mutates in place).
  function applyToTrades(trades) {
    for (const t of trades) {
      const tag = _cache[t.tradeId];
      if (tag) {
        t.strategy    = tag.strategy    || '';
        t.substrategy = tag.substrategy || '';
        t.notes       = tag.notes       || '';
        t.topOpp      = tag.topOpp      || '';  // 'month' | 'week' | ''
      }
    }
  }

  function getSubstrategiesFor(strategy) {
    const subs = new Set();
    for (const tag of Object.values(_cache)) {
      if (tag.strategy === strategy && tag.substrategy) subs.add(tag.substrategy);
    }
    return [...subs].sort();
  }

  function getStrategies() {
    const strats = new Set(KNOWN_STRATEGIES);
    for (const tag of Object.values(_cache)) {
      if (tag.strategy) strats.add(tag.strategy);
    }
    return [...strats].sort();
  }

  // Clears a strategy from every trade that uses it.
  // Uses the current timestamp so the deletion is preserved when merging backups.
  function deleteStrategy(name) {
    const now = Date.now();
    for (const id of Object.keys(_cache)) {
      if (_cache[id].strategy === name) {
        _cache[id] = { ..._cache[id], strategy: '', substrategy: '', _ts: now };
      }
    }
    _syncLS();
    _persist();
  }

  function deleteSubstrategy(strategy, name) {
    const now = Date.now();
    for (const id of Object.keys(_cache)) {
      if (_cache[id].strategy === strategy && _cache[id].substrategy === name) {
        _cache[id] = { ..._cache[id], substrategy: '', _ts: now };
      }
    }
    _syncLS();
    _persist();
  }

  // Returns a deep copy with _ts fields stripped so backups are readable.
  function exportAll() {
    const out = {};
    for (const [id, tag] of Object.entries(_cache)) {
      out[id] = { strategy: tag.strategy || '', substrategy: tag.substrategy || '', notes: tag.notes || '', topOpp: tag.topOpp || '' };
    }
    return out;
  }

  // Imported data fills in keys that don't exist yet; existing cache always wins
  // for any tradeId already present (existing tags are newer than any backup).
  function importAll(data) {
    if (!data || typeof data !== 'object') return;
    const now = Date.now();
    const incoming = {};
    for (const [id, tag] of Object.entries(data)) {
      // Assign a past timestamp so the merge always prefers the live cache entry.
      incoming[id] = { ...tag, _ts: (tag._ts || 0) };
    }
    // Ensure every live entry has a timestamp so it beats the import.
    for (const [id, tag] of Object.entries(_cache)) {
      if (!tag._ts) _cache[id] = { ...tag, _ts: now };
    }
    _cache = _mergeAll(incoming, _cache);  // _cache passed last so its higher _ts wins
    _syncLS();
    _persist();
  }

  // Returns total number of tagged trades (for display in Settings).
  function tagCount() {
    return Object.values(_cache).filter(t => t.strategy || t.substrategy || t.notes).length;
  }

  return {
    init, get, set, applyToTrades,
    getStrategies, getSubstrategiesFor,
    deleteStrategy, deleteSubstrategy,
    exportAll, importAll, tagCount,
  };
})();
