/* =========================================================
   MARKET — real prices and their technical picture, worked out in code (a small model is bad at arithmetic over
   hundreds of prices, so it only explains what is computed here):
     resolve("indian stock market") -> {symbol: '^NSEI', name: 'Nifty 50'}       names, indices, stocks, crypto, FX
     analyse(query, 'day'|'week'|'hour') -> {text, url, symbol, name}             the report the model reads
   Prices: Yahoo Finance's public chart data (no key). Nothing here is advice — levels and what would confirm or
   cancel a move, from the prices themselves.
   ========================================================= */
const UA = 'Mozilla/5.0';                                   // the plain form (a full browser name without its cookies is refused)
const get = async url => {
  const r = await fetch(url, {headers: {'user-agent': UA, accept: 'application/json'}});
  if(!r.ok) throw new Error('The price service answered ' + r.status);
  return r.json();
};

// what people call markets -> the symbol that has the prices
const ALIASES = [
  [/\b(bank ?nifty|nifty ?bank)\b/i, '^NSEBANK', 'Nifty Bank'],                 // the narrower names first
  [/\bnifty ?it\b/i, '^CNXIT', 'Nifty IT'],
  [/\b(india vix|vix india)\b/i, '^INDIAVIX', 'India VIX'],
  [/\b(sensex|bse index)\b/i, '^BSESN', 'Sensex'],
  [/\b(indian (stock |share |equity )?market|nifty ?50|nifty|nse index|dalal street)\b/i, '^NSEI', 'Nifty 50'],
  [/\b(s ?& ?p ?500|s and p|spx|us (stock )?market)\b/i, '^GSPC', 'S&P 500'],
  [/\bnasdaq\b/i, '^IXIC', 'Nasdaq Composite'],
  [/\bdow( jones)?\b/i, '^DJI', 'Dow Jones'],
  [/\b(gold)\b/i, 'GC=F', 'Gold (US$ futures)'],
  [/\b(silver)\b/i, 'SI=F', 'Silver (US$ futures)'],
  [/\b(crude|oil|brent)\b/i, 'BZ=F', 'Brent crude'],
  [/\b(bitcoin|btc)\b/i, 'BTC-USD', 'Bitcoin'],
  [/\b(ethereum|eth)\b/i, 'ETH-USD', 'Ethereum'],
  [/\b(usd ?inr|dollar.*rupee|rupee.*dollar|inr)\b/i, 'INR=X', 'US dollar in rupees'],
];
export async function resolve(q){
  q = String(q || '').trim();
  for(const [re, symbol, name] of ALIASES) if(re.test(q)) return {symbol, name};
  if(/^[\^A-Z0-9.=\-]{1,15}$/.test(q)) return {symbol: q, name: q};                      // already a symbol
  const d = await get('https://query2.finance.yahoo.com/v1/finance/search?quotesCount=6&newsCount=0&q=' + encodeURIComponent(q.replace(/\b(share|stock|price|technical|analysis|chart)s?\b/gi, '').trim()));
  const qs = (d.quotes || []).filter(x=>x.symbol && /EQUITY|INDEX|ETF|CRYPTOCURRENCY|CURRENCY|FUTURE|MUTUALFUND/.test(x.quoteType || ''));
  const pick = qs.find(x=>x.exchange === 'NSI') || qs.find(x=>x.exchange === 'BSE') || qs[0];       // an Indian listing first
  if(!pick) throw new Error('No market found for "' + q + '"');
  return {symbol: pick.symbol, name: pick.shortname || pick.longname || pick.symbol};
}

