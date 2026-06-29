// Renders the Trade Log tab with filtering, sorting, tag modal, and spread merging

const TradeLog = (() => {
  const PAGE_SIZE = 100;

  let allTrades   = [];
  let openTrades  = [];
  let sortCol     = 'openTime';
  let sortDir     = -1;
  let filterSymbol   = '';
  let filterClass    = '';
  let filterStrategy = '';
  let searchText     = '';
  let checkedIds     = new Set();
  let spreadById     = {};
  let attemptById    = {};

  // Virtual scroll state
  let _rows          = [];
  let _renderedCount = 0;
  let _observer      = null;

  function render(trades, open, dateRange) {
    allTrades  = App.filterTrades(trades, dateRange);
    openTrades = open;
    checkedIds = new Set();
    renderTable();
  }

  function renderTable(resetCount = true) {
    const el        = document.getElementById('tab-tradelog');
    const focusId   = document.activeElement?.id || null;
    const cursorPos = document.activeElement?.selectionStart ?? null;
    const scrollTop = el.querySelector('.trade-table-wrap')?.scrollTop ?? 0;

    const filtered = applyFilters(allTrades);
    const { rows } = buildDisplayRows(filtered);
    const sorted   = sortTrades(rows);

    // Disconnect any previous scroll observer
    if (_observer) { _observer.disconnect(); _observer = null; }

    _rows          = sorted;
    // resetCount=false preserves how many rows were rendered (e.g. after merge/tag mid-scroll)
    _renderedCount = resetCount
      ? Math.min(PAGE_SIZE, _rows.length)
      : Math.min(Math.max(_renderedCount, PAGE_SIZE), _rows.length);

    const symbols    = [...new Set(allTrades.map(t => t.baseProduct))].sort();
    const classes    = [...new Set(allTrades.map(t => t.assetClass))].sort();
    const strategies = [...new Set(allTrades.map(t => t.strategy).filter(Boolean))].sort();
    const checked    = checkedIds.size;

    el.innerHTML = `
      <div class="log-controls">
        <input class="log-search" id="log-search" type="text" placeholder="Search symbol or notes…" value="${escHtml(searchText)}">
        <select class="log-filter" id="log-filter-sym">
          <option value="">All Symbols</option>
          ${symbols.map(s => `<option value="${escHtml(s)}" ${s === filterSymbol ? 'selected' : ''}>${escHtml(s)}</option>`).join('')}
        </select>
        <select class="log-filter" id="log-filter-class">
          <option value="">All Classes</option>
          ${classes.map(c => `<option value="${escHtml(c)}" ${c === filterClass ? 'selected' : ''}>${escHtml(c)}</option>`).join('')}
        </select>
        <select class="log-filter" id="log-filter-strat">
          <option value="">All Strategies</option>
          ${strategies.map(s => `<option value="${escHtml(s)}" ${s === filterStrategy ? 'selected' : ''}>${escHtml(s)}</option>`).join('')}
        </select>
        <span class="log-count">${rows.length} trade${rows.length !== 1 ? 's' : ''}</span>
      </div>

      ${openTrades.length ? `
        <div class="open-positions-banner" style="margin-bottom:14px">
          <strong>&#9888; Open positions:</strong>
          ${openTrades.map(t => `<span>${escHtml(t.product)} (${t.totalContracts} lots, ${t.direction})</span>`).join(' &nbsp;|&nbsp; ')}
        </div>` : ''}

      <div class="trade-table-wrap">
        <table id="trade-table">
          <thead>
            <tr>
              <th style="width:32px"><input type="checkbox" id="check-all" title="Select all"></th>
              ${th('openTime',       'Date/Time')}
              ${th('product',        'Contract')}
              ${th('direction',      'Dir')}
              ${th('totalContracts', 'Lots')}
              ${th('avgEntry',       'Avg Entry')}
              ${th('avgExit',        'Avg Exit')}
              ${th('pnlEUR',         'P&L (€)')}
              ${th('assetClass',     'Class')}
              ${th('strategy',       'Strategy')}
              ${th('substrategy',    'Sub-strategy')}
              <th>Notes</th>
              <th>Tag</th>
            </tr>
          </thead>
          <tbody id="trade-tbody">
            ${_rows.length
              ? _rows.slice(0, _renderedCount).map(t => t.isSpread ? spreadRow(t) : t.isAttempt ? attemptRow(t) : tradeRow(t)).join('')
              : `<tr><td colspan="13" class="empty-state">No trades match the current filters.</td></tr>`}
          </tbody>
        </table>
        <div id="tl-sentinel"></div>
      </div>

      <!-- Floating merge action bar -->
      <div id="merge-bar" class="${checked >= 1 ? 'visible' : ''}">
        <span>${checked} trade${checked !== 1 ? 's' : ''} selected</span>
        <button id="tag-selected-btn" class="btn-primary" style="padding:6px 16px;font-size:13px">
          &#9998; Tag Selected
        </button>
        <button id="merge-btn" class="btn-primary" style="padding:6px 16px;font-size:13px;${checked < 2 ? 'opacity:.4;cursor:default' : ''}">
          Merge as Spread
        </button>
        <button id="merge-attempt-btn" class="btn-primary" style="padding:6px 16px;font-size:13px;opacity:.4;cursor:default">
          Merge as Attempt
        </button>
        <button id="clear-selection-btn" class="btn-secondary" style="padding:6px 12px;font-size:13px">
          Clear
        </button>
      </div>
    `;

    bindControls();
    _setupObserver();

    const wrap = el.querySelector('.trade-table-wrap');
    if (wrap && scrollTop) wrap.scrollTop = scrollTop;

    if (focusId) {
      const el2 = document.getElementById(focusId);
      if (el2) {
        el2.focus();
        if (cursorPos !== null && el2.setSelectionRange) el2.setSelectionRange(cursorPos, cursorPos);
      }
    }
  }

  function _setupObserver() {
    const sentinel = document.getElementById('tl-sentinel');
    if (!sentinel || _renderedCount >= _rows.length) return;
    _observer = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) _appendNextPage();
    }, { rootMargin: '300px' });
    _observer.observe(sentinel);
  }

  function _appendNextPage() {
    const from = _renderedCount;
    const to   = Math.min(_renderedCount + PAGE_SIZE, _rows.length);
    if (from >= _rows.length) return;
    const tbody = document.getElementById('trade-tbody');
    if (!tbody) return;
    tbody.insertAdjacentHTML('beforeend',
      _rows.slice(from, to).map(t => t.isSpread ? spreadRow(t) : t.isAttempt ? attemptRow(t) : tradeRow(t)).join('')
    );
    _renderedCount = to;
    if (_renderedCount >= _rows.length && _observer) {
      _observer.disconnect();
      _observer = null;
    }
  }

  // Build the display row list, collapsing spread/attempt members into one synthetic row.
  //
  // Supports two attempt types:
  //   • Trade-based attempt: tradeIds are raw CSV trade IDs  → legs resolved from byId
  //   • Spread-based attempt: tradeIds are spreadIds         → legs resolved from spreadSynthetics
  //
  // All-or-nothing: spread/attempt only collapsed when ALL leg IDs resolve.
  function buildDisplayRows(trades) {
    const allSpreads  = Spreads.loadAll();
    const allAttempts = Attempts.loadAll();
    const skipIds     = new Set();
    const rows        = [];
    spreadById  = {};
    attemptById = {};

    // Index all raw trades
    const byId = {};
    for (const t of allTrades) byId[t.tradeId] = t;

    // ── Phase 1: Build all valid spread synthetics ─────────────────────────────
    // tradeSpreadMap:   raw tradeId → spreadId
    // spreadSynthetics: spreadId   → synthetic object (also stored in spreadById for modal lookups)
    const tradeSpreadMap   = {};
    const spreadSynthetics = {};

    for (const [spreadId, spread] of Object.entries(allSpreads)) {
      if (!spread.tradeIds.every(id => byId[id])) continue;
      spread.tradeIds.forEach(id => { tradeSpreadMap[id] = spreadId; });
      const syn = Spreads.buildSpreadTrade(spread.tradeIds.map(id => byId[id]), spreadId, spread);
      Tags.applyToTrades([syn]);
      spreadSynthetics[spreadId] = syn;
      spreadById[spreadId] = syn;
    }

    // ── Phase 2: Validate attempts, categorise as trade-based or spread-based ──
    // An attempt leg resolves from byId (raw trade) or spreadSynthetics (spread).
    // tradeAttemptMap:  raw tradeId → attemptId
    // spreadAttemptMap: spreadId    → attemptId
    // consumedSpreads:  spreads owned by a spread-based attempt (won't emit as spread rows)
    // validAttempts:    attemptId   → { legs, attempt }
    const tradeAttemptMap  = {};
    const spreadAttemptMap = {};
    const consumedSpreads  = new Set();
    const validAttempts    = {};

    for (const [attemptId, attempt] of Object.entries(allAttempts)) {
      const legs = attempt.tradeIds.map(id => byId[id] || spreadSynthetics[id]);
      if (!legs.every(Boolean)) continue;
      validAttempts[attemptId] = { legs, attempt };
      attempt.tradeIds.forEach(id => {
        if (byId[id]) {
          tradeAttemptMap[id] = attemptId;
        } else {
          spreadAttemptMap[id] = attemptId;
          consumedSpreads.add(id);
        }
      });
    }

    // ── Phase 3: Emit rows ─────────────────────────────────────────────────────
    const emittedSpreads  = new Set();
    const emittedAttempts = new Set();

    for (const t of trades) {
      if (skipIds.has(t.tradeId)) continue;

      const spreadId = tradeSpreadMap[t.tradeId];
      if (spreadId) {
        if (emittedSpreads.has(spreadId)) { skipIds.add(t.tradeId); continue; }

        if (consumedSpreads.has(spreadId)) {
          // This spread is owned by a spread-based attempt
          const attemptId = spreadAttemptMap[spreadId];
          if (!emittedAttempts.has(attemptId)) {
            const { legs, attempt } = validAttempts[attemptId];
            const syn = Attempts.buildAttemptTrade(legs, attemptId);
            Tags.applyToTrades([syn]);
            attemptById[attemptId] = syn;
            rows.push(syn);
            emittedAttempts.add(attemptId);
            // Skip raw trade legs of every spread in this attempt
            attempt.tradeIds.forEach(sid => {
              if (spreadSynthetics[sid]) {
                emittedSpreads.add(sid);
                allSpreads[sid].tradeIds.forEach(id => skipIds.add(id));
              }
            });
          }
          skipIds.add(t.tradeId);
          continue;
        }

        // Normal spread row
        rows.push(spreadSynthetics[spreadId]);
        allSpreads[spreadId].tradeIds.forEach(id => skipIds.add(id));
        emittedSpreads.add(spreadId);
        continue;
      }

      const attemptId = tradeAttemptMap[t.tradeId];
      if (attemptId) {
        if (emittedAttempts.has(attemptId)) { skipIds.add(t.tradeId); continue; }
        const { legs, attempt } = validAttempts[attemptId];
        const syn = Attempts.buildAttemptTrade(legs, attemptId);
        Tags.applyToTrades([syn]);
        attemptById[attemptId] = syn;
        rows.push(syn);
        attempt.tradeIds.forEach(id => skipIds.add(id));
        emittedAttempts.add(attemptId);
        continue;
      }

      rows.push(t);
    }

    return { rows, skipIds };
  }

  function th(col, label) {
    const active = sortCol === col ? ' sorted' : '';
    const arrow  = sortCol === col ? (sortDir === -1 ? ' ↓' : ' ↑') : '';
    return `<th class="${active}" data-col="${col}">${label}${arrow}</th>`;
  }

  function oppBadge(topOpp) {
    if (topOpp === 'month') return '<span class="topopp-badge month">★★ Month</span>';
    if (topOpp === 'week')  return '<span class="topopp-badge week">★ Week</span>';
    return '';
  }

  function tradeRow(t) {
    const pnl    = t.netPnlEUR ?? t.pnlEUR;
    const pnlCls = pnl > 0 ? 'pos' : pnl < 0 ? 'neg' : 'zero';
    const oppCls = t.topOpp === 'month' ? ' topopp-month' : t.topOpp === 'week' ? ' topopp-week' : '';
    const rowCls = (pnl > 0 ? 'win' : pnl < 0 ? 'loss' : '') + oppCls;
    const tagged = t.strategy || t.substrategy || t.notes;
    const dateStr  = t.openTime ? t.openTime.format('DD MMM YY HH:mm') : '—';
    const entryStr = t.avgEntry != null ? t.avgEntry.toFixed(3) : '—';
    const exitStr  = t.avgExit  != null ? t.avgExit.toFixed(3)  : '—';
    const checked  = checkedIds.has(t.tradeId);

    return `<tr class="${rowCls}" data-trade-id="${escHtml(t.tradeId)}">
      <td><input type="checkbox" class="row-check" data-id="${escHtml(t.tradeId)}" ${checked ? 'checked' : ''}></td>
      <td class="mono">${dateStr}</td>
      <td>${escHtml(t.product)}${oppBadge(t.topOpp)}</td>
      <td><span class="dir-badge ${t.direction}">${t.direction === 'long' ? 'L' : 'S'}</span></td>
      <td class="mono">${t.totalContracts}</td>
      <td class="mono">${entryStr}</td>
      <td class="mono">${exitStr}</td>
      <td class="pnl-cell ${pnlCls}">${pnl !== null ? RMode.fmt(pnl, t.openTime) : '—'}</td>
      <td>${escHtml(t.assetClass)}</td>
      <td>${escHtml(t.strategy    || '')}</td>
      <td>${escHtml(t.substrategy || '')}</td>
      <td class="mono" style="max-width:140px;overflow:hidden;text-overflow:ellipsis">${escHtml(t.notes || '')}</td>
      <td style="white-space:nowrap">
        <button class="tag-btn ${tagged ? 'tagged' : ''}" data-trade-id="${escHtml(t.tradeId)}">&#9998;</button>
      </td>
    </tr>`;
  }

  function spreadRow(t) {
    const pnl    = t.netPnlEUR ?? t.pnlEUR;
    const pnlCls = pnl > 0 ? 'pos' : pnl < 0 ? 'neg' : 'zero';
    const oppCls = t.topOpp === 'month' ? ' topopp-month' : t.topOpp === 'week' ? ' topopp-week' : '';
    const rowCls = (pnl > 0 ? 'win' : pnl < 0 ? 'loss' : '') + ' spread-row' + oppCls;
    const dateStr = t.openTime ? t.openTime.format('DD MMM YY HH:mm') : '—';
    const tagged  = t.strategy || t.substrategy || t.notes;

    return `<tr class="${rowCls}" data-spread-id="${escHtml(t.spreadId)}">
      <td><input type="checkbox" class="row-check" data-id="${escHtml(t.spreadId)}" ${checkedIds.has(t.spreadId) ? 'checked' : ''}></td>
      <td class="mono">${dateStr}</td>
      <td>${escHtml(t.product)}${oppBadge(t.topOpp)}</td>
      <td><span class="dir-badge spread">SPR</span></td>
      <td class="mono">${t.totalContracts}</td>
      <td class="mono">—</td>
      <td class="mono">—</td>
      <td class="pnl-cell ${pnlCls}">${RMode.fmt(pnl, t.openTime)}</td>
      <td>${escHtml(t.assetClass)}</td>
      <td>${escHtml(t.strategy    || '')}</td>
      <td>${escHtml(t.substrategy || '')}</td>
      <td class="mono" style="max-width:140px;overflow:hidden;text-overflow:ellipsis">${escHtml(t.notes || '')}</td>
      <td style="white-space:nowrap">
        <button class="tag-btn ${tagged ? 'tagged' : ''}" data-trade-id="${escHtml(t.spreadId)}" title="Tag spread">&#9998;</button>
        <button class="tag-btn" style="color:var(--red);margin-left:4px" data-unmerge="${escHtml(t.spreadId)}" title="Unmerge">&#10006;</button>
      </td>
    </tr>`;
  }

  function attemptRow(t) {
    const pnl    = t.netPnlEUR ?? t.pnlEUR;
    const pnlCls = pnl > 0 ? 'pos' : pnl < 0 ? 'neg' : 'zero';
    const oppCls = t.topOpp === 'month' ? ' topopp-month' : t.topOpp === 'week' ? ' topopp-week' : '';
    const rowCls = (pnl > 0 ? 'win' : pnl < 0 ? 'loss' : '') + ' attempt-row' + oppCls;
    const dateStr = t.openTime ? t.openTime.format('DD MMM YY HH:mm') : '—';
    const tagged  = t.strategy || t.substrategy || t.notes;

    return `<tr class="${rowCls}" data-attempt-id="${escHtml(t.attemptId)}">
      <td><input type="checkbox" class="row-check" data-id="${escHtml(t.attemptId)}" ${checkedIds.has(t.attemptId) ? 'checked' : ''}></td>
      <td class="mono">${dateStr}</td>
      <td>${escHtml(t.product)} <span class="attempt-badge">ATT</span>${oppBadge(t.topOpp)}</td>
      <td><span class="dir-badge ${t.direction}">${t.direction === 'long' ? 'L' : t.direction === 'spread' ? 'SPR' : 'S'}</span></td>
      <td class="mono">${t.totalContracts}</td>
      <td class="mono">—</td>
      <td class="mono">—</td>
      <td class="pnl-cell ${pnlCls}">${pnl !== null ? RMode.fmt(pnl, t.openTime) : '—'}</td>
      <td>${escHtml(t.assetClass)}</td>
      <td>${escHtml(t.strategy    || '')}</td>
      <td>${escHtml(t.substrategy || '')}</td>
      <td class="mono" style="max-width:140px;overflow:hidden;text-overflow:ellipsis">${escHtml(t.notes || '')}</td>
      <td style="white-space:nowrap">
        <button class="tag-btn ${tagged ? 'tagged' : ''}" data-trade-id="${escHtml(t.attemptId)}" title="Tag attempt">&#9998;</button>
        <button class="tag-btn" style="color:var(--red);margin-left:4px" data-unattempt="${escHtml(t.attemptId)}" title="Unmerge attempt">&#10006;</button>
      </td>
    </tr>`;
  }

  function applyFilters(trades) {
    return trades.filter(t => {
      if (filterSymbol   && t.baseProduct !== filterSymbol)   return false;
      if (filterClass    && t.assetClass  !== filterClass)    return false;
      if (filterStrategy && t.strategy    !== filterStrategy) return false;
      if (searchText) {
        const q = searchText.toLowerCase();
        if (!t.product.toLowerCase().includes(q) && !(t.notes || '').toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }

  function sortTrades(trades) {
    return [...trades].sort((a, b) => {
      let av = a[sortCol], bv = b[sortCol];
      if (av && av.valueOf) av = av.valueOf();
      if (bv && bv.valueOf) bv = bv.valueOf();
      if (av == null) return 1;
      if (bv == null) return -1;
      return sortDir * (av < bv ? -1 : av > bv ? 1 : 0);
    });
  }

  function bindControls() {
    document.getElementById('log-search').addEventListener('input', e => { searchText = e.target.value; renderTable(); });
    document.getElementById('log-filter-sym').addEventListener('change',   e => { filterSymbol   = e.target.value; renderTable(); });
    document.getElementById('log-filter-class').addEventListener('change', e => { filterClass    = e.target.value; renderTable(); });
    document.getElementById('log-filter-strat').addEventListener('change', e => { filterStrategy = e.target.value; renderTable(); });

    // Sort headers
    document.querySelectorAll('#trade-table thead th[data-col]').forEach(th => {
      th.addEventListener('click', () => {
        const col = th.dataset.col;
        if (sortCol === col) sortDir *= -1; else { sortCol = col; sortDir = -1; }
        renderTable();
      });
    });

    // Select-all checkbox — operates on all _rows (not just rendered ones)
    document.getElementById('check-all').addEventListener('change', e => {
      if (e.target.checked) {
        _rows.forEach(t => checkedIds.add(t.tradeId ?? t.spreadId ?? t.attemptId));
      } else {
        checkedIds.clear();
      }
      document.querySelectorAll('.row-check').forEach(cb => { cb.checked = e.target.checked; });
      updateMergeBar();
    });

    // Row interactions via event delegation — works for both rendered and lazily appended rows
    const tbody = document.getElementById('trade-tbody');
    if (tbody) {
      tbody.addEventListener('change', e => {
        const cb = e.target.closest('.row-check');
        if (!cb) return;
        cb.checked ? checkedIds.add(cb.dataset.id) : checkedIds.delete(cb.dataset.id);
        updateMergeBar();
      });

      tbody.addEventListener('click', e => {
        const tagBtn = e.target.closest('.tag-btn[data-trade-id]');
        if (tagBtn) { openTagModal(tagBtn.dataset.tradeId); return; }
        const unmergeBtn = e.target.closest('[data-unmerge]');
        if (unmergeBtn) { Spreads.unmerge(unmergeBtn.dataset.unmerge); Analytics.invalidateCache(); renderTable(false); return; }
        const unattemptBtn = e.target.closest('[data-unattempt]');
        if (unattemptBtn) { Attempts.unmerge(unattemptBtn.dataset.unattempt); Analytics.invalidateCache(); renderTable(false); return; }
      });
    }

    // Tag Selected button
    const tagSelBtn = document.getElementById('tag-selected-btn');
    if (tagSelBtn) {
      tagSelBtn.addEventListener('click', () => {
        if (checkedIds.size < 1) return;
        openBulkTagModal([...checkedIds]);
      });
    }

    // Merge as Spread button
    const mergeBtn = document.getElementById('merge-btn');
    if (mergeBtn) {
      mergeBtn.addEventListener('click', () => {
        if (checkedIds.size < 2) return;
        Spreads.merge([...checkedIds]);
        Analytics.invalidateCache();
        checkedIds.clear();
        renderTable(false);
      });
    }

    // Merge as Attempt button — same baseProduct + direction; works for regular trades AND spread rows.
    const mergeAttemptBtn = document.getElementById('merge-attempt-btn');
    if (mergeAttemptBtn) {
      mergeAttemptBtn.addEventListener('click', () => {
        const checkedRows = _rows.filter(t => {
          const id = t.isSpread ? t.spreadId : t.isAttempt ? t.attemptId : t.tradeId;
          return checkedIds.has(id) && !t.isAttempt;
        });
        if (checkedRows.length < 2) return;
        const first = checkedRows[0];
        if (!checkedRows.every(t => t.baseProduct === first.baseProduct && t.direction === first.direction)) return;
        // Store spreadId for spread rows, tradeId for regular trades
        const ids = checkedRows.map(t => t.isSpread ? t.spreadId : t.tradeId);
        Attempts.merge(ids);
        Analytics.invalidateCache();
        checkedIds.clear();
        renderTable(false);
      });
    }

    // Clear selection
    const clearBtn = document.getElementById('clear-selection-btn');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => { checkedIds.clear(); renderTable(false); });
    }

    // Sync bar state with current checkedIds (important after renderTable(false) preserves selection)
    updateMergeBar();
  }

  function updateMergeBar() {
    const bar = document.getElementById('merge-bar');
    if (!bar) return;
    const count = checkedIds.size;
    bar.classList.toggle('visible', count >= 1);
    const span = bar.querySelector('span');
    if (span) span.textContent = `${count} trade${count !== 1 ? 's' : ''} selected`;

    // Spread merge: any 2+ selected items
    const mergeBtn = bar.querySelector('#merge-btn');
    if (mergeBtn) {
      mergeBtn.style.opacity = count >= 2 ? '1' : '0.4';
      mergeBtn.style.cursor  = count >= 2 ? '' : 'default';
    }

    // Attempt merge: look up checked rows from _rows (includes spread synthetics).
    // Exclude attempt synthetics — can't nest an attempt inside another attempt.
    // Require 2+ rows sharing the same baseProduct AND direction.
    //   Regular trades:  direction = 'long'/'short'
    //   Spread synthetics: direction = 'spread' — same spread type = same direction
    const mergeAttemptBtn = bar.querySelector('#merge-attempt-btn');
    if (mergeAttemptBtn) {
      const checkedRows = _rows.filter(t => {
        const id = t.isSpread ? t.spreadId : t.isAttempt ? t.attemptId : t.tradeId;
        return checkedIds.has(id) && !t.isAttempt;
      });
      const attemptOk = checkedRows.length >= 2
        && checkedRows.every(t => t.baseProduct === checkedRows[0].baseProduct)
        && checkedRows.every(t => t.direction   === checkedRows[0].direction);
      mergeAttemptBtn.style.opacity = attemptOk ? '1' : '0.4';
      mergeAttemptBtn.style.cursor  = attemptOk ? '' : 'default';
    }
  }

  // ── Tag Modal ──────────────────────────────────────────────────────────────

  function openTagModal(tradeId) {
    const trade = allTrades.find(t => t.tradeId === tradeId) || spreadById[tradeId] || attemptById[tradeId];
    if (!trade) return;

    const modal = document.getElementById('tag-modal');
    const strategies = Tags.getStrategies();

    modal.querySelector('.modal-title').textContent = trade.product;
    modal.querySelector('.modal-sub').textContent =
      `${trade.closeTime ? trade.closeTime.format('DD MMM YYYY HH:mm') : ''} · ${trade.direction} · ${fmtEUR(trade.netPnlEUR ?? trade.pnlEUR)}`;

    modal.querySelector('#modal-strategy').innerHTML =
      `<option value="">— none —</option>` +
      strategies.map(s => `<option value="${escHtml(s)}" ${trade.strategy === s ? 'selected' : ''}>${escHtml(s)}</option>`).join('') +
      `<option value="__custom__">+ Add new…</option>`;
    modal.querySelector('#modal-strategy').value = trade.strategy || '';

    modal.querySelector('#modal-notes').value = trade.notes || '';
    modal.dataset.tradeId = tradeId;
    delete modal.dataset.bulkIds;

    // Set top opp radio
    const topOppVal = trade.topOpp || '';
    modal.querySelectorAll('input[name="modal-topopp"]').forEach(r => { r.checked = r.value === topOppVal; });

    updateSubOptions(modal, trade.strategy, trade.substrategy || '');
    const sv = modal.querySelector('#modal-strategy').value;
    const bv = modal.querySelector('#modal-substrategy').value;
    modal.querySelector('#del-strategy-btn').style.display    = (sv && sv !== '__custom__') ? '' : 'none';
    modal.querySelector('#del-substrategy-btn').style.display = (bv && bv !== '__custom__') ? '' : 'none';
    modal.classList.add('open');
  }

  function openBulkTagModal(ids) {
    const modal = document.getElementById('tag-modal');
    const strategies = Tags.getStrategies();

    modal.querySelector('.modal-title').textContent = `Tag ${ids.length} trade${ids.length !== 1 ? 's' : ''}`;
    modal.querySelector('.modal-sub').textContent = 'Strategy and sub-strategy applied to all. Notes appended to each.';

    modal.querySelector('#modal-strategy').innerHTML =
      `<option value="">— none —</option>` +
      strategies.map(s => `<option value="${escHtml(s)}">${escHtml(s)}</option>`).join('') +
      `<option value="__custom__">+ Add new…</option>`;
    modal.querySelector('#modal-strategy').value = '';
    modal.querySelector('#modal-notes').value = '';
    modal.dataset.bulkIds = JSON.stringify(ids);
    delete modal.dataset.tradeId;

    // Default to "None" for bulk
    modal.querySelectorAll('input[name="modal-topopp"]').forEach(r => { r.checked = r.value === ''; });

    updateSubOptions(modal, '', '');
    modal.querySelector('#del-strategy-btn').style.display    = 'none';
    modal.querySelector('#del-substrategy-btn').style.display = 'none';
    modal.classList.add('open');
  }

  function updateSubOptions(modal, strategy, currentValue = '') {
    const subs = Tags.getSubstrategiesFor(strategy);
    // Include the current value even if not yet in the known list
    const all  = (currentValue && !subs.includes(currentValue)) ? [...subs, currentValue] : subs;
    const sel  = modal.querySelector('#modal-substrategy');
    sel.innerHTML =
      `<option value="">— none —</option>` +
      all.map(s => `<option value="${escHtml(s)}">${escHtml(s)}</option>`).join('') +
      `<option value="__custom__">+ Add new…</option>`;
    sel.value = currentValue;
  }

  function bindModal() {
    const modal = document.getElementById('tag-modal');

    const stratSel    = modal.querySelector('#modal-strategy');
    const subSel      = modal.querySelector('#modal-substrategy');
    const delStratBtn = modal.querySelector('#del-strategy-btn');
    const delSubBtn   = modal.querySelector('#del-substrategy-btn');

    function syncDeleteBtns() {
      const sv = stratSel.value;
      const bv = subSel.value;
      delStratBtn.style.display = (sv && sv !== '__custom__') ? '' : 'none';
      delSubBtn.style.display   = (bv && bv !== '__custom__') ? '' : 'none';
    }

    stratSel.addEventListener('change', e => {
      if (e.target.value === '__custom__') {
        const name = prompt('Enter strategy name:');
        if (name) {
          const opt = document.createElement('option');
          opt.value = name; opt.textContent = name;
          e.target.insertBefore(opt, e.target.querySelector('[value="__custom__"]'));
          e.target.value = name;
        } else { e.target.value = ''; }
      }
      updateSubOptions(modal, e.target.value, '');
      syncDeleteBtns();
    });

    subSel.addEventListener('change', e => {
      if (e.target.value === '__custom__') {
        const name = prompt('Enter sub-strategy name:');
        if (name) {
          const opt = document.createElement('option');
          opt.value = name; opt.textContent = name;
          e.target.insertBefore(opt, e.target.querySelector('[value="__custom__"]'));
          e.target.value = name;
        } else { e.target.value = ''; }
      }
      syncDeleteBtns();
    });

    delStratBtn.addEventListener('click', () => {
      const name = stratSel.value;
      if (!name || name === '__custom__') return;
      if (!confirm(`Delete strategy "${name}"?\n\nThis will remove it from all trades that use it.`)) return;
      Tags.deleteStrategy(name);
      Analytics.invalidateCache();
      App.state.trades.forEach(t => { if (t.strategy === name) { t.strategy = ''; t.substrategy = ''; } });
      allTrades.forEach(t => { if (t.strategy === name) { t.strategy = ''; t.substrategy = ''; } });
      // Rebuild strategy dropdown and reset
      const strategies = Tags.getStrategies();
      stratSel.innerHTML =
        `<option value="">— none —</option>` +
        strategies.map(s => `<option value="${escHtml(s)}">${escHtml(s)}</option>`).join('') +
        `<option value="__custom__">+ Add new…</option>`;
      stratSel.value = '';
      updateSubOptions(modal, '', '');
      syncDeleteBtns();
    });

    delSubBtn.addEventListener('click', () => {
      const strategy = stratSel.value;
      const name     = subSel.value;
      if (!name || name === '__custom__') return;
      if (!confirm(`Delete sub-strategy "${name}"?\n\nThis will remove it from all trades under "${strategy}".`)) return;
      Tags.deleteSubstrategy(strategy, name);
      Analytics.invalidateCache();
      App.state.trades.forEach(t => { if (t.strategy === strategy && t.substrategy === name) t.substrategy = ''; });
      allTrades.forEach(t => { if (t.strategy === strategy && t.substrategy === name) t.substrategy = ''; });
      updateSubOptions(modal, strategy, '');
      syncDeleteBtns();
    });

    modal.querySelector('#modal-cancel').addEventListener('click', () => modal.classList.remove('open'));
    modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('open'); });

    modal.querySelector('#modal-save').addEventListener('click', () => {
      const strategy    = modal.querySelector('#modal-strategy').value    === '__custom__' ? '' : modal.querySelector('#modal-strategy').value;
      const substrategy = modal.querySelector('#modal-substrategy').value === '__custom__' ? '' : modal.querySelector('#modal-substrategy').value;
      const notes       = modal.querySelector('#modal-notes').value;
      const topOpp      = modal.querySelector('input[name="modal-topopp"]:checked')?.value ?? '';

      if (modal.dataset.bulkIds) {
        // Bulk mode — apply to all selected trades
        const ids = JSON.parse(modal.dataset.bulkIds);
        for (const id of ids) {
          const existing = Tags.get(id);
          Tags.set(id, {
            strategy,
            substrategy,
            topOpp,
            notes: notes || existing.notes,
          });
          const data = { strategy, substrategy, topOpp, notes: notes || existing.notes };
          const applyTo = t => { if (t?.tradeId === id) Object.assign(t, data); };
          allTrades.forEach(applyTo);
          App.state.trades.forEach(applyTo);
          if (spreadById[id])  Object.assign(spreadById[id],  data);
          if (attemptById[id]) Object.assign(attemptById[id], data);
        }
        checkedIds.clear();
      } else {
        // Single trade mode
        const tradeId = modal.dataset.tradeId;
        Tags.set(tradeId, { strategy, substrategy, notes, topOpp });
        const update = t => { if (t?.tradeId === tradeId) { t.strategy = strategy; t.substrategy = substrategy; t.notes = notes; t.topOpp = topOpp; } };
        allTrades.forEach(update);
        App.state.trades.forEach(update);
        if (spreadById[tradeId])  { spreadById[tradeId].topOpp  = topOpp; update(spreadById[tradeId]);  }
        if (attemptById[tradeId]) { attemptById[tradeId].topOpp = topOpp; update(attemptById[tradeId]); }
      }

      Analytics.invalidateCache();
      modal.classList.remove('open');
      renderTable(false);

      // Brief "✓ Saved" flash so the user knows the tag was written
      const saveBtn = modal.querySelector('#modal-save');
      if (saveBtn) {
        const orig = saveBtn.textContent;
        saveBtn.textContent = '✓ Saved';
        saveBtn.style.background = 'var(--green)';
        setTimeout(() => {
          saveBtn.textContent = orig;
          saveBtn.style.background = '';
        }, 1500);
      }
    });
  }

  function init() {
    const modalHTML = `
      <div id="tag-modal">
        <div class="modal-box">
          <div class="modal-title"></div>
          <div class="modal-sub"></div>
          <div class="modal-field">
            <label>Strategy</label>
            <div class="modal-select-row">
              <select id="modal-strategy"></select>
              <button type="button" id="del-strategy-btn" class="btn-delete-tag" title="Delete this strategy">&#10006;</button>
            </div>
          </div>
          <div class="modal-field">
            <label>Sub-strategy</label>
            <div class="modal-select-row">
              <select id="modal-substrategy"></select>
              <button type="button" id="del-substrategy-btn" class="btn-delete-tag" title="Delete this sub-strategy">&#10006;</button>
            </div>
          </div>
          <div class="modal-field">
            <label>Notes</label>
            <textarea id="modal-notes" placeholder="What happened, what you learned…"></textarea>
          </div>
          <div class="modal-field">
            <label>Top Opportunity</label>
            <div class="topopp-radio-group">
              <label class="topopp-radio-opt">
                <input type="radio" name="modal-topopp" value=""> None
              </label>
              <label class="topopp-radio-opt week">
                <input type="radio" name="modal-topopp" value="week"> ★ Week
              </label>
              <label class="topopp-radio-opt month">
                <input type="radio" name="modal-topopp" value="month"> ★★ Month
              </label>
            </div>
          </div>
          <div class="modal-actions">
            <button class="btn-modal-cancel" id="modal-cancel">Cancel</button>
            <button class="btn-modal-save" id="modal-save">Save</button>
          </div>
        </div>
      </div>`;
    document.body.insertAdjacentHTML('beforeend', modalHTML);
    bindModal();
  }

  function escHtml(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  return { render, init };
})();
