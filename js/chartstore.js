// IndexedDB persistence for trade chart data (OHLCV + fill markers, or attached images)

const ChartStore = (() => {
  const DB_NAME    = 'trade-analyser';
  const STORE_NAME = 'charts';

  function openDB() {
    return new Promise((res, rej) => {
      // Open at current version (app.js manages version/upgrade)
      const req = indexedDB.open(DB_NAME);
      req.onsuccess = e => res(e.target.result);
      req.onerror   = e => rej(e.target.error);
    });
  }

  async function saveChart(id, data) {
    const db = await openDB();
    return new Promise((res, rej) => {
      const tx  = db.transaction(STORE_NAME, 'readwrite');
      const req = tx.objectStore(STORE_NAME).put({ ...data, id }, id);
      req.onsuccess = () => res();
      req.onerror   = () => rej(req.error);
    });
  }

  async function loadChart(id) {
    const db = await openDB();
    return new Promise((res, rej) => {
      const tx  = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(id);
      req.onsuccess = () => res(req.result || null);
      req.onerror   = () => rej(req.error);
    });
  }

  async function deleteChart(id) {
    const db = await openDB();
    return new Promise((res, rej) => {
      const tx  = db.transaction(STORE_NAME, 'readwrite');
      const req = tx.objectStore(STORE_NAME).delete(id);
      req.onsuccess = () => res();
      req.onerror   = () => rej(req.error);
    });
  }

  async function hasChart(id) {
    const data = await loadChart(id);
    return !!data;
  }

  return { saveChart, loadChart, deleteChart, hasChart };
})();