export async function candles(symbol, timeframe){
  const [range, interval] = timeframe === 'week' ? ['5y', '1wk'] : timeframe === 'hour' ? ['1mo', '60m'] : ['2y', '1d'];
  const d = await get(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`);
  const r = d.chart && d.chart.result && d.chart.result[0];
  if(!r || !r.timestamp) throw new Error('No prices for ' + symbol);
  const q = r.indicators.quote[0];
  const rows = r.timestamp.map((t, i)=>({t: t * 1000, o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i], v: q.volume[i] || 0})).filter(x=>x.c != null && x.h != null && x.l != null);
  return {meta: r.meta, rows};
}

/* ---------------------------------------------------------------- indicators */
const sma = (a, n, i) => i + 1 < n ? null : a.slice(i + 1 - n, i + 1).reduce((s, x)=>s + x, 0) / n;
const emaSeries = (a, n) => { const k = 2 / (n + 1), out = []; a.forEach((x, i)=>out.push(i ? x * k + out[i - 1] * (1 - k) : x)); return out; };
function rsiSeries(c, n = 14){
  const out = Array(c.length).fill(null);
  let g = 0, l = 0;
  for(let i = 1; i < c.length; i++){
    const d = c[i] - c[i - 1], up = Math.max(d, 0), dn = Math.max(-d, 0);
    if(i <= n){ g += up; l += dn; if(i === n){ g /= n; l /= n; out[i] = 100 - 100 / (1 + g / (l || 1e-9)); } }
    else { g = (g * (n - 1) + up) / n; l = (l * (n - 1) + dn) / n; out[i] = 100 - 100 / (1 + g / (l || 1e-9)); }
  }
  return out;
}
function atr(rows, n = 14){
  const tr = rows.map((r, i)=>i ? Math.max(r.h - r.l, Math.abs(r.h - rows[i - 1].c), Math.abs(r.l - rows[i - 1].c)) : r.h - r.l);
  let a = tr.slice(1, n + 1).reduce((s, x)=>s + x, 0) / n;
  for(let i = n + 1; i < tr.length; i++) a = (a * (n - 1) + tr[i]) / n;
  return a;
}
// turning points: a high (low) higher (lower) than `k` bars each side
function swings(rows, k){
  const hi = [], lo = [];
  for(let i = k; i < rows.length - k; i++){
    const w = rows.slice(i - k, i + k + 1);
    if(rows[i].h === Math.max(...w.map(x=>x.h))) hi.push({i, p: rows[i].h, t: rows[i].t});
    if(rows[i].l === Math.min(...w.map(x=>x.l))) lo.push({i, p: rows[i].l, t: rows[i].t});
  }
  return {hi, lo};
}
// nearby turning points grouped into levels (within 1.2%), the most-touched first
function levels(points){
  const out = [];
  points.slice().sort((a, b)=>a.p - b.p).forEach(p=>{
    const L = out.find(x=>Math.abs(x.p - p.p) / x.p < 0.012);
    if(L){ L.p = (L.p * L.n + p.p) / (L.n + 1); L.n++; L.last = Math.max(L.last, p.t); } else out.push({p: p.p, n: 1, last: p.t});
  });
  return out;
}

/* ---------------------------------------------------------------- the report */
const fmt = (x, d) => x == null || !isFinite(x) ? '—' : Number(x).toLocaleString('en-IN', {minimumFractionDigits: d == null ? 2 : d, maximumFractionDigits: d == null ? 2 : d});
const pct = x => (x >= 0 ? '+' : '') + fmt(x * 100) + '%';
const day = t => new Date(t).toISOString().slice(0, 10);

export async function analyse(query, timeframe){
  timeframe = /week/i.test(timeframe || '') ? 'week' : /hour|60/i.test(timeframe || '') ? 'hour' : 'day';
  const {symbol, name} = await resolve(query);
  const {meta, rows} = await candles(symbol, timeframe);
  if(rows.length < 60) throw new Error('Too little price history for ' + name);
  const c = rows.map(r=>r.c), n = c.length - 1, last = rows[n], unit = timeframe === 'week' ? 'week' : timeframe === 'hour' ? 'hour' : 'day';
  const per = {day: {m1: 21, m3: 63, m6: 126, y1: 252}, week: {m1: 4, m3: 13, m6: 26, y1: 52}, hour: {m1: 7, m3: 21, m6: 42, y1: 120}}[timeframe];
  const ret = k => n - k >= 0 ? c[n] / c[n - k] - 1 : null;
  const s20 = sma(c, 20, n), s50 = sma(c, 50, n), s200 = sma(c, 200, n);
  const e12 = emaSeries(c, 12), e26 = emaSeries(c, 26), macd = e12.map((x, i)=>x - e26[i]), sig = emaSeries(macd, 9), hist = macd.map((x, i)=>x - sig[i]);
  const rsi = rsiSeries(c), r = rsi[n];
  const sd20 = Math.sqrt(c.slice(n - 19).reduce((s, x)=>s + (x - s20) ** 2, 0) / 20), bbU = s20 + 2 * sd20, bbL = s20 - 2 * sd20;
  const a14 = atr(rows);
  const year = rows.slice(Math.max(0, n - per.y1)), hi52 = Math.max(...year.map(x=>x.h)), lo52 = Math.min(...year.map(x=>x.l));
  const hiAt = year.find(x=>x.h === hi52).t, loAt = year.find(x=>x.l === lo52).t;
  let downRun = 0; for(let i = n; i > 0 && c[i] < c[i - 1]; i--) downRun++;
  let upRun = 0; for(let i = n; i > 0 && c[i] > c[i - 1]; i--) upRun++;
  const vol20 = rows.slice(n - 20, n).reduce((s, x)=>s + x.v, 0) / 20;
  // the 50/200 cross and when it last happened
  let cross = null;
  if(s200 != null) for(let i = n; i > 200; i--){ const a = sma(c, 50, i) - sma(c, 200, i), b = sma(c, 50, i - 1) - sma(c, 200, i - 1); if(a * b < 0){ cross = {golden: a > 0, t: rows[i].t}; break; } }
  // structure: the last few turning points
  const sw = swings(rows.slice(Math.max(0, n - per.m6 * 2)), timeframe === 'day' ? 5 : 3);
  const hs = sw.hi.slice(-3), ls = sw.lo.slice(-3);
  const struct = hs.length >= 2 && ls.length >= 2 ? (hs[hs.length - 1].p < hs[hs.length - 2].p && ls[ls.length - 1].p < ls[ls.length - 2].p ? 'lower highs and lower lows (a downtrend)'
    : hs[hs.length - 1].p > hs[hs.length - 2].p && ls[ls.length - 1].p > ls[ls.length - 2].p ? 'higher highs and higher lows (an uptrend)' : 'mixed highs and lows (sideways)') : 'not enough turning points';
  const lv = levels(sw.hi.concat(sw.lo));
  const below = lv.filter(x=>x.p < last.c * 0.997).sort((a, b)=>b.p - a.p).slice(0, 3);
  const above = lv.filter(x=>x.p > last.c * 1.003).sort((a, b)=>a.p - b.p).slice(0, 3);
  // what the indicators say, each read the same way every time
  const bear = [], bull = [];
  (last.c < s50 ? bear : bull).push(`price ${last.c < s50 ? 'below' : 'above'} the 50-${unit} average (${fmt(s50)})`);
  if(s200 != null) (last.c < s200 ? bear : bull).push(`price ${last.c < s200 ? 'below' : 'above'} the 200-${unit} average (${fmt(s200)})`);
  if(s200 != null) (s50 < s200 ? bear : bull).push(`50-${unit} average ${s50 < s200 ? 'below' : 'above'} the 200-${unit}`);
  (macd[n] < sig[n] ? bear : bull).push(`MACD ${macd[n] < sig[n] ? 'below' : 'above'} its signal line (${fmt(macd[n])} vs ${fmt(sig[n])})`);
  if(r < 50) bear.push(`RSI(14) ${fmt(r, 1)}, under 50`); else bull.push(`RSI(14) ${fmt(r, 1)}, over 50`);
  if(/downtrend/.test(struct)) bear.push(struct); if(/uptrend/.test(struct)) bull.push(struct);
  const notes = [];
  if(r < 30) notes.push(`RSI ${fmt(r, 1)} is oversold (under 30): falls often pause or bounce from here, though a strong downtrend can stay oversold`);
  else if(r < 35) notes.push(`RSI ${fmt(r, 1)} is near oversold`);
  if(r > 70) notes.push(`RSI ${fmt(r, 1)} is overbought (over 70)`);
  if(last.c < bbL) notes.push(`price is below the lower Bollinger band (${fmt(bbL)}) — stretched to the downside`);
  if(last.c > bbU) notes.push(`price is above the upper Bollinger band (${fmt(bbU)}) — stretched to the upside`);
  if(Math.sign(hist[n]) !== Math.sign(hist[n - 1])) notes.push(`MACD just crossed its signal line ${hist[n] > 0 ? 'upward' : 'downward'}`);
  else if(hist[n] < 0 && hist[n] > hist[n - 1] && hist[n - 1] > hist[n - 2]) notes.push('the MACD histogram is negative but shrinking — selling momentum is slowing');
  if(downRun >= 3) notes.push(`${downRun} ${unit}s down in a row`);
  if(upRun >= 3) notes.push(`${upRun} ${unit}s up in a row`);
  if(last.v && vol20 && last.v > vol20 * 1.5) notes.push(`last ${unit}'s volume was ${fmt(last.v / vol20, 1)}× its 20-${unit} average`);
  const lean = bear.length > bull.length + 1 ? 'bearish' : bull.length > bear.length + 1 ? 'bullish' : 'mixed';
  const S1 = below[0], S2 = below[1], R1 = above[0];
  const scen = [];
  const nearLow = S1 && Math.abs(S1.p - lo52) / lo52 < 0.005;
  if(S1) scen.push(nearLow ? `Support is the 52-week low, ${fmt(lo52)}: a close below it would mean new lows for the year, with no turning point under it to slow the fall.`
    : `A close below support ${fmt(S1.p)} would open the way toward ${S2 ? fmt(S2.p) : 'the 52-week low ' + fmt(lo52)}.`);
  else scen.push(`It is at its lows: no earlier turning point below; a further fall would set new 52-week lows.`);
  const first = Math.min(R1 ? R1.p : Infinity, s50);
  scen.push(`A recovery above ${fmt(first)} (${R1 && R1.p < s50 ? 'the nearest resistance' : 'the 50-' + unit + ' average'}) would be the first sign the fall is over` +
    (s200 != null && s200 > first ? `; above the 200-${unit} average (${fmt(s200)}) the long-term trend would turn up again.` : '.'));
  scen.push(`The typical ${unit}'s move now (ATR 14) is about ${fmt(a14)} points (${fmt(a14 / last.c * 100)}%).`);
  const text = [
    `${name} (${symbol}), ${unit === 'day' ? 'daily' : unit === 'week' ? 'weekly' : 'hourly'} prices to ${day(last.t)} — worked out from ${rows.length} ${unit}s of real prices${meta.currency ? ' (' + meta.currency + ')' : ''}:`,
    `Last close ${fmt(last.c)} (${pct(c[n] / c[n - 1] - 1)} on the ${unit}). Change: 1 month ${pct(ret(per.m1))}, 3 months ${pct(ret(per.m3))}, 6 months ${pct(ret(per.m6))}, 1 year ${ret(per.y1) == null ? '—' : pct(ret(per.y1))}.`,
    `52-week range ${fmt(lo52)} (${day(loAt)}) to ${fmt(hi52)} (${day(hiAt)}); now ${pct(last.c / hi52 - 1)} from the high and ${pct(last.c / lo52 - 1)} from the low.`,
    `Averages: 20-${unit} ${fmt(s20)}, 50-${unit} ${fmt(s50)}, 200-${unit} ${fmt(s200)}.${cross ? ` Last 50/200 cross: ${cross.golden ? 'golden (up)' : 'death (down)'} on ${day(cross.t)}.` : ''}`,
    `RSI(14) ${fmt(r, 1)}. MACD ${fmt(macd[n])}, signal ${fmt(sig[n])}, histogram ${fmt(hist[n])}. Bollinger(20,2) ${fmt(bbL)} – ${fmt(bbU)}.`,
    `Structure: ${struct}.`,
    `Support (turning points below): ${below.length ? below.map(x=>fmt(x.p) + (x.n > 1 ? ' (touched ' + x.n + '×)' : '')).join(', ') : 'none nearby; the 52-week low ' + fmt(lo52)}. Resistance above: ${above.length ? above.map(x=>fmt(x.p) + (x.n > 1 ? ' (touched ' + x.n + '×)' : '')).join(', ') : 'none nearby; the 52-week high ' + fmt(hi52)}.`,
    `Bearish signs: ${bear.join('; ') || 'none'}. Bullish signs: ${bull.join('; ') || 'none'}. Overall the indicators lean ${lean}.`,
    notes.length ? `Notes: ${notes.join('; ')}.` : '',
    `What would decide it: ${scen.join(' ')}`,
    `(Indicators describe the past; they are not a forecast or advice.)`,
  ].filter(Boolean).join('\n');
  return {symbol, name, text, url: 'https://finance.yahoo.com/quote/' + encodeURIComponent(symbol) + '/', lean, last: last.c, date: day(last.t)};
}
