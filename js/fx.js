// EUR FX rates — fetched from open.er-api.com (free, no key needed)
// Cached in localStorage for 4 hours; falls back to hardcoded rates if offline

const FX = (() => {
  const CACHE_KEY = 'ta_fx_rates';
  const CACHE_TTL = 4 * 60 * 60 * 1000; // 4 hours

  // Fallback rates (EUR base — how many units per 1 EUR)
  const FALLBACK = { USD: 1.08, GBP: 0.86, CAD: 1.47, EUR: 1.0 };

  let rates = { ...FALLBACK };

  function loadFromCache() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return false;
      const { ts, data } = JSON.parse(raw);
      if (Date.now() - ts > CACHE_TTL) return false;
      rates = data;
      return true;
    } catch { return false; }
  }

  async function fetchRates() {
    if (loadFromCache()) return;
    try {
      const res = await fetch('https://open.er-api.com/v6/latest/EUR');
      if (!res.ok) throw new Error('fetch failed');
      const json = await res.json();
      rates = json.rates;
      rates.EUR = 1.0;
      localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data: rates }));
    } catch {
      // silent fallback — use FALLBACK rates already set
      loadFromCache(); // try cache even if stale before giving up
    }
  }

  // Convert amount in fromCurrency to EUR
  function toEUR(amount, fromCurrency) {
    if (fromCurrency === 'EUR') return amount;
    const rate = rates[fromCurrency] ?? FALLBACK[fromCurrency] ?? 1;
    return amount / rate;
  }

  function getRateDisplay() {
    return `EUR/USD ${(rates.USD ?? 1.08).toFixed(4)}`;
  }

  return { fetchRates, toEUR, getRateDisplay };
})();
