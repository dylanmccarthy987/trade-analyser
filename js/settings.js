// Settings tab — lets user configure asset class, currency, and multiplier per product
// All settings stored in localStorage under 'ta_product_config'

const Settings = (() => {
  const STORAGE_KEY      = 'ta_product_config';
  const AC_STORAGE_KEY   = 'ta_asset_classes';
  const LAST_EXPORT_KEY    = 'ta_last_export_ts';
  const BACKUP_HANDLE_KEY  = 'ta_backup_handle';
  const BACKUP_NAME_KEY    = 'ta_backup_name';
  const BACKUP_WRITTEN_KEY = 'ta_backup_written';

  const DEFAULT_ASSET_CLASSES = [
    'Energy', 'Metals', 'Equity Index', 'Livestock',
    'Softs', 'Agriculture', 'FX', 'Rates', 'Other',
  ];

  const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'JPY', 'AUD', 'CHF'];

  function loadAssetClasses() {
    try {
      const saved = JSON.parse(localStorage.getItem(AC_STORAGE_KEY) || 'null');
      return Array.isArray(saved) ? saved : [...DEFAULT_ASSET_CLASSES];
    } catch { return [...DEFAULT_ASSET_CLASSES]; }
  }

  function saveAssetClasses(list) {
    localStorage.setItem(AC_STORAGE_KEY, JSON.stringify(list));
  }

  function loadUserConfig() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
    catch { return {}; }
  }

  function saveUserConfig(cfg) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
  }

  function getUserSpec(baseProduct) {
    const cfg = loadUserConfig();
    return cfg[baseProduct] || null;
  }

  function render() {
    const el           = document.getElementById('tab-settings');
    const cfg          = loadUserConfig();
    const assetClasses = loadAssetClasses().sort((a, b) => a.localeCompare(b));
    const backupName   = localStorage.getItem(BACKUP_NAME_KEY) || '';
    const lastWritten  = localStorage.getItem(BACKUP_WRITTEN_KEY) || '';

    const seenProducts = new Set([
      ...App.state.trades.map(t => t.baseProduct),
      ...App.state.openTrades.map(t => t.baseProduct),
      ...Object.keys(cfg),
    ]);

    // Aggregate P&L accounting for spread groupings:
    // legs attributed to a spread are excluded from individual product P&L
    const allSpreads      = Spreads.loadAll();
    const spreadMemberIds = new Set(Object.values(allSpreads).flatMap(s => s.tradeIds));
    const tradeById       = Object.fromEntries(App.state.trades.map(t => [t.tradeId, t]));

    const pnlByProduct = {};
    for (const t of App.state.trades) {
      if (spreadMemberIds.has(t.tradeId)) continue;
      if (t.baseProduct && t.pnlEUR !== null) {
        pnlByProduct[t.baseProduct] = (pnlByProduct[t.baseProduct] ?? 0) + t.pnlEUR;
      }
    }

    const spreadPnlRows = [];
    for (const [spreadId, spread] of Object.entries(allSpreads)) {
      const legs = spread.tradeIds.map(id => tradeById[id]).filter(Boolean);
      if (!legs.length) continue;
      const syn = Spreads.buildSpreadTrade(legs, spreadId, spread);
      if (syn.pnlEUR !== null) spreadPnlRows.push({ product: syn.product, pnlEUR: syn.pnlEUR });
    }

    const rows = [...seenProducts].sort().map(product => {
      const userSpec    = cfg[product] || {};
      const defaultSpec = getContractSpec(product);
      const assetClass  = userSpec.assetClass  || defaultSpec.assetClass  || 'Other';
      const currency    = userSpec.currency    || defaultSpec.currency    || 'USD';
      const multiplier  = userSpec.multiplier  !== undefined ? userSpec.multiplier : defaultSpec.multiplier;
      const isOverridden = !!cfg[product];

      const productPnl = pnlByProduct[product];
      const pnlCls     = productPnl === undefined ? '' : productPnl >= 0 ? 'color:var(--green)' : 'color:var(--red)';
      const pnlDisplay = productPnl === undefined
        ? '<span style="color:var(--muted)">—</span>'
        : `<span style="font-family:var(--font-mono);font-weight:600;${pnlCls}">${fmtEUR(productPnl)}</span>`;

      // If the saved asset class isn't in the current list, add it as an option so it doesn't disappear
      const classOptions = assetClasses.includes(assetClass)
        ? assetClasses
        : [...assetClasses, assetClass];

      return `<tr data-product="${escHtml(product)}">
        <td style="font-weight:500">${escHtml(product)} ${isOverridden ? '<span class="saved-badge">saved</span>' : ''}</td>
        <td>
          <select class="log-filter setting-class" style="width:140px">
            ${classOptions.map(c =>
              `<option value="${escHtml(c)}" ${c === assetClass ? 'selected' : ''}>${escHtml(c)}</option>`
            ).join('')}
          </select>
        </td>
        <td>
          <select class="log-filter setting-currency" style="width:80px">
            ${CURRENCIES.map(c =>
              `<option value="${c}" ${c === currency ? 'selected' : ''}>${c}</option>`
            ).join('')}
          </select>
        </td>
        <td>
          <input type="number" class="log-filter setting-multiplier" value="${multiplier}"
            style="width:100px" min="0" step="any">
        </td>
        <td>${pnlDisplay}</td>
        <td>
          <button class="btn-save-row tag-btn">Save</button>
          ${isOverridden ? `<button class="btn-reset-row tag-btn" style="margin-left:6px;color:var(--red)">Reset</button>` : ''}
        </td>
      </tr>`;
    });

    // Asset class chips
    const chips = assetClasses.map(c => `
      <span class="ac-chip">
        ${escHtml(c)}
        <button class="ac-remove" data-class="${escHtml(c)}" title="Remove">&times;</button>
      </span>`).join('');

    el.innerHTML = `
      <div style="max-width:900px">

        <div class="settings-section">
          <h2 class="settings-heading">Script Backup</h2>
          <p style="color:var(--muted);font-size:13px;margin-bottom:12px">
            Writes a full backup to a fixed file on disk. Run <code>send-backup.ps1</code> to email it
            and create a dated rolling copy in your <em>Tag Backups</em> folder.
          </p>
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px">
            <button id="set-backup-loc-btn" class="btn-secondary">Set backup location</button>
            <span style="color:var(--muted);font-size:13px">${backupName ? escHtml(backupName) : 'No location set'}</span>
          </div>
          <div style="display:flex;align-items:center;gap:12px">
            <button id="write-backup-btn" class="btn-apply" ${!backupName ? 'disabled' : ''}>Write backup now</button>
            <span id="backup-write-status" style="font-size:13px;color:var(--muted)">
              ${lastWritten ? 'Last written: ' + dayjs(+lastWritten).format('DD MMM HH:mm') : ''}
            </span>
          </div>
        </div>

        <div class="settings-section">
          <h2 class="settings-heading">Import / Export</h2>
          ${exportWarningHTML()}
          <p style="color:var(--muted);font-size:13px;margin-bottom:12px">
            Exports everything — product settings, asset classes, strategy tags, and spread groupings — into one file.
            Tags are also backed up automatically in the browser, but a file export is the only copy
            that survives if you clear browser data or switch browsers.
          </p>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <button id="settings-export-btn" class="btn-apply">Export All</button>
            <label class="btn-secondary" style="cursor:pointer;padding:5px 12px;font-size:13px">
              Import All
              <input type="file" id="settings-import-input" accept=".json" style="display:none">
            </label>
            <span id="settings-import-status" style="font-size:12px;color:var(--muted)"></span>
          </div>
        </div>

        <div class="settings-section">
          <h2 class="settings-heading">Daily Downside (R)</h2>
          <p style="color:var(--muted);font-size:13px;margin-bottom:14px">
            R = P&amp;L &divide; daily downside. Set your current downside and save — the app logs
            the date automatically. Each trade uses whichever value was active on its date.
          </p>
          <div style="display:flex;gap:8px;align-items:center;margin-bottom:16px">
            <span style="color:var(--muted);font-size:13px">Current: €</span>
            <input type="number" id="r-downside-input" class="log-filter"
              value="${RMode.getCurrent() ?? ''}" placeholder="10000" style="width:120px" min="0" step="100">
            <button id="r-downside-save" class="btn-apply">Save</button>
            <span id="r-downside-status" style="font-size:12px;color:var(--muted)"></span>
          </div>
          ${rDownsideHistoryHTML()}
        </div>

        <div class="settings-section">
          <h2 class="settings-heading">Asset Classes</h2>
          <p style="color:var(--muted);font-size:13px;margin-bottom:12px">
            These appear in the Asset Class dropdown for every product. Add or remove as needed.
          </p>
          <div class="ac-chip-row" id="ac-chip-row">${chips}</div>
          <div style="display:flex;gap:8px;margin-top:10px;align-items:center">
            <input id="ac-new-input" class="log-search" placeholder="New asset class…" style="width:200px">
            <button id="ac-add-btn" class="btn-apply">Add</button>
            <button id="ac-reset-btn" class="btn-secondary" style="font-size:11px">Reset to defaults</button>
          </div>
        </div>

        <div class="settings-section">
          <h2 class="settings-heading">Product Settings</h2>
          <p style="color:var(--muted);font-size:13px;margin-bottom:14px">
            Set the asset class, currency, and contract multiplier for each product in your fills.
            Multiplier = how many currency units a 1-point move is worth per lot
            (e.g. Gasoil = 100, Gold = 100, Brent = 1000).
            Changes apply immediately after saving.
          </p>
          ${seenProducts.size === 0 ? `
            <div class="empty-state">Load a CSV file first — products will appear here automatically.</div>
          ` : `
            <div class="trade-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Asset Class</th>
                    <th>Currency</th>
                    <th>Multiplier</th>
                    <th>P&amp;L (loaded data)</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                ${rows.join('')}
                ${spreadPnlRows.map(s => {
                  const cls = s.pnlEUR >= 0 ? 'color:var(--green)' : 'color:var(--red)';
                  return `<tr class="spread-row">
                    <td colspan="4" style="font-style:italic;color:var(--muted)">
                      <span class="spread-badge" style="margin-right:6px">SPREAD</span>${escHtml(s.product)}
                    </td>
                    <td><span style="font-family:var(--font-mono);font-weight:600;${cls}">${fmtEUR(s.pnlEUR)}</span></td>
                    <td></td>
                  </tr>`;
                }).join('')}
              </tbody>
              </table>
            </div>
            <p style="color:var(--muted);font-size:11px;margin-top:12px">
              "Reset" removes your override and restores the built-in default.
            </p>
          `}
        </div>

      </div>
    `;

    bindBackupControls();
    bindImportExport();
    bindAssetClassControls();
    bindRowButtons();
    bindRDownside();
  }

  function exportWarningHTML() {
    const lastTs  = parseInt(localStorage.getItem(LAST_EXPORT_KEY) || '0', 10);
    const tagCnt  = Tags.tagCount();
    if (!tagCnt) return ''; // no tags yet — nothing to warn about

    if (!lastTs) {
      return `<div class="export-warning">
        &#9888;&nbsp; You have <strong>${tagCnt} tagged trade${tagCnt !== 1 ? 's' : ''}</strong> with no file backup yet.
        Click <strong>Export All</strong> now to create one.
      </div>`;
    }

    const daysSince = Math.floor((Date.now() - lastTs) / 86_400_000);
    if (daysSince >= 7) {
      return `<div class="export-warning">
        &#9888;&nbsp; Last backup was <strong>${daysSince} day${daysSince !== 1 ? 's' : ''} ago</strong>
        (${tagCnt} tagged trade${tagCnt !== 1 ? 's' : ''}).
        Consider exporting again so your tags are safe.
      </div>`;
    }

    const ago = daysSince === 0 ? 'today' : daysSince === 1 ? 'yesterday' : `${daysSince} days ago`;
    return `<div style="font-size:12px;color:var(--green);margin-bottom:10px">
      &#10003;&nbsp; Last backup ${ago} &mdash; ${tagCnt} tagged trade${tagCnt !== 1 ? 's' : ''}.
    </div>`;
  }

  function bindImportExport() {
    document.getElementById('settings-export-btn').addEventListener('click', async () => {
      const payload = {
        productConfig: loadUserConfig(),
        assetClasses:  loadAssetClasses(),
        tags:          Tags.exportAll(),
        spreads:       Spreads.exportAll(),
        attempts:      Attempts.exportAll(),
        rLog:          RMode.exportLog(),
      };
      const json = JSON.stringify(payload, null, 2);

      // Use Save As dialog if the browser supports it (Chrome/Edge), otherwise
      // fall back to a regular download that goes to the Downloads folder.
      if ('showSaveFilePicker' in window) {
        try {
          const handle = await window.showSaveFilePicker({
            suggestedName: 'trade-analyser-backup.json',
            types: [{ description: 'JSON backup', accept: { 'application/json': ['.json'] } }],
          });
          const writable = await handle.createWritable();
          await writable.write(json);
          await writable.close();
          localStorage.setItem(LAST_EXPORT_KEY, String(Date.now()));
          render();
          return;
        } catch (e) {
          if (e.name === 'AbortError') return; // user cancelled — don't fall through
          // Any other error: fall through to the download fallback
        }
      }

      // Fallback: trigger a normal browser download
      const blob = new Blob([json], { type: 'application/json' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = 'trade-analyser-backup.json';
      a.click();
      URL.revokeObjectURL(url);
      localStorage.setItem(LAST_EXPORT_KEY, String(Date.now()));
      render();
    });

    document.getElementById('settings-import-input').addEventListener('change', e => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = evt => {
        const status = document.getElementById('settings-import-status');
        try {
          const payload = JSON.parse(evt.target.result);
          if (payload.productConfig) localStorage.setItem(STORAGE_KEY,    JSON.stringify(payload.productConfig));
          if (payload.assetClasses)  localStorage.setItem(AC_STORAGE_KEY, JSON.stringify(payload.assetClasses));
          if (payload.tags)          Tags.importAll(payload.tags);
          if (payload.spreads)       Spreads.importAll(payload.spreads);
          if (payload.attempts)      Attempts.importAll(payload.attempts);
          if (payload.rLog)          RMode.importLog(payload.rLog);
          Analytics.invalidateCache();
          App.reprocessTrades();
          render();
          status.textContent = 'Imported successfully.';
          status.style.color = 'var(--green)';
        } catch {
          status.textContent = 'Import failed — invalid file.';
          status.style.color = 'var(--red)';
        }
      };
      reader.readAsText(file);
      e.target.value = '';
    });
  }

  function bindAssetClassControls() {
    // Remove chip
    document.querySelectorAll('.ac-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        const cls = btn.dataset.class;
        const list = loadAssetClasses().filter(c => c !== cls);
        saveAssetClasses(list);
        render();
      });
    });

    // Add new
    const input  = document.getElementById('ac-new-input');
    const addBtn = document.getElementById('ac-add-btn');

    const doAdd = () => {
      const val = input.value.trim();
      if (!val) return;
      const list = loadAssetClasses();
      if (!list.includes(val)) {
        list.push(val);
        saveAssetClasses(list);
      }
      render();
    };

    addBtn.addEventListener('click', doAdd);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') doAdd(); });

    // Reset to defaults
    document.getElementById('ac-reset-btn').addEventListener('click', () => {
      saveAssetClasses([...DEFAULT_ASSET_CLASSES]);
      render();
    });
  }

  function bindRowButtons() {
    document.querySelectorAll('#tab-settings .btn-save-row').forEach(btn => {
      btn.addEventListener('click', () => {
        const row        = btn.closest('tr');
        const product    = row.dataset.product;
        const assetClass = row.querySelector('.setting-class').value;
        const currency   = row.querySelector('.setting-currency').value;
        const multiplier = parseFloat(row.querySelector('.setting-multiplier').value);

        const cfg = loadUserConfig();
        cfg[product] = { assetClass, currency, multiplier };
        saveUserConfig(cfg);

        App.reprocessTrades();
        render();
      });
    });

    document.querySelectorAll('#tab-settings .btn-reset-row').forEach(btn => {
      btn.addEventListener('click', () => {
        const product = btn.closest('tr').dataset.product;
        const cfg = loadUserConfig();
        delete cfg[product];
        saveUserConfig(cfg);
        App.reprocessTrades();
        render();
      });
    });
  }

  function rDownsideHistoryHTML() {
    const log = RMode.getLog();
    if (!log.length) return `<div style="color:var(--muted);font-size:12px">No downside set yet.</div>`;
    return `<table class="stats-table" style="font-size:12px;max-width:440px">
      <thead><tr><th>Date Set</th><th>Daily Downside</th><th></th></tr></thead>
      <tbody>
        ${[...log].reverse().map((e, i) => `<tr>
          <td class="mono">${dayjs(e.from).format('DD MMM YYYY')}</td>
          <td class="mono">€${e.value.toLocaleString()}</td>
          <td><button class="tag-btn r-delete-entry" data-idx="${log.length - 1 - i}" style="color:var(--red)" title="Delete">&#10006;</button></td>
        </tr>`).join('')}
      </tbody>
    </table>`;
  }

  function bindRDownside() {
    const input  = document.getElementById('r-downside-input');
    const saveBtn = document.getElementById('r-downside-save');
    const status = document.getElementById('r-downside-status');
    if (!saveBtn) return;

    saveBtn.addEventListener('click', () => {
      const val = parseFloat(input?.value);
      if (!val || val <= 0) { status.textContent = 'Enter a valid amount'; status.style.color = 'var(--red)'; return; }
      RMode.setDownside(val);
      Analytics.invalidateCache();
      status.textContent = 'Saved';
      status.style.color = 'var(--green)';
      setTimeout(() => render(), 600);
    });

    document.querySelectorAll('.r-delete-entry').forEach(btn => {
      btn.addEventListener('click', () => {
        RMode.deleteEntry(parseInt(btn.dataset.idx));
        Analytics.invalidateCache();
        render();
      });
    });
  }

  function _openIDB() {
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

  function _idbGet(db, key) {
    return new Promise((res, rej) => {
      const tx = db.transaction('store', 'readonly');
      const req = tx.objectStore('store').get(key);
      req.onsuccess = () => res(req.result);
      req.onerror   = () => rej(req.error);
    });
  }

  function _idbSet(db, key, val) {
    return new Promise((res, rej) => {
      const tx = db.transaction('store', 'readwrite');
      const req = tx.objectStore('store').put(val, key);
      req.onsuccess = () => res();
      req.onerror   = () => rej(req.error);
    });
  }

  function bindBackupControls() {
    const setBtn   = document.getElementById('set-backup-loc-btn');
    const writeBtn = document.getElementById('write-backup-btn');
    if (!setBtn || !writeBtn) return;

    setBtn.addEventListener('click', async () => {
      if (!('showSaveFilePicker' in window)) {
        alert('Your browser does not support the File System Access API. Use Chrome or Edge.');
        return;
      }
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: 'trade-analyser-backup.json',
          types: [{ description: 'JSON backup', accept: { 'application/json': ['.json'] } }],
        });
        const db = await _openIDB();
        await _idbSet(db, BACKUP_HANDLE_KEY, handle);
        localStorage.setItem(BACKUP_NAME_KEY, handle.name);
        render();
      } catch (e) {
        if (e.name !== 'AbortError') console.error('[Settings] Set backup location error:', e);
      }
    });

    writeBtn.addEventListener('click', async () => {
      const statusEl = document.getElementById('backup-write-status');
      try {
        const db     = await _openIDB();
        const handle = await _idbGet(db, BACKUP_HANDLE_KEY);
        if (!handle) { alert('Set a backup location first.'); return; }

        const perm    = await handle.queryPermission({ mode: 'readwrite' });
        const granted = perm === 'granted'
          ? 'granted'
          : await handle.requestPermission({ mode: 'readwrite' });
        if (granted !== 'granted') { alert('Write permission denied.'); return; }

        const payload = {
          productConfig: loadUserConfig(),
          assetClasses:  loadAssetClasses(),
          tags:          Tags.exportAll(),
          spreads:       Spreads.exportAll(),
          attempts:      Attempts.exportAll(),
          rLog:          RMode.exportLog(),
        };
        const writable = await handle.createWritable();
        await writable.write(JSON.stringify(payload, null, 2));
        await writable.close();
        localStorage.setItem(BACKUP_WRITTEN_KEY, String(Date.now()));
        if (statusEl) { statusEl.textContent = 'Written ✓'; statusEl.style.color = 'var(--green)'; }
        setTimeout(() => render(), 1500);
      } catch (e) {
        console.error('[Settings] Write backup error:', e);
        if (statusEl) { statusEl.textContent = 'Write failed — see console'; statusEl.style.color = 'var(--red)'; }
      }
    });
  }

  function escHtml(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  return { render, loadUserConfig, getUserSpec };
})();
