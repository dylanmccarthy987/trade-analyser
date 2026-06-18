// Trade chart modal — renders OHLCV candlestick chart with fill markers,
// or displays a manually attached image (for spreads/attempts).
// Uses TradingView Lightweight Charts for candlestick rendering.

const TradeChart = (() => {
  let _modal        = null;
  let _chart        = null;
  let _currentId    = null;
  let _currentTrade = null;

  function init() {
    document.body.insertAdjacentHTML('beforeend', `
      <div id="chart-modal" class="modal-overlay">
        <div class="modal-box" style="max-width:920px;width:92vw">
          <div class="modal-header">
            <div>
              <div class="modal-title" id="chart-modal-title"></div>
              <div class="modal-sub"   id="chart-modal-sub"></div>
            </div>
            <button class="modal-close" id="chart-modal-close">&#10005;</button>
          </div>
          <div id="chart-modal-body">
            <div id="chart-container"></div>
          </div>
          <div class="modal-footer">
            <button id="chart-generate-btn" class="btn-primary">&#128202; Generate chart</button>
            <button id="chart-attach-btn"   class="btn-secondary" style="display:none">&#128247; Attach image</button>
            <input  type="file" id="chart-image-input" accept="image/*" style="display:none">
            <div style="flex:1"></div>
            <button id="chart-delete-btn"  class="btn-secondary" style="display:none;color:var(--red)">Delete chart</button>
            <button id="chart-close-btn"   class="btn-secondary">Close</button>
          </div>
        </div>
      </div>
    `);

    _modal = document.getElementById('chart-modal');

    document.getElementById('chart-modal-close').addEventListener('click', close);
    document.getElementById('chart-close-btn').addEventListener('click', close);
    _modal.addEventListener('click', e => { if (e.target === _modal) close(); });
    document.getElementById('chart-generate-btn').addEventListener('click', handleGenerate);
    document.getElementById('chart-delete-btn').addEventListener('click', handleDelete);
    document.getElementById('chart-attach-btn').addEventListener('click', () => {
      document.getElementById('chart-image-input').click();
    });
    document.getElementById('chart-image-input').addEventListener('change', handleImageAttach);
  }

  async function open(trade) {
    _currentTrade = trade;
    _currentId    = trade.isSpread ? trade.spreadId : trade.isAttempt ? trade.attemptId : trade.tradeId;

    const isMerged = !!(trade.isSpread || trade.isAttempt);
    const dirLabel = trade.direction === 'long' ? 'Long' : trade.direction === 'short' ? 'Short' : 'Spread';

    document.getElementById('chart-modal-title').textContent =
      `${trade.product}  ·  ${dirLabel}  ·  ${trade.pnlEUR != null ? fmtEUR(trade.pnlEUR) : '—'}`;
    document.getElementById('chart-modal-sub').textContent =
      `${trade.openTime ? trade.openTime.format('DD MMM YYYY HH:mm') : '—'} → ${trade.closeTime ? trade.closeTime.format('HH:mm') : '—'}  ·  ${trade.totalContracts} lots`;

    document.getElementById('chart-generate-btn').style.display = isMerged ? 'none' : '';
    document.getElementById('chart-attach-btn').style.display   = isMerged ? '' : 'none';

    const data = await ChartStore.loadChart(_currentId);
    if (data) {
      renderChart(data);
      document.getElementById('chart-delete-btn').style.display = '';
    } else {
      showEmpty(isMerged);
      document.getElementById('chart-delete-btn').style.display = 'none';
    }

    _modal.classList.add('open');
  }

  function close() {
    _modal.classList.remove('open');
    _destroyChart();
    _currentId    = null;
    _currentTrade = null;
    document.getElementById('chart-image-input').value = '';
  }

  function _destroyChart() {
    if (_chart) { try { _chart.remove(); } catch {} _chart = null; }
  }

  function renderChart(data) {
    const container = document.getElementById('chart-container');
    container.innerHTML = '';
    _destroyChart();

    if (data.type === 'image') {
      container.innerHTML = `<img src="${data.imageB64}" style="max-width:100%;max-height:520px;border-radius:4px;display:block;margin:0 auto">`;
      return;
    }

    if (!data.ohlcv?.length) {
      container.innerHTML = '<div class="chart-empty">No OHLCV data saved.</div>';
      return;
    }

    _chart = LightweightCharts.createChart(container, {
      width:  container.offsetWidth || 820,
      height: 460,
      layout: { background: { color: '#0d1117' }, textColor: '#c9d1d9' },
      grid:   { vertLines: { color: '#30363d44' }, horzLines: { color: '#30363d44' } },
      rightPriceScale: { borderColor: '#30363d' },
      timeScale:       { borderColor: '#30363d', timeVisible: true, secondsVisible: false },
      crosshair:       { mode: 1 },
    });

    const candles = _chart.addCandlestickSeries({
      upColor:         '#3fb950',
      downColor:       '#f85149',
      borderUpColor:   '#3fb950',
      borderDownColor: '#f85149',
      wickUpColor:     '#3fb950',
      wickDownColor:   '#f85149',
    });

    candles.setData(data.ohlcv);

    if (data.fills?.length) {
      candles.setMarkers(
        [...data.fills].sort((a, b) => a.time - b.time).map(f => ({
          time:     f.time,
          position: f.label === 'Entry' ? 'belowBar' : 'aboveBar',
          color:    f.label === 'Entry' ? '#3fb950' : '#f85149',
          shape:    f.label === 'Entry' ? 'arrowUp' : 'arrowDown',
          text:     typeof f.price === 'number' ? f.price.toFixed(3) : '',
        }))
      );
    }

    _chart.timeScale().fitContent();
  }

  function showEmpty(isMerged) {
    _destroyChart();
    document.getElementById('chart-container').innerHTML = `<div class="chart-empty">${
      isMerged
        ? 'No image attached. Click "Attach image" to upload a screenshot.'
        : 'No chart yet. Click "Generate chart" to fetch from IG, or configure credentials in Settings.'
    }</div>`;
  }

  function _buildFills(trade) {
    const fills = [];
    if (trade.openTime  && trade.avgEntry != null) fills.push({ time: trade.openTime.unix(),  price: trade.avgEntry, label: 'Entry' });
    if (trade.closeTime && trade.avgExit  != null) fills.push({ time: trade.closeTime.unix(), price: trade.avgExit,  label: 'Exit'  });
    return fills;
  }

  async function handleGenerate() {
    if (!_currentTrade || _currentTrade.isSpread || _currentTrade.isAttempt) return;

    const epic = IGApi.getEpic(_currentTrade.baseProduct);
    if (!epic) {
      alert(`No IG epic configured for "${_currentTrade.baseProduct}".\n\nAdd it in Settings → Charts / IG API.`);
      return;
    }

    const btn = document.getElementById('chart-generate-btn');
    btn.textContent = 'Generating…';
    btn.disabled    = true;

    try {
      const ohlcv = await IGApi.getPrices(
        epic,
        _currentTrade.openTime.subtract(30, 'minute'),
        _currentTrade.closeTime.add(30, 'minute')
      );
      const chartData = { type: 'ohlcv', ohlcv, fills: _buildFills(_currentTrade), generatedAt: Date.now() };
      await ChartStore.saveChart(_currentId, chartData);
      renderChart(chartData);
      document.getElementById('chart-delete-btn').style.display = '';
    } catch (err) {
      alert(`Chart generation failed:\n${err.message}`);
    } finally {
      btn.textContent = '&#128202; Generate chart';
      btn.disabled    = false;
    }
  }

  async function handleDelete() {
    if (!_currentId) return;
    await ChartStore.deleteChart(_currentId);
    document.getElementById('chart-delete-btn').style.display = 'none';
    showEmpty(_currentTrade?.isSpread || _currentTrade?.isAttempt);
  }

  async function handleImageAttach(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async ev => {
      const chartData = { type: 'image', imageB64: ev.target.result, generatedAt: Date.now() };
      await ChartStore.saveChart(_currentId, chartData);
      renderChart(chartData);
      document.getElementById('chart-delete-btn').style.display = '';
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }

  // Bulk generate charts for all individual trades in the provided list.
  // Groups by instrument+day, one API call per group.
  // statusCallback(message, isDone) is called with progress updates.
  async function bulkGenerate(trades, statusCallback) {
    if (!IGApi.isConfigured()) {
      alert('IG API credentials not configured.\nAdd them in Settings → Charts / IG API.');
      return;
    }

    const eligible = [];
    for (const t of trades) {
      if (t.isSpread || t.isAttempt || !t.openTime || !t.closeTime) continue;
      if (!IGApi.getEpic(t.baseProduct)) continue;
      const has = await ChartStore.hasChart(t.tradeId);
      if (!has) eligible.push(t);
    }

    if (!eligible.length) {
      statusCallback?.('All charts already generated (or no epics configured).', true);
      return;
    }

    // Group by baseProduct + trading day
    const groups = {};
    for (const t of eligible) {
      const key = `${t.baseProduct}||${t.openTime.format('YYYY-MM-DD')}`;
      if (!groups[key]) groups[key] = { baseProduct: t.baseProduct, trades: [] };
      groups[key].trades.push(t);
    }

    let done = 0; let failed = 0;
    const total = eligible.length;

    for (const group of Object.values(groups)) {
      const epic = IGApi.getEpic(group.baseProduct);
      try {
        const allTimes = group.trades.flatMap(t => [t.openTime, t.closeTime]).filter(Boolean);
        const minTime  = allTimes.reduce((a, b) => a.isBefore(b) ? a : b);
        const maxTime  = allTimes.reduce((a, b) => a.isAfter(b)  ? a : b);
        const allBars  = await IGApi.getPrices(epic, minTime.subtract(30, 'minute'), maxTime.add(30, 'minute'));

        for (const t of group.trades) {
          const from  = t.openTime.subtract(30, 'minute').unix();
          const to    = t.closeTime.add(30, 'minute').unix();
          const ohlcv = allBars.filter(b => b.time >= from && b.time <= to);
          await ChartStore.saveChart(t.tradeId, {
            type: 'ohlcv', ohlcv, fills: _buildFills(t), generatedAt: Date.now(),
          });
          done++;
          statusCallback?.(`Generated ${done} / ${total}`, false);
        }
      } catch (err) {
        console.warn(`[TradeChart] Failed ${group.baseProduct}:`, err.message);
        failed += group.trades.length;
        done   += group.trades.length;
        statusCallback?.(`Generated ${done - failed} / ${total} (${failed} failed)`, false);
      }
    }

    const ok = done - failed;
    statusCallback?.(`Done — ${ok} chart${ok !== 1 ? 's' : ''} generated${failed ? `, ${failed} failed` : ''}.`, true);
  }

  return { init, open, bulkGenerate };
})();
