"use strict";
/* =========================================================
   MONEY WEB — answering beyond your apps, the way an assistant with web search does it:
   LOOK UP (free sources, each for what it is good at), WORK OUT (exact calculators), READ (pick the sentences that answer
   the question, with where they came from), and — when an AI is available — REPHRASE those passages into a plain answer
   that may use only what was read (its figures are checked against the sources).
     calculators: EMI, SIP and lump-sum growth, CAGR, percentages and GST, sums, unit conversions, lakh/crore
     live: exchange rates (open.er-api), weather and local time (Open-Meteo), word meanings (Wiktionary),
           facts about things (Wikidata), everything else (Wikipedia: search, then read the best pages)
   answer(question) -> {text, sources:[{title, url}], kind, passages} or null.  Measured by test/exam/web.exam.js
   ========================================================= */
const MoneyWeb = (function(){
  // a small gap between calls to the same free service, so it does not start refusing
  let lastCall = 0;
  const pace = async () => { const wait = lastCall + 250 - Date.now(); lastCall = Math.max(Date.now(), lastCall + 250); if(wait > 0) await new Promise(r=>setTimeout(r, wait)); };
  const get = async (url, o) => {
    if(/wiki(pedia|data|tionary)\.org/.test(url)) await pace();
    // Wikimedia and the others ask busy callers to slow down: wait longer each time (1.5 s, 3 s, 6 s) before giving up
    for(let i = 0; i < 4; i++){
      try{ const r = await fetch(url, o); if(r.status === 429 || r.status >= 500) throw new Error('busy'); const d = await r.json(); if(d && d.error && /ratelimit|maxlag/i.test(d.error.code || '')) throw new Error('busy'); return d; }
      catch(e){ if(i === 3) throw e; await new Promise(r=>setTimeout(r, 1500 * Math.pow(2, i))); }
    }
  };
  const cached = (key, ttl, fn) => (typeof MoneyBrain !== 'undefined' ? MoneyBrain.fact(key, fn, {ttl}) : fn());
  const inr = n => '₹' + Math.round(n).toLocaleString('en-IN');
  const big = n => n >= 1e7 ? '₹' + (n / 1e7).toFixed(2) + ' Cr' : n >= 1e5 ? '₹' + (n / 1e5).toFixed(2) + ' L' : inr(n);
  const num = s => { // "50 lakh", "1.5 cr", "2,50,000", "10k"
    const m = /([\d,]*\.?\d+)\s*(crores?|cr|lakhs?|lacs?|l\b|k\b|thousand|million|mn|billion|bn)?/i.exec(String(s));
    if(!m) return null;
    const v = parseFloat(m[1].replace(/,/g, '')), u = (m[2] || '').toLowerCase();
    return v * (/^cr/.test(u) ? 1e7 : /^(lakh|lac|l)/.test(u) ? 1e5 : /^(k|thousand)/.test(u) ? 1e3 : /^(million|mn)/.test(u) ? 1e6 : /^(billion|bn)/.test(u) ? 1e9 : 1);
  };
  const AMT = '((?:rs\\.?|₹|inr)?\\s*[\\d,]*\\.?\\d+\\s*(?:crores?|cr|lakhs?|lacs?|l\\b|k\\b|thousand|million)?)';

  /* ================================================================ WORK OUT: exact calculators */
  function calc(q){
    let m;
    // EMI: "EMI for 50 lakh at 8.5% for 20 years"
    if(/\bemi\b/.test(q) && (m = new RegExp(AMT + '[^%\\d]*?(\\d+\\.?\\d*)\\s*%[^\\d]*?(\\d+\\.?\\d*)\\s*(years?|yrs?|months?)', 'i').exec(q))){
      const P = num(m[1]), r = +m[2] / 1200, n = /month/.test(m[4]) ? +m[3] : +m[3] * 12;
      const emi = r ? P * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1) : P / n;
      return {kind: 'calculator', text: `EMI on ${big(P)} at ${m[2]}% a year for ${m[3]} ${m[4]}: ${inr(emi)} a month. Total paid ${big(emi * n)}, of which interest ${big(emi * n - P)}.`, sources: []};
    }
    // SIP: "SIP of 10000 for 15 years at 12%"
    if(/\bsip\b|\bmonthly investment\b|\bevery month\b/.test(q) && (m = new RegExp(AMT, 'i').exec(q)) && /(\d+\.?\d*)\s*%/.test(q) && /(\d+)\s*(years?|yrs?)/.test(q)){
      const P = num(m[1]), rate = +(/(\d+\.?\d*)\s*%/.exec(q)[1]), years = +(/(\d+)\s*(years?|yrs?)/.exec(q)[1]);
      const i = rate / 1200, n = years * 12, fv = i ? P * ((Math.pow(1 + i, n) - 1) / i) * (1 + i) : P * n;
      return {kind: 'calculator', text: `A SIP of ${inr(P)} a month for ${years} years at ${rate}% a year grows to about ${big(fv)} (you put in ${big(P * n)}; growth ${big(fv - P * n)}). Returns are not guaranteed — this assumes a steady ${rate}%.`, sources: []};
    }
    // CAGR: "CAGR from 1 lakh to 2.5 lakh in 6 years"
    if(/\bcagr\b|\bgrowth rate\b|\bannual return\b/.test(q) && (m = new RegExp(AMT + '\\s*(?:to|->|became|grew to)\\s*' + AMT + '[^\\d]*(\\d+\\.?\\d*)\\s*(years?|yrs?)', 'i').exec(q))){
      const a = num(m[1]), b = num(m[2]), y = +m[3], c = (Math.pow(b / a, 1 / y) - 1) * 100;
      return {kind: 'calculator', text: `From ${big(a)} to ${big(b)} in ${y} years is a CAGR of ${c.toFixed(2)}% a year.`, sources: []};
    }
    // lump sum: "5 lakh at 7% for 10 years", "what will 1 lakh become in 10 years at 12%"
    if(/(\d+\.?\d*)\s*%/.test(q) && /(\d+)\s*(years?|yrs?)/.test(q) && /\b(grow|become|be worth|invest|fd|fixed deposit|compound|maturity|lump ?sum)\b/.test(q) && (m = new RegExp(AMT, 'i').exec(q))){
      const P = num(m[1]), rate = +(/(\d+\.?\d*)\s*%/.exec(q)[1]), years = +(/(\d+)\s*(years?|yrs?)/.exec(q)[1]);
      const fv = P * Math.pow(1 + rate / 100, years);
      return {kind: 'calculator', text: `${big(P)} at ${rate}% a year, compounded yearly, becomes about ${big(fv)} in ${years} years (growth ${big(fv - P)}).`, sources: []};
    }
    // GST / percent of: "18% GST on 2500", "15% of 1200", "what is 12.5 percent of 80000"
    if((m = /(\d+\.?\d*)\s*(?:%|percent)\s*(gst\s*)?(?:of|on)\s*([\d,.]+\s*(?:lakhs?|crores?|cr|k)?)/.exec(q))){
      const p = +m[1], v = num(m[3]), part = v * p / 100;
      return {kind: 'calculator', text: m[2] || /\bgst\b/.test(q) ? `${p}% GST on ${inr(v)} is ${inr(part)}; the total is ${inr(v + part)}.` : `${p}% of ${inr(v).replace('₹', '')} is ${(Math.round(part * 100) / 100).toLocaleString('en-IN')}.`, sources: []};
    }
    // lakh / crore
    if((m = /([\d,.]+)\s*(lakhs?|crores?)\s*(?:in|to|=)\s*(millions?|numbers?|digits?|rupees?)/.exec(q)) || (m = /how much is ([\d,.]+)\s*(lakhs?|crores?)/.exec(q))){
      const v = num(m[1] + ' ' + m[2]);
      return {kind: 'calculator', text: `${m[1]} ${m[2]} = ${v.toLocaleString('en-IN')} (${(v / 1e6).toLocaleString('en-IN')} million).`, sources: []};
    }
    // units
    const U = [[/(\d+\.?\d*)\s*(?:km|kilomet(?:er|re)s?)\s*(?:in|to)\s*miles?/, x=>x * 0.621371, 'miles'], [/(\d+\.?\d*)\s*miles?\s*(?:in|to)\s*(?:km|kilomet(?:er|re)s?)/, x=>x * 1.609344, 'km'],
      [/(\d+\.?\d*)\s*(?:kg|kilos?|kilograms?)\s*(?:in|to)\s*(?:lbs?|pounds?)/, x=>x * 2.20462, 'lb'], [/(\d+\.?\d*)\s*(?:lbs?|pounds?)\s*(?:in|to)\s*(?:kg|kilos?|kilograms?)/, x=>x / 2.20462, 'kg'],
      [/(-?\d+\.?\d*)\s*(?:°\s*)?(?:c|celsius)\s*(?:in|to)\s*(?:°\s*)?(?:f|fahrenheit)/, x=>x * 9 / 5 + 32, '°F'], [/(-?\d+\.?\d*)\s*(?:°\s*)?(?:f|fahrenheit)\s*(?:in|to)\s*(?:°\s*)?(?:c|celsius)/, x=>(x - 32) * 5 / 9, '°C'],
      [/(\d+\.?\d*)\s*(?:feet|foot|ft)\s*(?:in|to)\s*(?:m|met(?:er|re)s?)/, x=>x * 0.3048, 'm'], [/(\d+\.?\d*)\s*(?:m|met(?:er|re)s?)\s*(?:in|to)\s*(?:feet|ft)/, x=>x / 0.3048, 'ft'],
      [/(\d+\.?\d*)\s*(?:inch(?:es)?|in)\s*(?:in|to)\s*(?:cm|centimet(?:er|re)s?)/, x=>x * 2.54, 'cm'], [/(\d+\.?\d*)\s*(?:sq\.?\s*ft|square feet)\s*(?:in|to)\s*(?:sq\.?\s*m|square met(?:er|re)s?)/, x=>x * 0.092903, 'sq m']];
    for(const [re, f, unit] of U){ if((m = re.exec(q))) return {kind: 'calculator', text: `${m[1]} → ${(Math.round(f(+m[1]) * 100) / 100).toLocaleString('en-IN')} ${unit}.`, sources: []}; }
    // plain arithmetic: "what is 23*47+12", "1250/7"
    const ex = /(?:what is|calculate|compute|=)?\s*([\d\s+\-*/().^%,]{3,})\s*\??$/.exec(q.trim());
    if(ex && /\d\s*[+\-*/^]\s*\(?\d/.test(ex[1]) && !/\d{4}-\d{2}/.test(ex[1])){
      try{ const v = arith(ex[1].replace(/,/g, '')); if(isFinite(v)) return {kind: 'calculator', text: `${ex[1].trim()} = ${(Math.round(v * 1e6) / 1e6).toLocaleString('en-IN')}`, sources: []}; }catch(e){}
    }
    return null;
  }
  // a small, safe arithmetic reader (no eval): + - * / ^ ( ) and % (percent of 1)
  function arith(s){
    let i = 0;
    const peek = () => s[i], eat = c => { while(s[i] === ' ') i++; if(s[i] === c){ i++; return true; } return false; };
    const skip = () => { while(s[i] === ' ') i++; };
    const number = () => { skip(); let j = i; while(/[\d.]/.test(s[i] || '')) i++; if(j === i) throw new Error('number'); let v = parseFloat(s.slice(j, i)); skip(); if(s[i] === '%'){ i++; v /= 100; } return v; };
    const factor = () => { skip(); if(eat('-')) return -factor(); if(eat('(')){ const v = expr(); if(!eat(')')) throw new Error(')'); return v; } return number(); };
    const power = () => { let b = factor(); skip(); if(eat('^')) b = Math.pow(b, power()); return b; };
    const term = () => { let v = power(); for(;;){ skip(); if(eat('*')) v *= power(); else if(eat('/')) v /= power(); else return v; } };
    const expr = () => { let v = term(); for(;;){ skip(); if(eat('+')) v += term(); else if(eat('-')) v -= term(); else return v; } };
    const v = expr(); skip(); if(i < s.length) throw new Error('left over'); return v;
  }

  /* ================================================================ LOOK UP: live sources */
  const CUR = {rupee: 'INR', rupees: 'INR', inr: 'INR', rs: 'INR', dollar: 'USD', dollars: 'USD', usd: 'USD', dirham: 'AED', dirhams: 'AED', aed: 'AED', euro: 'EUR', euros: 'EUR', eur: 'EUR',
    pound: 'GBP', pounds: 'GBP', gbp: 'GBP', yen: 'JPY', jpy: 'JPY', baht: 'THB', thb: 'THB', 'singapore dollar': 'SGD', sgd: 'SGD', riyal: 'SAR', sar: 'SAR', ringgit: 'MYR', myr: 'MYR',
    'australian dollar': 'AUD', aud: 'AUD', 'canadian dollar': 'CAD', cad: 'CAD', yuan: 'CNY', cny: 'CNY', franc: 'CHF', chf: 'CHF', rupiah: 'IDR', idr: 'IDR', lira: 'TRY', try: 'TRY', 'sri lankan rupee': 'LKR', lkr: 'LKR', taka: 'BDT', bdt: 'BDT', 'nepalese rupee': 'NPR', npr: 'NPR', dinar: 'KWD', kwd: 'KWD', qar: 'QAR', 'qatari riyal': 'QAR', 'hong kong dollar': 'HKD', hkd: 'HKD', won: 'KRW', krw: 'KRW', dong: 'VND', vnd: 'VND'};
  const curRe = '(' + Object.keys(CUR).sort((a, b)=>b.length - a.length).map(k=>k.replace(/ /g, '\\s')).join('|') + ')';
  async function currency(q){
    const m = new RegExp('(?:([\\d,.]+)\\s*(?:k|lakh|thousand)?\\s*)?' + curRe + '\\s*(?:to|in|into|=|vs|against)\\s*' + curRe, 'i').exec(q);
    if(!m || !/(convert|rate|to|in|how much|worth|value)/.test(q)) return null;
    const from = CUR[m[2].toLowerCase().replace(/\s+/g, ' ')], to = CUR[m[3].toLowerCase().replace(/\s+/g, ' ')];
    if(!from || !to || from === to) return null;
    const amount = m[1] ? num(m[1] + (/(\d)\s*k\b/.test(q) ? 'k' : /lakh/.test(q) ? ' lakh' : '')) : 1;
    const d = await cached('fx:' + from, 6 * 3600, ()=>get('https://open.er-api.com/v6/latest/' + from));
    const rate = d && d.rates && d.rates[to];
    if(!rate) return null;
    const when = d.time_last_update_utc ? new Date(d.time_last_update_utc).toISOString().slice(0, 10) : '';
    const fmt = (v, c) => (c === 'INR' ? '₹' : '') + (Math.round(v * 100) / 100).toLocaleString(c === 'INR' ? 'en-IN' : 'en-US') + (c === 'INR' ? '' : ' ' + c);
    return {kind: 'currency', text: `${fmt(amount, from)} = ${fmt(amount * rate, to)} (1 ${from} = ${rate < 0.01 ? rate.toPrecision(3) : (Math.round(rate * 10000) / 10000)} ${to}${when ? ', rate of ' + when : ''}). Banks and cards charge a margin on top.`,
      sources: [{title: 'ExchangeRate-API (open access)', url: 'https://www.exchangerate-api.com'}]};
  }
  async function place(name){
    const d = await cached('geo:' + name.toLowerCase(), 30 * 86400, ()=>get('https://geocoding-api.open-meteo.com/v1/search?count=1&language=en&format=json&name=' + encodeURIComponent(name)));
    return d && d.results && d.results[0];
  }
  async function weather(q){
    const m = /\bweather\b.*?\b(?:in|at|for)\s+([a-z][a-z .'-]{1,40}?)(?:\s+(today|tomorrow|this week|on \w+|next week))?\s*\??$/.exec(q) || /\b(?:will it rain|is it (?:hot|cold|raining)|temperature)\b.*?\b(?:in|at)\s+([a-z][a-z .'-]{1,40}?)(?:\s+(today|tomorrow|this week))?\s*\??$/.exec(q);
    if(!m) return null;
    const p = await place(m[1].trim());
    if(!p) return {kind: 'weather', text: 'I could not find a place called “' + m[1] + '”.', sources: []};
    const d = await get(`https://api.open-meteo.com/v1/forecast?latitude=${p.latitude}&longitude=${p.longitude}&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weathercode&current=temperature_2m,weathercode&timezone=auto&forecast_days=7`);
    const W = c => c === 0 ? 'clear' : c <= 2 ? 'mostly clear' : c === 3 ? 'cloudy' : c <= 48 ? 'foggy' : c <= 57 ? 'drizzle' : c <= 67 ? 'rain' : c <= 77 ? 'snow' : c <= 82 ? 'showers' : 'thunderstorms';
    const day = i => `${new Date(d.daily.time[i] + 'T00:00').toLocaleDateString('en-IN', {weekday: 'short', day: 'numeric', month: 'short'})}: ${W(d.daily.weathercode[i])}, ${Math.round(d.daily.temperature_2m_min[i])}–${Math.round(d.daily.temperature_2m_max[i])}°C, rain ${d.daily.precipitation_probability_max[i]}%`;
    const which = m[2] === 'tomorrow' ? [1] : /week/.test(m[2] || '') ? [0, 1, 2, 3, 4, 5, 6] : [0];
    return {kind: 'weather', text: `${p.name}${p.country ? ', ' + p.country : ''} — ${which.length === 1 && which[0] === 0 && d.current ? 'now ' + Math.round(d.current.temperature_2m) + '°C; ' : ''}${which.map(day).join(' · ')}.`,
      sources: [{title: 'Open-Meteo forecast', url: 'https://open-meteo.com'}]};
  }
  async function localTime(q){
    const m = /\b(?:time|date)\b.*?\b(?:in|at)\s+([a-z][a-z .'-]{1,40}?)\s*(?:now|right now)?\s*\??$/.exec(q);
    if(!m || /\bweather\b/.test(q)) return null;
    const p = await place(m[1].trim());
    if(!p || !p.timezone) return null;
    const now = new Date();
    const t = now.toLocaleString('en-IN', {timeZone: p.timezone, weekday: 'long', hour: 'numeric', minute: '2-digit', day: 'numeric', month: 'short'});
    const offset = (tz) => { const s = now.toLocaleString('en-US', {timeZone: tz}); return (new Date(s) - new Date(now.toLocaleString('en-US', {timeZone: 'Asia/Kolkata'}))) / 60000; };
    const diff = offset(p.timezone);
    return {kind: 'time', text: `In ${p.name} it is ${t} (${p.timezone}) — ${diff === 0 ? 'the same as India' : Math.abs(diff / 60) + ' h ' + (diff > 0 ? 'ahead of' : 'behind') + ' India'}.`, sources: []};
  }
  async function define(q){
    const m = /^(?:define|meaning of|what does)\s+["“]?([a-z][a-z -]{1,30}?)["”]?(?:\s+mean)?\s*\??$/.exec(q.trim()) || /^what is the meaning of\s+["“]?([a-z][a-z -]{1,30}?)["”]?\s*\??$/.exec(q.trim());
    if(!m) return null;
    const w = m[1].trim();
    const d = await get('https://en.wiktionary.org/api/rest_v1/page/definition/' + encodeURIComponent(w.replace(/ /g, '_'))).catch(()=>null);
    const en = d && d.en;
    if(!en || !en.length) return null;
    const strip = s => String(s).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    const defs = en.slice(0, 2).map(p=>p.partOfSpeech.toLowerCase() + ': ' + (p.definitions.map(x=>strip(x.definition).replace(/^[:;,\s]+/, '')).filter(Boolean)[0] || '')).filter(x=>!/:\s*$/.test(x));
    return {kind: 'definition', text: `“${w}” — ${defs.join('; ').replace(/[.\s]+$/, '')}.`, sources: [{title: 'Wiktionary: ' + w, url: 'https://en.wiktionary.org/wiki/' + encodeURIComponent(w)}]};
  }

  /* facts about a thing, from Wikidata: "capital of Australia", "who wrote Gitanjali", "population of Japan" */
  const REL = [
    [/\bcapital (?:city )?of (.+)/, 'P36', 'The capital of {x} is {v}.'],
    [/\bpopulation of (.+)|\bhow many people (?:live|are) in (.+)/, 'P1082', '{x} has a population of about {v}.'],
    [/\bcurrency (?:of|in|used in) (.+)|\bwhat currency (?:does|is used in) (.+?)(?: use)?$/, 'P38', 'The currency of {x} is the {v}.'],
    [/\b(?:prime minister|pm) of (.+)/, 'P6', 'The head of government of {x} is {v}.'],
    [/\bpresident of (.+)/, 'P35', 'The head of state of {x} is {v}.'],
    [/\bofficial languages? of (.+)|\bwhat languages? (?:is|are) spoken in (.+)/, 'P37', 'The official language{s} of {x}: {v}.'],
    [/\bwho (?:wrote|is the author of) (.+)|\bauthor of (.+)/, 'P50', '{x} was written by {v}.'],
    [/\bwho directed (.+)|\bdirector of (.+)/, 'P57', '{x} was directed by {v}.'],
    [/\bwho (?:founded|started) (.+)|\bfounders? of (.+)/, 'P112', '{x} was founded by {v}.'],
    [/\bwhen (?:was|were) (.+?) (?:founded|established|formed|started|built|created)/, 'P571', '{x} was founded in {v}.'],
    [/\bwhen was (.+?) born|\bbirth ?(?:date|day) of (.+)/, 'P569', '{x} was born on {v}.'],
    [/\bwho is the ceo of (.+)|\bceo of (.+)/, 'P169', 'The chief executive of {x} is {v}.'],
    [/\bhow (?:tall|high) is (.+)|\bheight of (.+)|\belevation of (.+)/, ['P2044', 'P2048'], '{x} is {v} high.'],
    [/\b(?:what is the )?area of (.+)|\bhow big is (.+)/, 'P2046', '{x} covers {v}.'],
    [/\bwhere is (.+?) (?:located|headquartered)|\bheadquarters of (.+)/, 'P159', '{x} is headquartered in {v}.'],
  ];
  const clean = s => String(s || '').replace(/^(the|a|an)\s+/i, '').replace(/[?.!]+$/, '').trim();
  async function wikidata(q){
    for(const [re, props, tpl] of REL){
      const m = re.exec(q);
      if(!m) continue;
      const list = [].concat(props);
      const x = clean(m.slice(1).find(Boolean));
      if(!x || x.length < 2) continue;
      const s = await get('https://www.wikidata.org/w/api.php?action=wbsearchentities&language=en&format=json&origin=*&limit=7&search=' + encodeURIComponent(x)).catch(()=>null);
      let found = (s && s.search) || [];
      // not among the names (a spelling: "Godan" is filed as "Godaan"): find its Wikipedia page with a hint of what it is, then that page's facts
      const HINT = {P50: 'novel book', P57: 'film', P112: 'company', P169: 'company', P571: 'organisation', P159: 'company'};
      const viaWiki = async () => {
        const ws = await get('https://en.wikipedia.org/w/api.php?action=query&list=search&srlimit=3&format=json&origin=*&srsearch=' + encodeURIComponent(x + ' ' + ([].concat(props).map(pp=>HINT[pp]).find(Boolean) || ''))).catch(()=>null);
        const titles = (((ws || {}).query || {}).search || []).map(h=>h.title);
        if(!titles.length) return [];
        // the top few pages (the right one may be second: "Godan" finds Odin first, then Godaan); the one with the fact wins below
        const w2 = await get('https://www.wikidata.org/w/api.php?action=wbgetentities&props=labels|sitelinks&sites=enwiki&format=json&origin=*&titles=' + encodeURIComponent(titles.join('|'))).catch(()=>null);
        return Object.entries((w2 && w2.entities) || {}).filter(([id])=>/^Q/.test(id)).map(([id, en])=>({id, label: ((en.sitelinks || {}).enwiki || {}).title || id}));
      };
      if(!found.length) found = await viaWiki();
      if(!found.length) return null;
      // the first of the matches that has the fact asked about, an exact name first ("Sholay" the film, not a parody of it)
      const ids = found.map(h=>h.id);
      const e = await get('https://www.wikidata.org/w/api.php?action=wbgetentities&props=claims|labels|sitelinks&languages=en&format=json&origin=*&ids=' + ids.join('|'));
      // a mountain's height is its elevation above the sea (P2044); a building's is its height (P2048)
      const has = (h, pp) => e.entities[h.id] && (e.entities[h.id].claims[pp] || []).some(c=>c.mainsnak && c.mainsnak.datavalue);
      let prop = list.find(pp=>found.some(h=>has(h, pp)));
      if(!prop){
        const more = await viaWiki();
        if(more.length){
          const e2 = await get('https://www.wikidata.org/w/api.php?action=wbgetentities&props=claims|labels|sitelinks&languages=en&format=json&origin=*&ids=' + more.map(h=>h.id).join('|'));
          Object.assign(e.entities, e2.entities); found = more;
          prop = list.find(pp=>found.some(h=>has(h, pp)));
        }
      }
      if(!prop) return null;
      const withIt = found.filter(h=>has(h, prop));
      // the famous one: the most Wikipedia editions (the mountain, not a namesake; the film, not a parody of it)
      const editions = h => Object.keys(e.entities[h.id].sitelinks || {}).length;
      const hit = withIt.slice().sort((a, b)=>editions(b) - editions(a))[0];
      if(!hit) return null;
      const ent = e.entities[hit.id], claims = (ent.claims[prop] || []).filter(c=>c.mainsnak && c.mainsnak.datavalue);
      // the preferred or latest value (a population has many years; a PM has had many holders)
      const rank = c => (c.rank === 'preferred' ? 2 : c.rank === 'normal' ? 1 : 0);
      const time = c => { const q2 = c.qualifiers || {}; const t = (q2.P585 || q2.P580 || [])[0]; return t && t.datavalue ? t.datavalue.value.time : ''; };
      const ended = c => !!((c.qualifiers || {}).P582);
      const amount = c => c.mainsnak.datavalue.type === 'quantity' ? Math.abs(+c.mainsnak.datavalue.value.amount) : 0;
      // the preferred value; else the latest; for a height or area, the largest (a mountain's height, not a hut's on it)
      const sorted = claims.filter(c=>!ended(c)).sort((a, b)=>rank(b) - rank(a) || (/P2048|P2046|P2044/.test(prop) ? amount(b) - amount(a) : 0) || time(b).localeCompare(time(a)));
      const pick = (sorted.length ? sorted : claims).slice(0, /P37|P112/.test(prop) ? 3 : 1);
      // every name needed, in one request
      const refIds = pick.map(c=>c.mainsnak.datavalue).filter(dv=>dv.type === 'wikibase-entityid').map(dv=>dv.value.id);
      const names = refIds.length ? (await get('https://www.wikidata.org/w/api.php?action=wbgetentities&props=labels&languages=en&format=json&origin=*&ids=' + refIds.join('|'))).entities : {};
      const vals = [];
      for(const c of pick){
        const dv = c.mainsnak.datavalue;
        if(dv.type === 'wikibase-entityid'){ const id = dv.value.id; vals.push((((names[id] || {}).labels || {}).en || {}).value || id); }
        else if(dv.type === 'quantity'){ const a = Math.abs(+dv.value.amount), unit = /Q11573$/.test(dv.value.unit) ? ' m' : /Q712226$/.test(dv.value.unit) ? ' km²' : '';
          vals.push(prop === 'P1082' ? (a >= 1e7 ? (a / 1e6).toFixed(1) + ' million (' + (a / 1e7).toFixed(2) + ' crore)' : a.toLocaleString('en-IN')) + (time(c) ? ' (' + time(c).slice(1, 5) + ')' : '') : a.toLocaleString('en-IN') + unit); }
        else if(dv.type === 'time'){ const t = dv.value.time.slice(1, 11), prec = dv.value.precision; vals.push(prec >= 11 ? new Date(t + 'T00:00:00Z').toLocaleDateString('en-IN', {day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC'}) : t.slice(0, 4)); }
        else vals.push(String(dv.value));
      }
      const label = ((ent.labels || {}).en || {}).value || x;
      const wiki = ent.sitelinks && ent.sitelinks.enwiki ? ent.sitelinks.enwiki.title : '';
      return {kind: 'fact', text: tpl.replace('{x}', label).replace('{v}', vals.join(', ')).replace('{s}', vals.length > 1 ? 's' : ''),
        sources: [{title: 'Wikidata: ' + label, url: 'https://www.wikidata.org/wiki/' + hit.id}].concat(wiki ? [{title: 'Wikipedia: ' + wiki, url: 'https://en.wikipedia.org/wiki/' + encodeURIComponent(wiki.replace(/ /g, '_'))}] : [])};
    }
    return null;
  }

  /* ================================================================ READ: the sentences that answer the question */
  const STOP = new Set('a an the is are was were be been of in on at to for from by with and or not what which who whom whose when where why how does do did can could should would will shall i you we they it this that these those me my our your their about into over than then there here as if so also just more most much many some any tell explain please'.split(' '));
  const words = s => String(s).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(w=>w.length > 1 && !STOP.has(w));
  const stem = w => w.replace(/(ing|ed|es|s)$/, '');
  async function wikipedia(q){
    const s = await get('https://en.wikipedia.org/w/api.php?action=query&list=search&srlimit=3&format=json&origin=*&srsearch=' + encodeURIComponent(q.replace(/[?]/g, '')));
    const hits = ((s.query || {}).search || []).slice(0, 3);
    if(!hits.length) return null;
    // Wikipedia gives the full text of one page per request: ask for each
    const one = t => get('https://en.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&exsectionformat=plain&exchars=6000&redirects=1&format=json&origin=*&titles=' + encodeURIComponent(t)).catch(()=>null);
    const got = await Promise.all(hits.map(h=>one(h.title)));
    const list = got.map(d=>d && Object.values((d.query || {}).pages || {})[0]).filter(p=>p && p.extract);
    return list.map((p, i)=>({title: p.title, url: 'https://en.wikipedia.org/wiki/' + encodeURIComponent(p.title.replace(/ /g, '_')), text: p.extract, rank: i}));
  }
  /* the best few sentences for the question (BM25-like: rare question words count more; early sentences of the best page
     are favoured; a "when/how many/how tall" question wants a sentence with a year or a number) */
  function bestSentences(q, pages, n){
    const qw = Array.from(new Set(words(q).map(stem)));
    const sents = [];
    pages.forEach(p=>String(p.text).split(/\n+/).forEach(par=>(par.match(/[^.!?]+(?:[.!?]+|$)/g) || []).forEach(s=>{
      s = s.trim(); if(s.length < 40 || s.length > 420 || /^(see also|references|external links)/i.test(s)) return;
      sents.push({s, page: p, pos: sents.filter(x=>x.page === p).length});
    })));
    if(!sents.length) return [];
    const df = {}; sents.forEach(x=>new Set(words(x.s).map(stem)).forEach(w=>{ df[w] = (df[w] || 0) + 1; }));
    const N = sents.length;
    const wantNum = /\b(how many|how much|how tall|how high|how long|how far|population|height|distance|when|what year)\b/.test(q);
    sents.forEach(x=>{
      const ws = words(x.s).map(stem), tf = {}; ws.forEach(w=>{ tf[w] = (tf[w] || 0) + 1; });
      let sc = 0;
      qw.forEach(w=>{ if(tf[w]) sc += Math.log(1 + N / (df[w] || 1)) * (tf[w] * 2.2) / (tf[w] + 1.2 * (0.25 + 0.75 * ws.length / 25)); });
      sc *= 1 / (1 + x.page.rank * 0.35);
      sc += Math.max(0, 1.2 - x.pos * 0.12);                                    // a page's opening sentences say what it is
      if(wantNum && /\b(1[0-9]{3}|20[0-9]{2}|\d[\d,.]*\s*(million|billion|crore|lakh|km|m|metres|meters|feet|%))\b/.test(x.s)) sc += 1.5;
      if(/^\s*why\b|\bhow come\b|\breason\b/.test(q) && /\b(because|due to|caused by|result of|as a result|reason|since|so that|scatter)/i.test(x.s)) sc += 2.5;
      x.score = sc;
    });
    const top = sents.slice().sort((a, b)=>b.score - a.score).slice(0, n || 3);
    // back in reading order within each page, best page first
    return top.sort((a, b)=>a.page.rank - b.page.rank || a.pos - b.pos);
  }

  /* ================================================================ ANSWER */
  async function answer(question, o){
    const q = ' ' + String(question || '').toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').trim() + ' ';
    const qt = q.trim();
    const c = calc(qt); if(c) return c;
    for(const f of [currency, weather, localTime, define, wikidata]){ try{ const r = await f(qt); if(r) return r; }catch(e){} }
    if(o && o.factsOnly) return null;
    // "what is X" / "who is X": the opening of X's Wikipedia page says it best
    const wi = /^(?:what|who)\s+(?:is|are|was|were)\s+(?:a |an |the )?(.{2,60}?)\s*\??$/.exec(qt);
    if(wi && !/\b(difference|best|better|should|price|rate|today|now|latest)\b/.test(qt)){
      try{
        const s = await get('https://en.wikipedia.org/w/api.php?action=query&list=search&srlimit=1&format=json&origin=*&srsearch=' + encodeURIComponent(wi[1]));
        const t = (((s.query || {}).search || [])[0] || {}).title;
        if(t){
          const sm = await get('https://en.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(t.replace(/ /g, '_')));
          const ex = String(sm.extract || '').trim();
          if(ex && sm.type !== 'disambiguation'){
            const two = (ex.match(/[^.!?]+(?:[.!?]+|$)/g) || [ex]).slice(0, 3).join(' ').trim();
            return {kind: 'read', text: two + ' [1]', sources: [{title: 'Wikipedia: ' + sm.title, url: (sm.content_urls && sm.content_urls.desktop && sm.content_urls.desktop.page) || ('https://en.wikipedia.org/wiki/' + encodeURIComponent(t))}],
              passages: [{title: sm.title, url: '', text: ex}]};
          }
        }
      }catch(e){}
    }
    // everything else: read Wikipedia
    let pages = null;
    try{ pages = await wikipedia(qt); }catch(e){}
    if(!pages || !pages.length) return null;
    const best = bestSentences(qt, pages, 3);
    if(!best.length || best[0].score < 1.2) return null;
    // what the question is about must be in what we read — else it found something else, and says nothing rather than junk
    const key = words(qt).filter(w=>!/^(wrote|written|author|founded|directed|made|invented|discovered|mean|meaning|define|explain)$/.test(w));
    const topic = key.filter(w=>w.length >= 4);
    const told = best.map(b=>b.s.toLowerCase()).join(' ') + ' ' + best.map(b=>b.page.title.toLowerCase()).join(' ');
    if(topic.length && !topic.some(w=>told.includes(w))) return {kind: 'not-found', text: 'I could not find a reliable answer to that on Wikipedia.', sources: []};
    // "who wrote / directed / founded X": what we read must say who did it
    const REL_WORD = {wrote: /\b(written by|wrote|author|novel by|by [A-Z])/, directed: /\b(directed by|director)/, founded: /\b(founded by|co-?founded|founder)/, invented: /\b(invented|inventor)/};
    const rel = Object.keys(REL_WORD).find(k=>new RegExp('\\b(who )?' + k + '\\b').test(qt));
    if(rel && !best.some(b=>REL_WORD[rel].test(b.s) && topic.some(w=>b.s.toLowerCase().includes(w)))) return {kind: 'not-found', text: 'I could not find a reliable answer to that on Wikipedia.', sources: []};
    const used = Array.from(new Set(best.map(b=>b.page)));
    return {kind: 'read', text: best.map(b=>b.s + ' [' + (used.indexOf(b.page) + 1) + ']').join(' '), sources: used.map(p=>({title: 'Wikipedia: ' + p.title, url: p.url})),
      passages: pages.map(p=>({title: p.title, url: p.url, text: bestSentences(qt, [Object.assign({}, p, {rank: 0})], 6).map(x=>x.s).join(' ')}))};
  }

  /* ================================================================ REPHRASE with an AI, held to what was read */
  const GROUNDED = `You answer a question using ONLY the numbered sources below (text fetched from the web just now).
Write a short, plain answer (2-5 sentences) and mark each fact with its source number like [1]. Keep every number exactly as the source gives it.
If the sources do not answer the question, say so in one sentence — do not use anything you know that is not in them.`;
  async function rephrase(question, found, chat){
    if(!found || !found.passages || !chat) return found;
    const src = found.passages.map((p, i)=>`[${i + 1}] ${p.title}\n${p.text}`).join('\n\n');
    const r = await chat(GROUNDED, [{role: 'user', content: 'Question: ' + question + '\n\nSources:\n' + src}], {tier: 'fast'});
    const text = String(r.text || '').trim();
    // its figures must be in the sources (a number it did not read is not trusted)
    const nums = t => (t.match(/\d[\d,.]*\d|\d/g) || []).map(x=>x.replace(/,/g, '')).filter(x=>x.length >= 3);
    const have = new Set(nums(src));
    const foreign = nums(text).filter(n=>!have.has(n));
    if(!text || foreign.length) return Object.assign({}, found, {note: foreign.length ? 'The AI’s wording used figures not in the sources (' + foreign.slice(0, 3).join(', ') + '), so here is what the sources say.' : ''});
    return Object.assign({}, found, {text, kind: 'read+ai', by: r.provider + ' · ' + r.model});
  }

  /* ================================================================ DEEP: search the web, read, think, answer
     deep(question, {search(q, n) -> {provider, results:[{title, url, snippet, content?}]}, read(url, links) -> {title, url, content, links},
                     chat(system, turns, opts) -> {text, provider, model} (optional), onStep(text)})
     1. search (a time-bound question gets this month added); 2. read the best pages in parallel (a search's own page
     text when it has it); 3. keep the passages that answer the question (not whole pages: free AIs take only so much);
     4. an AI reads them and answers with [n] sources — or asks for one more search or one more page (twice at most);
     5. its figures must be in the sources, else the sources' own sentences are given. No AI: the best passages, cited. */
  const DEEP_SYSTEM = today => `You answer questions from web pages fetched just now (today is ${today}). You get numbered sources and, sometimes, links found inside them.
Reply with JSON only, one of:
{"answer": "a clear, complete answer in plain sentences, each fact marked with its source like [2]; say what is uncertain or where sources disagree"}
{"search": "a better web search query"}   (only if the sources do not contain the answer)
{"open": "one URL from the links listed"}  (only if one of them clearly holds the answer)
Use only the sources. Copy numbers exactly as the sources give them. Never invent a source number.
Rules: ${Object.values(RULES).join('; ')}.${(m=>m.length ? '\nMistakes you made before — avoid them: ' + m.join('; ') + '.' : '')(pastMistakes())}`;
  async function deep(question, o){
    o = o || {};
    const step = t => { try{ o.onStep && o.onStep(t); }catch(e){} };
    const today = new Date().toISOString().slice(0, 10);
    const timely = /\b(today|now|latest|current|currently|this (week|month|year)|recent|news|live|price|rate|score|update)\b/i.test(question);
    const month = new Date().toLocaleString('en-US', {month: 'long', year: 'numeric'});
    const sources = [], seen = new Set(), links = [];
    // page text as reading text: link addresses, citation marks and table pipes out
    const tidy = t => String(t || '').replace(/\[\[?\d+\]?\]\([^)]*\)/g, '').replace(/\]\(https?:[^)]*\)/g, ']').replace(/\(?https?:\/\/\S+\)?/g, '')
      .replace(/\S*cite_note\S*/g, '').replace(/\[\d+\]/g, '').replace(/[\[\]]/g, '').replace(/\s*\|\s*/g, ' · ').replace(/(\s*·\s*){2,}/g, ' · ').replace(/[ \t]+/g, ' ');
    const add = (title, url, text) => {
      text = tidy(text);
      if(!text || seen.has(url)) return;
      seen.add(url);
      sources.push({n: sources.length + 1, title: String(title || url).slice(0, 120), url, text: String(text)});
    };
    const readSome = async (results, max) => {
      const pick = results.filter(r=>r.url && !seen.has(r.url)).slice(0, max);
      step('Reading ' + pick.length + ' page' + (pick.length === 1 ? '' : 's') + '…');
      const got = await Promise.all(pick.map(async r=>{
        // text already in hand (a file, or a search that sent the page's text) is used as it is
        if(r.content && (r.content.length > 600 || /^file:/.test(r.url))) return {r, page: {title: r.title, url: r.url, content: r.content, links: []}};
        try{ return {r, page: await Promise.race([o.read(r.url, true), new Promise((_, rej)=>setTimeout(()=>rej(new Error('slow')), 15000))])}; }
        catch(e){ return {r, page: {title: r.title, url: r.url, content: r.snippet || '', links: []}}; }
      }));
      got.forEach(({r, page})=>{ add(page.title || r.title, page.url || r.url, page.content || r.snippet); (page.links || []).forEach(l=>{ if(l.url && links.length < 400) links.push(Object.assign({from: page.url}, l)); }); });
    };
    let query = question + (timely && !/\b20\d\d\b/.test(question) ? ' ' + month : ''), provider = '';
    step('Searching the web…');
    const first = await o.search(query, 8);
    provider = first.provider;
    // the search engine's own answer boxes are sources too
    (first.results || []).filter(r=>/^Google (answer|knowledge)/.test(r.title) && r.snippet).forEach(r=>add(r.title, r.url || 'google', r.snippet));
    await readSome((first.results || []).filter(r=>!/^Google (answer|knowledge)/.test(r.title)), 5);
    // the passages that matter, per source (numbered as the sources are)
    const passagesOf = () => sources.map(src=>{
      const best = bestSentences(question, [{title: src.title, url: src.url, text: src.text, rank: 0}], 8).map(x=>x.s);
      return Object.assign({}, src, {passage: (best.length ? best.join(' ') : String(src.text).slice(0, 600)).slice(0, 1800)});
    }).filter(x=>x.passage.trim().length > 40);
    const relevantLinks = () => {
      const qw = words(question).map(stem);
      return links.filter(l=>!seen.has(l.url) && /^https?:/.test(l.url)).map(l=>({l, sc: qw.filter(w=>words(l.text).map(stem).includes(w)).length})).filter(x=>x.sc > 0)
        .sort((a, b)=>b.sc - a.sc).slice(0, 12).map(x=>x.l);
    };
    if(!o.chat){
      const ps = passagesOf();
      if(!ps.length) return {kind: 'not-found', text: 'The pages found did not answer that.', sources: []};
      const best = bestSentences(question, ps.map((p, i)=>({title: p.title, url: p.url, text: p.passage, rank: i})), 4);
      return {kind: 'web', text: best.map(b=>b.s + ' [' + (ps.findIndex(p=>p.url === b.page.url) + 1) + ']').join(' '), sources: ps.map(p=>({title: p.title, url: p.url})), provider, by: 'Read from the pages (no AI) · ' + provider};
    }
    for(let round = 0; round < 3; round++){
      const ps = passagesOf();
      const ls = relevantLinks();
      const before = casesFor(question).concat([timingNote(question, today)]).filter(Boolean);
      const prompt = 'Question: ' + question + (before.length ? '\n\nBefore you answer:\n- ' + before.join('\n- ') : '') + '\n\nSources:\n' + ps.map((p, i)=>`[${i + 1}] ${p.title} — ${p.url}\n${p.passage}`).join('\n\n') +
        (ls.length && round < 2 ? '\n\nLinks found inside those pages:\n' + ls.map(l=>'- ' + l.text + ' — ' + l.url).join('\n') : '');
      step(round ? 'Thinking again with more to read…' : 'Thinking over ' + ps.length + ' sources…');
      const r = await o.chat(DEEP_SYSTEM(today), [{role: 'user', content: prompt}], {maxTokens: 900});
      let j = null;
      try{ j = JSON.parse(String(r.text).slice(String(r.text).indexOf('{'), String(r.text).lastIndexOf('}') + 1)); }catch(e){ j = {answer: String(r.text || '').trim()}; }
      if(j.search && round < 2){ step('Searching again: ' + j.search); try{ const more = await o.search(j.search, 6); await readSome(more.results || [], 3); }catch(e){} continue; }
      if(j.open && round < 2 && /^https?:/.test(j.open)){ step('Opening a linked page…'); await readSome([{url: j.open, title: j.open}], 1); continue; }
      let text = String(j.answer || '').trim();
      if(!text) break;
      // held to the rules: what breaks them goes back to the AI once to fix, and is remembered so later answers avoid it
      const used = ps.map((p, i)=>({title: p.title, url: p.url, i: i + 1}));
      const ctx = {question, sources: ps.map((p, i)=>({n: i + 1, title: p.title, text: p.passage})), searched: true, timely};
      let issues = review(text, ctx).filter(i=>i.rule !== 'R6'), fixed = 0;
      if(issues.length){
        remember(issues, question);
        step('Checking the answer against the rules… fixing ' + issues.length + ' thing' + (issues.length === 1 ? '' : 's'));
        try{
          const r2 = await o.chat(DEEP_SYSTEM(today), [{role: 'user', content: prompt}, {role: 'assistant', content: JSON.stringify({answer: text})},
            {role: 'user', content: 'Your answer breaks these rules:\n' + issues.map(i=>'- ' + RULES[i.rule] + ': ' + i.text).join('\n') + '\nRewrite the whole answer so it follows them, using only the sources. Reply as JSON {"answer": "..."}.'}], {maxTokens: 900});
          let t2 = '';
          try{ t2 = JSON.parse(String(r2.text).slice(String(r2.text).indexOf('{'), String(r2.text).lastIndexOf('}') + 1)).answer; }catch(e){ t2 = String(r2.text || ''); }
          t2 = String(t2 || '').trim();
          const left = t2 ? review(t2, ctx).filter(i=>i.rule !== 'R6') : issues;
          if(t2 && left.length < issues.length){ fixed = issues.length - left.length; text = t2; issues = left; }
        }catch(e){}
      }
      const warn = issues.filter(i=>/R4|R5|R7|R8/.test(i.rule)).map(i=>'⚠ ' + i.text).join('\n');
      return {kind: 'web', text: text + (warn ? '\n\n' + warn : ''), sources: used, provider, issues, model: r.provider + ' · ' + r.model,
        by: r.provider + ' · ' + r.model + ' · read ' + ps.length + ' pages via ' + provider + (fixed ? ' · fixed ' + fixed + ' rule break' + (fixed === 1 ? '' : 's') : '')};
    }
    const ps = passagesOf();
    return {kind: 'web', text: 'The AI could not settle on an answer. The most relevant passages: ' + bestSentences(question, ps.map((p, i)=>({title: p.title, url: p.url, text: p.passage, rank: i})), 3).map(b=>b.s).join(' '), sources: ps.map(p=>({title: p.title, url: p.url})), provider};
  }

  /* ================================================================ REVIEW: rules every answer is held to
     review(answer, {question, sources:[{n, title, text}], extra (calculator results, files), searched, timely})
       -> [{rule, text}] — what breaks the rules. Used after every draft: the model gets these back and must fix them
       (search, open, calculate again), and each mistake is remembered so later answers start by avoiding it. */
  const RULES = {
    R1: 'A question about now must be searched',
    R2: 'Every fact with a number, name or date cites a source',
    R3: 'A cited source must be one that was read',
    R4: 'Every number comes from a source or the calculator',
    R5: 'Sums written in the answer must be right',
    R6: 'Day counts come from the calculator',
    R7: 'A forecast is reported as a forecast, not as a decision',
    R8: 'Names in the answer appear in the sources',
    R9: 'Answer once: no "Final answer" section, no repeating',
    R10: 'Something dated after today has not happened yet',
  };
  // dates written in a sentence ("5 to 7 October 2026", "October 5, 2026", "2026-10-05") -> [Date]
  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  function datesIn(t){
    const out = [], mo = m => MONTHS.indexOf(String(m).slice(0, 3).toLowerCase());
    for(const m of String(t).matchAll(/\b(\d{1,2})(?:st|nd|rd|th)?(?:\s*(?:to|-|–|and)\s*\d{1,2}(?:st|nd|rd|th)?)?\s+([A-Z][a-z]{2,8}),?\s+(\d{4})\b/g)) if(mo(m[2]) >= 0) out.push(new Date(Date.UTC(+m[3], mo(m[2]), +m[1])));
    for(const m of String(t).matchAll(/\b([A-Z][a-z]{2,8})\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s*(?:to|-|–|and)\s*\d{1,2})?,?\s+(\d{4})\b/g)) if(mo(m[1]) >= 0) out.push(new Date(Date.UTC(+m[3], mo(m[1]), +m[2])));
    for(const m of String(t).matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) out.push(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])));
    return out;
  }
  const COMMON = new Set(('The This That These Those There Here It Its In On At For From With By And Or But If As To Of A An According However Also Additionally ' +
    'Today Yesterday Tomorrow Note Sources Source Yes No January February March April May June July August September October November December ' +
    'Monday Tuesday Wednesday Thursday Friday Saturday Sunday I We You They He She Final Answer Thus Therefore So Overall Currently Latest').split(' '));
  const sentencesOf = t => String(t).match(/(?:[^.!?\n]|\.(?=\d))+[.!?]?/g) || [];
  function review(answer, c){
    c = c || {};
    const out = [], text = String(answer || ''), bare = text.replace(/\[\d+\]/g, '');
    const src = (c.sources || []).map(s=>String(s.title || '') + ' ' + String(s.text || '')).join(' ') + ' ' + String(c.extra || '');
    const srcL = src.toLowerCase();
    const nums = t => (String(t).match(/\d[\d,]*(?:\.\d+)?/g) || []).map(x=>x.replace(/,/g, '').replace(/\.$/, ''));
    const have = new Set(nums(src));
    if(c.timely && !c.searched) out.push({rule: 'R1', text: 'This is about now, but nothing was searched.'});
    // R3: citations to nothing
    const valid = new Set((c.sources || []).map(s=>+s.n));
    const bad = Array.from(new Set((text.match(/\[(\d+)\]/g) || []).map(x=>+x.slice(1, -1)).filter(n=>!valid.has(n))));
    if(bad.length && valid.size) out.push({rule: 'R3', text: 'Sources ' + bad.map(n=>'[' + n + ']').join(' ') + ' were never read.'});
    // R5: sums written out are worked again
    const val = x => parseFloat(String(x).replace(/[₹,\s]/g, ''));
    for(const m of text.matchAll(/(₹?\s?[\d,]+(?:\.\d+)?)\s*([×x*\/+−-])\s*(₹?\s?[\d,]+(?:\.\d+)?)\s*=\s*(₹?\s?[\d,]+(?:\.\d+)?)/g)){
      const a = val(m[1]), b = val(m[3]), r = val(m[4]);
      const want = m[2] === '/' ? a / b : m[2] === '+' ? a + b : /[−-]/.test(m[2]) ? a - b : a * b;
      if(Math.abs(want - r) <= Math.max(0.011, Math.abs(want) * 0.0005)) nums(m[4]).forEach(n=>have.add(n));
      else out.push({rule: 'R5', text: m[0].trim() + ' is wrong; it is ' + (Math.round(want * 100) / 100).toLocaleString('en-IN') + '. Use calculate.'});
    }
    // R6: day counts only from the calculator
    const counts = Array.from(bare.matchAll(/\b(\d+)\s+(days?|weeks?)\b/gi)).filter(m=>!new RegExp('\\b' + m[1] + '\\s+(days?|weeks?)', 'i').test(String(c.extra || ''))).map(m=>'"' + m[0] + '"');
    if(counts.length) out.push({rule: 'R6', text: Array.from(new Set(counts)).join(', ') + ' — not worked out with calculate; do not add days up yourself.'});
    // R10: told as done, but dated after today
    const today = new Date((c.today || new Date().toISOString().slice(0, 10)) + 'T00:00:00Z');
    // ("the meeting scheduled for 5 October" inside a sentence that says a decision was made is still a claim that it happened)
    const PAST = /\b(was|were|did|didn't|has been|had|kept|held|made|decided|announced|cut|raised|left|voted|confirmed|happened|took place|remained|stayed)\b/i;
    const FUTURE = /\b(will|upcoming|yet to|not yet|has not (yet )?(happened|taken place|been held|met)|hasn't|is (scheduled|due|set) to|are (scheduled|due|set) to|is scheduled for|are scheduled for|next (meeting|review|policy))\b/i;
    for(const x of sentencesOf(bare)){
      const after = datesIn(x).filter(d=>d > today);
      if(after.length && PAST.test(x) && !FUTURE.test(x)){ out.push({rule: 'R10', text: after[0].toISOString().slice(0, 10) + ' is after today (' + today.toISOString().slice(0, 10) + '), so "' + x.trim().slice(0, 80) + '" cannot have happened yet — check the source\'s date (it may be an older year).'}); break; }
    }
    // R4: numbers not in what was read (a year, a list number and small counts are fine)
    if(c.sources && c.sources.length){
      const foreign = Array.from(new Set(nums(bare.replace(/(^|\n)\s*\d+[.)]\s/g, ' ')).filter(n=>!have.has(n) && !/^(19|20)\d\d$/.test(n) && (n.length >= 3 || /\./.test(n)))));
      if(foreign.length) out.push({rule: 'R4', text: 'These numbers are not in what was read: ' + foreign.slice(0, 5).join(', ') + '.'});
    }
    // R2: sentences with figures and no source mark
    if(valid.size){
      const uncited = sentencesOf(text).filter(x=>/\d[\d,]*\.\d|\d{3,}|₹|%/.test(x.replace(/\b(19|20)\d\d\b/g, '')) && !/\[\d+\]/.test(x) && x.trim().length > 20);
      if(uncited.length) out.push({rule: 'R2', text: 'Mark the source for: "' + uncited[0].trim().slice(0, 90) + '"'});
    }
    // R7: a figure stated as decided where every source sentence with it is a forecast
    const FORE = /\b(expect|expected|expects|may|might|likely|could|poll|forecast|predict|predicted|projected|see|sees|economists|analysts|estimate)\b/i;
    const DONE = /\b(raised|hiked|cut|reduced|increased|decreased|kept|held|left|unchanged|decided|announced|set|approved|won|launched)\b/i;
    for(const s of sentencesOf(bare)){
      if(!DONE.test(s) || FORE.test(s)) continue;
      for(const n of nums(s).filter(x=>x.length >= 3 || /\./.test(x))){
        const around = sentencesOf(src).filter(x=>x.replace(/,/g, '').includes(n));
        if(around.length && around.every(x=>FORE.test(x) && !DONE.test(x))){ out.push({rule: 'R7', text: n + ' appears in the sources only as an expectation, but the answer states it as decided.'}); break; }
      }
    }
    // R8: names the sources never mention
    if(c.sources && c.sources.length){
      const q = String(c.question || '').toLowerCase();
      const names = Array.from(new Set((bare.match(/\b[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})*/g) || []).filter(w=>!COMMON.has(w.split(' ')[0]) && !q.includes(w.toLowerCase()))));
      const missing = names.filter(w=>!srcL.includes(w.toLowerCase()) && !w.split(' ').every(x=>srcL.includes(x.toLowerCase())));
      if(missing.length) out.push({rule: 'R8', text: 'Not in any source read: ' + missing.slice(0, 4).join(', ') + '.'});
    }
    // R9: answer once
    const sents = sentencesOf(bare).map(x=>x.trim().toLowerCase()).filter(x=>x.length >= 25);
    if(/\bfinal answer\b/i.test(text) || sents.length !== new Set(sents).size) out.push({rule: 'R9', text: 'Say it once — remove the "Final answer" part and repeated sentences.'});
    return out;
  }
  /* Mistakes it made before, from its memory (Money Brain): the most frequent first -> lines for the instructions */
  function pastMistakes(){
    if(typeof MoneyBrain === 'undefined') return [];
    return MoneyBrain.lessons({app: 'ai', topic: 'mistake'}).filter(L=>!L.off).sort((a, b)=>b.n - a.n).slice(0, 5).map(L=>RULES[L.key] ? RULES[L.key] + ' (missed ' + L.n + ' time' + (L.n === 1 ? '' : 's') + ')' : '').filter(Boolean);
  }
  function remember(issues, question){
    if(typeof MoneyBrain === 'undefined') return;
    if(question) learnCase(question, issues);
    Array.from(new Set(issues.map(i=>i.rule))).forEach(r=>MoneyBrain.learn('ai', 'mistake', r, 'yes', {label: 'Answers: ' + RULES[r], why: 'Caught by the reviewer and corrected'}));
  }

  /* ================================================================ CASES: what went wrong on a particular question, remembered
     A rule count says "you break R10 sometimes"; a case says what exactly happened, so a question like it next time
     starts with the lesson. Kept in Money Brain (topic 'case'), so it syncs like every other lesson. */
  const keyWords = q => Array.from(new Set(words(q).map(stem))).filter(w=>w.length > 2).sort();
  function caseText(question, issue, today){
    const q = '“' + String(question).trim().slice(0, 90) + '”';
    if(issue.rule === 'R10') return 'For ' + q + ': on ' + today + ' the event (' + issue.text.slice(0, 10) + ') was still ahead; pages saying it had happened were about an older year. Check the year of every page and say it has not happened yet.';
    if(issue.rule === 'R7') return 'For ' + q + ': ' + issue.text + ' Report expectations as expectations.';
    if(issue.rule === 'R6') return 'For ' + q + ': the day count was added up by hand and came out wrong. Use calculate for day counts.';
    if(issue.rule === 'R4') return 'For ' + q + ': ' + issue.text + ' Use only numbers from the pages read.';
    if(issue.rule === 'R8') return 'For ' + q + ': ' + issue.text + ' Name only what the pages name.';
    return '';
  }
  function learnCase(question, issues, o){
    if(typeof MoneyBrain === 'undefined') return;
    o = o || {};
    const today = o.today || new Date().toISOString().slice(0, 10), kw = keyWords(question);
    if(kw.length < 2) return;
    const similar = rule => MoneyBrain.lessons({app: 'ai', topic: 'case'}).find(L=>{ const [r, w] = String(L.key).split('|'); const theirs = w.split(' '); return r === rule && theirs.filter(x=>kw.includes(x)).length / Math.max(3, kw.length, theirs.length) >= 0.6; });
    (issues || []).forEach(i=>{
      const text = o.text || caseText(question, i, today);
      const same = similar(i.rule || 'you');                      // the same lesson again: made surer, not written twice
      if(text) MoneyBrain.learn('ai', 'case', same ? same.key : (i.rule || 'you') + '|' + kw.join(' '), same && !o.text ? MoneyBrain.recall('ai', 'case', same.key, {min: 0.001}).value : text, {label: String(question).slice(0, 120), why: o.text ? 'You corrected it' : i.text, weight: o.text ? 3 : 1});
    });
  }
  // lessons from questions like this one (most shared key words first)
  function casesFor(question, max, o){
    if(typeof MoneyBrain === 'undefined') return [];
    const kw = keyWords(question);
    return MoneyBrain.lessons({app: 'ai', topic: 'case'}).filter(L=>!L.off).map(L=>{
      const theirs = String(L.key).split('|')[1].split(' '), shared = theirs.filter(w=>kw.includes(w)).length;
      return {L, score: shared / Math.max(3, kw.length, theirs.length)};
    }).filter(x=>x.score >= 0.6).sort((a, b)=>b.score - a.score).slice(0, max || 3).map(x=>{ const r = MoneyBrain.recall('ai', 'case', x.L.key, {min: 0.001}); return r ? r.value : ''; })
      // "it has not happened yet" stops being true on the day: such a lesson ends then
      .filter(t=>{ const m = /the event \((\d{4}-\d{2}-\d{2})\) was still ahead/.exec(t); return t && !(m && m[1] <= (o && o.today || new Date().toISOString().slice(0, 10))); });
  }
  /* Before the model starts: a question about this month or later may be about something that has not happened */
  function timingNote(question, today){
    today = today || new Date().toISOString().slice(0, 10);
    const [Y, M] = today.split('-').map(Number), q = String(question);
    const named = [];
    for(const m of q.matchAll(/\b([A-Z][a-z]{2,8})\s+(\d{4})\b/g)){ const mo = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()); if(mo >= 0 && (+m[2] > Y || +m[2] === Y && mo + 1 >= M)) named.push(m[0]); }
    datesIn(q).forEach(d=>{ if(d.toISOString().slice(0, 10) >= today) named.push(d.toISOString().slice(0, 10)); });
    if(/\b(this|next) (week|month)\b|\bupcoming\b/i.test(q)) named.push(q.match(/\b(this|next) (week|month)\b|\bupcoming\b/i)[0]);
    return named.length ? 'Timing: today is ' + today + ' and the question is about ' + named[0] + ', which is now or later — it may not have happened yet. Check the date and year of every page; old pages about the same month of an earlier year are common. If it is still ahead, say so plainly.' : '';
  }

  /* Web search for the apps, in the browser: this Mac's helper first (your SearXNG, pages read on the Mac, no keys),
     then your Cloudflare relay (Tavily and Jina keys) — on a phone, or when the Mac's helper does not answer. */
  const LOCAL_HELPER = 'http://127.0.0.1:8899';
  function one(base, token){
    base = String(base).replace(/\/+$/, '');
    const call = async path => {
      const r = await fetch(base + path, token ? {headers: {'x-relay-token': token}} : {});
      const d = await r.json().catch(()=>({error: 'It answered ' + r.status}));
      if(!r.ok || d.error) throw new Error(d.error || 'It answered ' + r.status);
      return d;
    };
    return {search: (q, n) => call('/search?n=' + (n || 8) + '&q=' + encodeURIComponent(q)), read: (url, links) => call('/read?links=' + (links ? 1 : 0) + '&url=' + encodeURIComponent(url)),
      health: () => fetch(base + '/health').then(r=>r.json())};
  }
  let localState = null;                       // checked once per page: is this Mac's helper here?
  async function localHelper(){
    if(localState === null){
      localState = (async ()=>{ try{ const r = await Promise.race([fetch(LOCAL_HELPER + '/health'), new Promise((_, rej)=>setTimeout(()=>rej(new Error('slow')), 1500))]); const d = await r.json(); return !!(d && d.ok && d.search && d.search.searxng); }catch(e){ return false; } })();
    }
    return localState;
  }
  function relay(cfg, o){
    const cloud = cfg && cfg.url && cfg.token ? one(cfg.url, cfg.token) : null;
    const local = (o && o.local === false) ? null : one(LOCAL_HELPER, '');
    const used = [];
    const chain = name => async (...args) => {
      if(local && await localHelper()){ try{ const r = await local[name](...args); used.push(name === 'search' ? 'your SearXNG' : 'this Mac'); return r; }catch(e){ if(!cloud) throw e; } }
      if(cloud){ const r = await cloud[name](...args); used.push(name === 'search' ? (r.provider || 'your relay') : 'your relay'); return r; }
      throw new Error('No web search here: this device has no AI helper, and no relay is set in Setup.');
    };
    return {search: chain('search'), read: chain('read'), used, local: ()=>localHelper(),
      health: async () => ({local: await localHelper(), cloud: cloud ? await cloud.health().catch(e=>({error: e.message})) : null})};
  }

  return {answer, rephrase, deep, relay, review, datesIn, learnCase, casesFor, timingNote, pastMistakes, remember, RULES, calc, arith, bestSentences, wikidata, currency, weather, define, localTime};
})();
if(typeof window !== 'undefined') window.MoneyWeb = MoneyWeb;
if(typeof module !== 'undefined') module.exports = MoneyWeb;
