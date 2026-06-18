// AI chat tab — sends computed trade stats to Claude API, never raw fills

const AI = (() => {
  const API_KEY_STORAGE = 'ta_claude_key';
  const MAX_HISTORY     = 20; // max message objects kept (10 turns)

  let _history  = [];  // [{role, content}] sent to API
  let _trades   = [];
  let _dateRange = {};

  const SYSTEM_PROMPT = `You are a trading performance analyst. The user is a futures trader who will share computed statistics from their trading journal. Each message includes an up-to-date snapshot of their performance data.

Answer questions concisely and practically. Highlight patterns, strengths, and weaknesses. Do not invent data that isn't in the snapshot. If asked about something not covered by the data, say so. Keep responses focused — avoid lengthy preambles.`;

  // ── Context builder ────────────────────────────────────────────────────────

  function buildContext(trades, dateRange) {
    const filtered = App.filterTrades(trades, dateRange);
    if (!filtered.length) return 'No trades in the selected period.';

    const { from, to } = dateRange ?? {};
    const period = (from && to)
      ? `${from.format('DD MMM YYYY')} – ${to.format('DD MMM YYYY')}`
      : 'All Time';

    const wr   = Metrics.winRate(filtered);
    const pf   = Metrics.profitFactor(filtered);
    const { avgWin, avgLoss } = Metrics.avgWinLoss(filtered);
    const totalPnl = Metrics.pnl(filtered);

    const lines = [];

    lines.push(`=== TRADING PERFORMANCE SNAPSHOT ===`);
    lines.push(`Period: ${period}`);
    lines.push(`Trades: ${wr.total} (Wins: ${wr.wins}, Losses: ${wr.losses}, Scratches: ${wr.scratches})`);
    lines.push(`Win Rate: ${(wr.rate * 100).toFixed(1)}%`);
    lines.push(`Total P&L: ${fmtEUR(totalPnl)}`);
    lines.push(`Profit Factor: ${pf ? pf.toFixed(2) : '—'}`);
    lines.push(`Avg Win: ${fmtEUR(avgWin)} | Avg Loss: ${fmtEUR(avgLoss)}`);

    // Monthly
    const months = Metrics.monthlyBreakdown(filtered);
    if (months.length) {
      lines.push(`\n=== MONTHLY P&L ===`);
      for (const m of [...months].reverse()) {
        lines.push(`${m.label}: ${fmtEUR(m.pnl)} (${m.total} trades, ${(m.winRate * 100).toFixed(0)}% WR)`);
      }
    }

    // By strategy
    const byStrategy = Metrics.groupBy(filtered.filter(t => t.strategy), 'strategy');
    if (byStrategy.length) {
      lines.push(`\n=== BY STRATEGY ===`);
      for (const g of byStrategy) {
        lines.push(`${g.key}: ${g.total} trades | ${(g.winRate * 100).toFixed(0)}% WR | ${fmtEUR(g.pnl)} | PF: ${g.profitFactor ? g.profitFactor.toFixed(2) : '—'}`);
      }
    }

    // By asset class
    const byClass = Metrics.groupBy(filtered, 'assetClass');
    if (byClass.length) {
      lines.push(`\n=== BY ASSET CLASS ===`);
      for (const g of byClass) {
        lines.push(`${g.key}: ${g.total} trades | ${(g.winRate * 100).toFixed(0)}% WR | ${fmtEUR(g.pnl)}`);
      }
    }

    // Long vs short
    const longs  = filtered.filter(t => t.direction === 'long');
    const shorts = filtered.filter(t => t.direction === 'short');
    const lwr = Metrics.winRate(longs);
    const swr = Metrics.winRate(shorts);
    lines.push(`\n=== LONG vs SHORT ===`);
    lines.push(`Long:  ${lwr.total} trades | ${(lwr.rate * 100).toFixed(0)}% WR | ${fmtEUR(Metrics.pnl(longs))}`);
    lines.push(`Short: ${swr.total} trades | ${(swr.rate * 100).toFixed(0)}% WR | ${fmtEUR(Metrics.pnl(shorts))}`);

    // Top / bottom 5
    const sorted = [...filtered].sort((a, b) => (b.pnlEUR ?? 0) - (a.pnlEUR ?? 0));
    const tradeStr = t => {
      const strat = [t.strategy, t.substrategy].filter(Boolean).join(' / ');
      return `${t.baseProduct} | ${t.direction} | ${fmtEUR(t.pnlEUR)}${strat ? ' | ' + strat : ''}`;
    };
    lines.push(`\n=== TOP 5 TRADES ===`);
    sorted.slice(0, 5).forEach((t, i) => lines.push(`${i + 1}. ${tradeStr(t)}`));
    lines.push(`\n=== BOTTOM 5 TRADES ===`);
    sorted.slice(-5).reverse().forEach((t, i) => lines.push(`${i + 1}. ${tradeStr(t)}`));

    return lines.join('\n');
  }

  // ── API call ───────────────────────────────────────────────────────────────

  async function callAPI(userMessage) {
    const key = localStorage.getItem(API_KEY_STORAGE) || '';
    if (!key) throw new Error('NO_KEY');

    const context = buildContext(_trades, _dateRange);
    const fullMessage = `${context}\n\n---\n${userMessage}`;

    // Build history with injected context on latest user turn
    const messages = [
      ..._history.slice(-MAX_HISTORY),
      { role: 'user', content: fullMessage },
    ];

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-allow-browser': 'true',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message || `API error ${res.status}`);
    }

    const data = await res.json();
    const reply = data.content?.[0]?.text ?? '';

    // Store plain user message (without context injection) in history
    _history.push({ role: 'user',      content: userMessage });
    _history.push({ role: 'assistant', content: reply });
    if (_history.length > MAX_HISTORY) _history = _history.slice(-MAX_HISTORY);

    return reply;
  }

  // ── Rendering ──────────────────────────────────────────────────────────────

  function render(trades, dateRange) {
    _trades    = trades;
    _dateRange = dateRange;

    const el = document.getElementById('tab-ai');
    if (el.dataset.initialised) {
      // Tab already built — just update stored refs and refresh the context badge
      updateContextBadge();
      return;
    }
    el.dataset.initialised = '1';

    el.innerHTML = `
      <div class="ai-layout">
        <div class="ai-topbar">
          <span class="ai-context-badge" id="ai-context-badge"></span>
          <button class="ai-clear-btn" id="ai-clear-btn">Clear chat</button>
        </div>
        <div class="ai-messages" id="ai-messages">
          <div class="ai-msg ai-msg--claude">
            <div class="ai-bubble">Ask me anything about your trading performance. I can see your current stats, monthly breakdown, strategy performance, and individual trades.</div>
          </div>
        </div>
        <div class="ai-input-row">
          <textarea id="ai-input" class="ai-textarea" placeholder="e.g. Why am I losing on Fridays? What is my best setup?" rows="2"></textarea>
          <button id="ai-send-btn" class="ai-send-btn">Send</button>
        </div>
      </div>
    `;

    updateContextBadge();
    bindEvents(el);
  }

  function updateContextBadge() {
    const badge = document.getElementById('ai-context-badge');
    if (!badge) return;
    const filtered = App.filterTrades(_trades, _dateRange);
    const { from, to } = _dateRange ?? {};
    const period = (from && to) ? `${from.format('DD MMM YYYY')} – ${to.format('DD MMM YYYY')}` : 'All Time';
    badge.textContent = `${filtered.length} trades · ${period}`;
  }

  function bindEvents(el) {
    const messagesEl = el.querySelector('#ai-messages');
    const inputEl    = el.querySelector('#ai-input');
    const sendBtn    = el.querySelector('#ai-send-btn');
    const clearBtn   = el.querySelector('#ai-clear-btn');

    const send = async () => {
      const text = inputEl.value.trim();
      if (!text) return;
      inputEl.value = '';
      sendBtn.disabled = true;

      appendMessage('user', text, messagesEl);

      const thinking = appendMessage('claude', '…', messagesEl);
      try {
        const reply = await callAPI(text);
        thinking.querySelector('.ai-bubble').textContent = reply;
      } catch (err) {
        if (err.message === 'NO_KEY') {
          thinking.querySelector('.ai-bubble').innerHTML =
            `No API key set. <a href="#" id="ai-goto-settings" style="color:var(--accent)">Go to Settings</a> to add your Anthropic key.`;
          el.querySelector('#ai-goto-settings')?.addEventListener('click', e => {
            e.preventDefault();
            document.querySelector('[data-tab="settings"]')?.click();
          });
        } else {
          thinking.querySelector('.ai-bubble').textContent = `Error: ${err.message}`;
          thinking.querySelector('.ai-bubble').style.color = 'var(--red)';
        }
      }
      sendBtn.disabled = false;
      inputEl.focus();
    };

    sendBtn.addEventListener('click', send);
    inputEl.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    });
    clearBtn.addEventListener('click', () => {
      _history = [];
      messagesEl.innerHTML = `
        <div class="ai-msg ai-msg--claude">
          <div class="ai-bubble">Chat cleared. Ask me anything about your trading performance.</div>
        </div>`;
    });
  }

  function appendMessage(role, text, container) {
    const div = document.createElement('div');
    div.className = `ai-msg ai-msg--${role}`;
    div.innerHTML = `<div class="ai-bubble">${escHtml(text)}</div>`;
    container.appendChild(div);
    div.scrollIntoView({ behavior: 'smooth', block: 'end' });
    return div;
  }

  function escHtml(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function init() {} // placeholder for app.js symmetry

  return { render, init };
})();
