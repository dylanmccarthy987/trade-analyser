// Parses broker fill CSV and groups fills into completed trades

const Parser = (() => {

  // Parse "07 May 2026 15:36:05.396" → JS Date
  function parseTimestamp(raw) {
    if (!raw) return null;
    // dayjs with custom format
    const d = dayjs(raw.trim(), 'DD MMM YYYY HH:mm:ss.SSS');
    return d.isValid() ? d : null;
  }

  function isSynthetic(product) {
    // Built-in known products are never synthetic even if they contain a hyphen
    const base = stripContractMonth(product);
    if (CONTRACT_SPECS[base]) return false;
    return / (IPS|TSPR) | - | LIVE$/i.test(product)  // broker spread codes
      || /\bArb\b/i.test(product)                      // e.g. "Silver Arb"
      || /^[A-Za-z0-9]+-[A-Za-z0-9]/i.test(product);  // e.g. "CAC-DAX", "HO-GO"
  }

  // Handles standard decimal prices AND treasury fractional notation "103-175"
  // "103-175" = 103 + 17/32 + 5/8 of a 32nd (= 103.55078125)
  function parsePrice(raw) {
    if (!raw && raw !== 0) return NaN;
    const s = String(raw).trim();
    const m = s.match(/^(\d+)-(\d{2})(\d?)$/);
    if (m) {
      const whole          = parseInt(m[1], 10);
      const thirtySeconds  = parseInt(m[2], 10);
      const eighths        = m[3] ? parseInt(m[3], 10) / 8 : 0;
      return whole + (thirtySeconds + eighths) / 32;
    }
    return parseFloat(s);
  }

  function parseFills(csvText) {
    const result = Papa.parse(csvText, {
      header: true,
      skipEmptyLines: true,
      transformHeader: h => h.trim(),
      transform: v => v.trim(),
    });

    const fills = [];
    for (const row of result.data) {
      const ts = parseTimestamp(row[CSV_COLS.timestamp]);
      if (!ts) continue;
      const volume = parseFloat(row[CSV_COLS.volume]);
      const price  = parsePrice(row[CSV_COLS.price]);
      if (isNaN(volume) || isNaN(price)) continue;

      const product     = (row[CSV_COLS.product] || '').trim();
      const baseProduct = stripContractMonth(product);

      // Skip broker synthetic spread instruments. User merges legs manually in the UI.
      if (isSynthetic(product)) continue;

      fills.push({
        ts,
        direction: (row[CSV_COLS.direction] || '').trim().toLowerCase(), // 'buy' or 'sell'
        volume,
        product,
        baseProduct,
        price,
        account: (row[CSV_COLS.account] || '').trim(),
      });
    }

    if (fills.length === 0 && result.data.length > 0) {
      const sample = result.data[0];
      const ts  = sample[CSV_COLS.timestamp] || '(missing)';
      const vol = sample[CSV_COLS.volume]    || '(missing)';
      console.error(
        `[Trade Analyser] No fills parsed from ${result.data.length} CSV rows.\n` +
        `First row timestamp: "${ts}" — expected format: "06 Mar 2026 19:37:46.281"\n` +
        `First row volume: "${vol}"\n` +
        `Likely cause: file was opened and re-saved in Excel, which corrupts timestamps.\n` +
        `Fix: use a plain text editor (Notepad++) to build the master CSV, never Excel.`
      );
    }

    // Sort chronologically (broker export is newest-first)
    fills.sort((a, b) => a.ts - b.ts);
    return fills;
  }

  // Groups fills into completed trades.
  // A trade is complete when net position for a symbol returns to 0.
  // Fills sharing the same Group ID (future feature) are handled separately.
  function groupIntoTrades(fills) {
    // Track open positions per baseProduct
    // Each entry: { direction: 'long'|'short', netPos: number, openFills: [], closeFills: [] }
    const openPositions = {}; // keyed by baseProduct
    const completedTrades = [];
    const orphanFills = []; // fills with no matching open (carry from prior data)

    for (const fill of fills) {
      const key = fill.product; // group by full product name incl. contract month
      const isBuy = fill.direction === 'buy';
      const signedVol = isBuy ? fill.volume : -fill.volume;

      if (!openPositions[key]) {
        // No open position — this fill opens a new trade
        openPositions[key] = {
          netPos: signedVol,
          openFills: [fill],
          closeFills: [],
          direction: isBuy ? 'long' : 'short',
        };
      } else {
        const pos = openPositions[key];
        const prevNet = pos.netPos;
        const newNet  = prevNet + signedVol;

        const isReducing = (prevNet > 0 && !isBuy) || (prevNet < 0 && isBuy);

        if (isReducing) {
          pos.closeFills.push(fill);
        } else {
          // Adding to position
          pos.openFills.push(fill);
        }

        pos.netPos = newNet;

        if (Math.abs(newNet) < 1e-9) {
          // Trade complete
          completedTrades.push(buildTrade(pos));
          delete openPositions[key];
        } else if (Math.sign(newNet) !== Math.sign(prevNet)) {
          // Position flipped — complete the old trade, start a new one
          completedTrades.push(buildTrade(pos));
          // The overshoot becomes the new position
          const overshootVol = Math.abs(newNet);
          openPositions[key] = {
            netPos: newNet,
            openFills: [{ ...fill, volume: overshootVol }],
            closeFills: [],
            direction: newNet > 0 ? 'long' : 'short',
          };
        }
      }
    }

    // Remaining open positions — exclude synthetics (user uses them to exit real positions)
    const openTrades = Object.entries(openPositions)
      .filter(([key]) => !isSynthetic(key))
      .map(([, pos]) => ({
        ...buildTrade(pos),
        isOpen: true,
      }));

    return { completedTrades, openTrades };
  }

  function buildTrade(pos) {
    const { openFills, closeFills, direction } = pos;
    const allFills = [...openFills, ...closeFills];
    // Derive product names from fills — grouping is now per full product (incl. contract month)
    const product     = openFills[0]?.product ?? '';
    const baseProduct = openFills[0]?.baseProduct ?? product;

    // Weighted avg entry (opening fills)
    const totalOpenVol = openFills.reduce((s, f) => s + f.volume, 0);
    const avgEntry = openFills.reduce((s, f) => s + f.price * f.volume, 0) / (totalOpenVol || 1);

    // Weighted avg exit (closing fills)
    const totalCloseVol = closeFills.reduce((s, f) => s + f.volume, 0);
    const avgExit = closeFills.length
      ? closeFills.reduce((s, f) => s + f.price * f.volume, 0) / (totalCloseVol || 1)
      : null;

    // Timestamps
    const openTime  = openFills[0]?.ts;
    const closeTime = closeFills.length ? closeFills[closeFills.length - 1].ts : null;

    // P&L in native currency
    let pnlNative = null;
    const spec = getContractSpec(baseProduct);
    if (avgExit !== null) {
      const priceDiff = direction === 'long'
        ? avgExit - avgEntry
        : avgEntry - avgExit;
      pnlNative = priceDiff * totalOpenVol * spec.multiplier;
    }

    // P&L in EUR
    const pnlEUR = pnlNative !== null ? FX.toEUR(pnlNative, spec.currency) : null;

    // Unique trade ID for tagging — uses full product name so APR26/MAY26 don't collide
    const tradeId = `${product}__${openTime ? openTime.valueOf() : 'x'}`;

    return {
      tradeId,
      baseProduct,
      product,
      direction,
      totalContracts: totalOpenVol,
      avgEntry,
      avgExit,
      openTime,
      closeTime,
      pnlNative,
      pnlEUR,
      currency: spec.currency,
      assetClass: spec.assetClass,
      spec,
      isOpen: false,
      // tag fields — merged later from tags store
      strategy: '',
      substrategy: '',
      notes: '',
      topOpp: '',
    };
  }

  // Main entry: parse CSV text, return { completedTrades, openTrades }
  function parse(csvText) {
    const fills = parseFills(csvText);
    return groupIntoTrades(fills);
  }

  return { parse };
})();
