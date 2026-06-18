// IG Markets REST API — authentication and historical OHLCV price fetching

const IGApi = (() => {
  const BASE = 'https://api.ig.com/gateway/deal';

  let _cst   = null;
  let _token = null;

  function getCredentials() {
    return {
      key:  localStorage.getItem('ta_ig_key')  || '',
      user: localStorage.getItem('ta_ig_user') || '',
      pass: localStorage.getItem('ta_ig_pass') || '',
    };
  }

  function isConfigured() {
    const { key, user, pass } = getCredentials();
    return !!(key && user && pass);
  }

  async function authenticate() {
    const { key, user, pass } = getCredentials();
    if (!key || !user || !pass) throw new Error('IG API credentials not configured — add them in Settings → Charts / IG API');

    const res = await fetch(`${BASE}/session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-IG-API-KEY': key,
        'Version': '2',
      },
      body: JSON.stringify({ identifier: user, password: pass }),
    });

    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try { const j = await res.json(); msg = j.errorCode || msg; } catch {}
      throw new Error(`IG authentication failed: ${msg}`);
    }

    _cst   = res.headers.get('CST');
    _token = res.headers.get('X-SECURITY-TOKEN');
    if (!_cst || !_token) throw new Error('IG auth succeeded but session tokens were missing from response');
    return true;
  }

  async function _fetchPrices(epic, fromStr, toStr) {
    const { key } = getCredentials();
    const url = `${BASE}/prices/${encodeURIComponent(epic)}?resolution=MINUTE_2&from=${fromStr}&to=${toStr}&pageSize=0`;
    return fetch(url, {
      headers: {
        'X-IG-API-KEY':      key,
        'CST':               _cst,
        'X-SECURITY-TOKEN':  _token,
        'Version':           '3',
      },
    });
  }

  async function getPrices(epic, from, to) {
    if (!_cst || !_token) await authenticate();

    const fromStr = from.format('YYYY-MM-DDTHH:mm:ss');
    const toStr   = to.format('YYYY-MM-DDTHH:mm:ss');

    let res = await _fetchPrices(epic, fromStr, toStr);

    if (res.status === 401 || res.status === 403) {
      _cst = null; _token = null;
      await authenticate();
      res = await _fetchPrices(epic, fromStr, toStr);
    }

    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try { const j = await res.json(); msg = j.errorCode || msg; } catch {}
      throw new Error(`IG price fetch failed for ${epic}: ${msg}`);
    }

    const data = await res.json();
    return (data.prices || []).map(p => {
      const t = dayjs(p.snapshotTime, 'YYYY/MM/DD HH:mm:ss:SSS');
      return {
        time:   t.unix(),
        open:   +((p.openPrice.bid  + p.openPrice.ask)  / 2).toFixed(4),
        high:   +((p.highPrice.bid  + p.highPrice.ask)  / 2).toFixed(4),
        low:    +((p.lowPrice.bid   + p.lowPrice.ask)   / 2).toFixed(4),
        close:  +((p.closePrice.bid + p.closePrice.ask) / 2).toFixed(4),
        volume: p.lastTradedVolume || 0,
      };
    }).filter(p => !isNaN(p.time) && p.time > 0);
  }

  function getEpics() {
    try { return JSON.parse(localStorage.getItem('ta_ig_epics') || '{}'); }
    catch { return {}; }
  }

  function saveEpics(epics) {
    localStorage.setItem('ta_ig_epics', JSON.stringify(epics));
  }

  function getEpic(baseProduct) {
    return getEpics()[baseProduct] || null;
  }

  return { isConfigured, authenticate, getPrices, getEpics, saveEpics, getEpic };
})();
