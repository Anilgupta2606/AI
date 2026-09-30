"use strict";
/* =========================================================
   MONEY ASK — questions about your own money and trips answered from your data, exactly, without an AI.
   "How much did I spend on food last month?", "Where did my money go in September?", "How much on Swiggy this year?",
   "Did I spend more than last month?", "How much did I invest / save?", "When is my next trip?", "What did the Goa trip
   cost?", "Which documents expire soon?", "Am I on track for my target?", "What is my SIP?".
   answer(question, data) -> {text, facts} or null (then an AI answers, and checkFigures() flags any ₹ figure it
   invented). data: {today, txns (Expense Tracker), ledger {netWorth, corpus, targetLow, targetHigh, retire, yearsLeft, sip},
   trips [{name, city, start, end}], docs [{type, label, person, validUntil}]}. Measured by test/exam/ask.*
   ========================================================= */
const MoneyAsk = (function(){
  const inr = n => (n < 0 ? '−' : '') + '₹' + Math.round(Math.abs(n)).toLocaleString('en-IN');
  const big = n => { const a = Math.abs(n), s = n < 0 ? '−' : ''; return a >= 1e7 ? s + '₹' + (a / 1e7).toFixed(2) + ' Cr' : a >= 1e5 ? s + '₹' + (a / 1e5).toFixed(2) + ' L' : inr(n); };
  const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  const ym = d => d.toISOString().slice(0, 7);
  const shiftM = (m, k) => { const d = new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7) - 1 + k, 1)); return ym(d); };
  const label = m => MONTHS[+m.slice(5, 7) - 1].replace(/^./, c=>c.toUpperCase()) + ' ' + m.slice(0, 4);

  // what people call each category (English and Hinglish)
  const CAT = [
    ['Food & Dining', /\b(food|eat(ing)?( out)?|restaurants?|dining|swiggy|zomato|takeaway|delivery|khana|order(ing|ed)? in)\b/],
    ['Groceries', /\b(groceries|grocery|kirana|sabzi|vegetables|milk|blinkit|zepto|instamart|bigbasket|supermarket)\b/],
    ['Shopping', /\b(shopping|clothes|amazon|flipkart|myntra|gadgets|electronics)\b/],
    ['Transport', /\b(transport|cabs?|uber|ola|auto|metro|commute|taxi|rapido)\b/],
    ['Fuel', /\b(fuel|petrol|diesel|cng)\b/],
    ['Travel', /\b(travel|flights?|trains?|hotels?|holidays?|vacations?)\b/],
    ['Bills & Utilities', /\b(bills?|utilities|electricity|water|gas|maintenance|society)\b/],
    ['Mobile & Internet', /\b(mobile|phone|internet|broadband|recharge|wifi|dth)\b/],
    ['Rent & Housing', /\b(rent|housing)\b/],
    ['Health', /\b(health|medicines?|medical|doctor|hospital|pharmacy|gym|fitness)\b/],
    ['Education', /\b(education|school|fees|tuition|courses?)\b/],
    ['Entertainment', /\b(entertainment|movies?|cinema|games?|outings?)\b/],
    ['Subscriptions', /\b(subscriptions?|netflix|spotify|prime|hotstar|ott)\b/],
    ['Personal Care', /\b(personal care|salon|haircuts?|spa|grooming|parlou?r)\b/],
    ['Insurance', /\b(insurance|premiums?)\b/],
    ['EMI & Loans', /\b(emis?|loans?)\b/],
    ['Taxes', /\b(tax|taxes)\b/],
    ['Cash Withdrawal', /\b(cash|atm)\b/],
    ['Gifts & Donations', /\b(gifts?|donations?|charity)\b/],
    ['Family', /\b(family|parents)\b/],
  ];

  /* the period a question is about -> {from, to, name} (YYYY-MM-DD) */
  function period(q, today, lastData){
    const mNow = (lastData && lastData < today ? lastData : today).slice(0, 7);
    const monthRange = m => ({from: m + '-01', to: shiftM(m, 1) + '-00', name: label(m), month: m});
    // "this month vs last month": the question is about this month (the comparison adds the month before)
    if(/\bthis month\b|\bso far this month\b|\bis mahine\b/.test(q)) return monthRange(mNow);
    if(/\blast month\b|\bprevious month\b|\bpichle mahine\b/.test(q)) return monthRange(shiftM(mNow, -1));
    const nm = /\b(?:last|past|previous)\s+(\d+|two|three|four|five|six|twelve)\s+months\b/.exec(q);
    // "the last 3 months": the 3 full months before this one (this month is not over yet)
    if(nm){ const n = {two: 2, three: 3, four: 4, five: 5, six: 6, twelve: 12}[nm[1]] || +nm[1]; const end = mNow === today.slice(0, 7) ? mNow : shiftM(mNow, 1);
      return {from: shiftM(end, -n) + '-01', to: end + '-00', name: 'the last ' + n + ' full months (' + label(shiftM(end, -n)).split(' ')[0] + '–' + label(shiftM(end, -1)) + ')'}; }
    if(/\bthis year\b|\bso far this year\b|\bytd\b/.test(q)) return {from: today.slice(0, 4) + '-01-01', to: today.slice(0, 4) + '-12-31', name: today.slice(0, 4) + ' so far'};
    if(/\blast year\b/.test(q)){ const y = +today.slice(0, 4) - 1; return {from: y + '-01-01', to: y + '-12-31', name: String(y)}; }
    const mm = new RegExp('\\b(' + MONTHS.map(m=>m.slice(0, 3) + '(?:' + m.slice(3) + ')?').join('|') + ')\\b(?:\\s+(\\d{4}))?').exec(q);
    if(mm){ const i = MONTHS.findIndex(m=>mm[1].startsWith(m.slice(0, 3))); let y = mm[2] ? +mm[2] : +today.slice(0, 4); if(!mm[2] && i + 1 > +today.slice(5, 7)) y--; return monthRange(y + '-' + String(i + 1).padStart(2, '0')); }
    const yy = /\b(?:in|for|during)\s+(20\d\d)\b/.exec(q);
    if(yy) return {from: yy[1] + '-01-01', to: yy[1] + '-12-31', name: yy[1]};
    return null;
  }
  const inP = (t, p) => t.date >= p.from && t.date <= (p.to.endsWith('-00') ? p.to.slice(0, 7) + '-99' : p.to) && !(p.to.endsWith('-00') && t.date.slice(0, 7) >= p.to.slice(0, 7));
  const within = (t, p) => p.to.endsWith('-00') ? t.date >= p.from && t.date.slice(0, 7) < p.to.slice(0, 7) : t.date >= p.from && t.date <= p.to;
  /* totals the Expense Tracker's way (refunds lower spend; a paired card bill is not spend twice) */
  function totals(txns, p){
    const a = {spend: 0, refunds: 0, invested: 0, redeemed: 0, income: 0, n: 0, byCat: {}, byMerchant: {}};
    txns.forEach(t=>{
      if(!within(t, p) || t.excluded || t.kind === 'ignore') return;
      const out = t.direction === 'debit';
      if(t.kind === 'spend'){ if(out){ a.spend += t.amount; a.n++; a.byCat[t.category || 'Other'] = (a.byCat[t.category || 'Other'] || 0) + t.amount; const mk = t.merchantName || 'Other'; a.byMerchant[mk] = (a.byMerchant[mk] || 0) + t.amount; } else { a.refunds += t.amount; a.byCat[t.category || 'Other'] = (a.byCat[t.category || 'Other'] || 0) - t.amount; } }
      else if(t.kind === 'investment'){ if(out) a.invested += t.amount; else a.redeemed += t.amount; }
      else if(t.kind === 'cc_bill'){ if(out && !t.paired) a.spend += t.amount; }
      else if(t.kind === 'income' && !out) a.income += t.amount;
    });
    a.spend -= a.refunds;
    return a;
  }
  const catOf = q => CAT.filter(([, re])=>re.test(q)).map(([c])=>c);
  const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
  const niceDate = d => { const x = new Date(d + 'T00:00:00Z'); return x.getUTCDate() + ' ' + MONTHS[x.getUTCMonth()].slice(0, 3).replace(/^./, c=>c.toUpperCase()) + ' ' + x.getUTCFullYear(); };

  function answer(question, data){
    const q = ' ' + String(question || '').toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ') + ' ';
    data = data || {};
    const today = data.today || new Date().toISOString().slice(0, 10);
    const txns = data.txns || [];
    const lastData = txns.length ? txns.reduce((m, t)=>t.date > m ? t.date : m, '') : '';
    const facts = [];
    const say = (text) => ({text, facts, by: 'Money Brain · from your data (no AI)'});

    // ---- trips (before money: "what did the Goa trip cost" is about a trip)
    const trips = (data.trips || []).slice().sort((a, b)=>String(a.start).localeCompare(String(b.start)));
    const namedTrip = trips.find(t=>[t.name, t.city].filter(Boolean).some(n=>String(n).toLowerCase().split(/[^a-z]+/).filter(w=>w.length >= 3 && !/^(with|the|and|trip|family|friends|our|my)$/.test(w)).some(w=>q.includes(' ' + w + ' ') || q.includes(' ' + w + "'"))));
    if(/\btrip\b|\bholiday\b|\bvacation\b/.test(q) && namedTrip && /\bcost|spen[dt]|expens|how much\b/.test(q)){
      if(!txns.length) return say('The Expense Tracker has no statements in this browser yet, so I cannot add up ' + namedTrip.name + '.');
      const p = {from: namedTrip.start, to: namedTrip.end || namedTrip.start};
      const a = totals(txns, p);
      const cats = Object.entries(a.byCat).filter(([, v])=>v > 0).sort((x, y)=>y[1] - x[1]).slice(0, 4);
      return say(`During ${namedTrip.name} (${niceDate(p.from)} – ${niceDate(p.to)}) you spent ${inr(a.spend)}${cats.length ? ': ' + cats.map(([c, v])=>c + ' ' + inr(v)).join(', ') : ''}. Bookings paid before the trip are not in this total.`);
    }
    if(/\bnext trip\b|\bupcoming trip|\bwhen (is|are) (my|our|the) (next )?trip|\bhow many days (to|until|till|before)\b.*\btrip|\bwhen do (we|i) (leave|fly|go)\b/.test(q)){
      const next = trips.find(t=>(t.end || t.start) >= today);
      if(!next) return say('There is no upcoming trip in Trip Vault.');
      const d = days(today, next.start);
      return say(`Your next trip is ${next.name}${next.city ? ' (' + next.city + ')' : ''}, ${niceDate(next.start)}${next.end ? ' to ' + niceDate(next.end) : ''} — ${d > 0 ? 'in ' + d + ' day' + (d === 1 ? '' : 's') : d === 0 ? 'today' : 'happening now'}.`);
    }
    // ---- documents
    if(/\bexpir|\brenew|\bvalid(ity)?\b|\bout of date\b/.test(q) && /\bdocuments?|passports?|licen[cs]e|visa|insurance|policy|cards?\b/.test(q)){
      const soon = (data.docs || []).filter(d=>d.validUntil).map(d=>Object.assign({}, d, {left: days(today, d.validUntil)})).filter(d=>d.left <= 183).sort((a, b)=>a.left - b.left);
      if(!(data.docs || []).some(d=>d.validUntil)) return say('No document in Trip Vault has an expiry date yet.');
      if(!soon.length) return say('Nothing expires in the next 6 months.');
      return say('Expiring within 6 months: ' + soon.map(d=>`${d.label}${d.person ? ' of ' + d.person : ''} — ${d.left < 0 ? 'expired ' + niceDate(d.validUntil) : niceDate(d.validUntil) + ' (' + d.left + ' days)'}`).join('; ') + '.');
    }
    // ---- the plan (16-Year Ledger)
    const L = data.ledger;
    if(L && /\bnet ?worth\b|\bhow much (am i|are we) worth\b/.test(q)) return say(`Your net worth is ${big(L.netWorth)}${L.corpus ? ', of which ' + big(L.corpus) + ' counts towards retirement' : ''}.`);
    if(L && /\bsip\b|\bsips\b|\bmonthly investment\b/.test(q) && !/\bhow much did i\b/.test(q)) return say(`Your monthly SIPs add up to ${inr(L.sip)}.`);
    if(L && /\bon track\b|\btarget\b|\bretire|\bcorpus\b/.test(q)){
      if(!L.targetHigh) return say(`Your retirement corpus is ${big(L.corpus)}; set a target in the Ledger to see how far along you are.`);
      const pctDone = L.corpus / (L.targetHigh * 1e7) * 100;
      return say(`Your retirement corpus is ${big(L.corpus)} — ${pctDone.toFixed(1)}% of the ₹${L.targetLow ? L.targetLow + '–' : ''}${L.targetHigh} Cr target${L.yearsLeft != null ? ', with ' + L.yearsLeft.toFixed(1) + ' years to go (retiring at ' + L.retire + ')' : ''}. Whether that is on track depends on the plan's growth assumptions — the Ledger's Overview shows the projection.`);
    }
    // ---- money in and out (the Expense Tracker)
    const moneyQ = /\bspen[dt]|\bspending|\bexpens|\bcost me|\bpaid\b|\bkharch|\bwent (to|on)\b|\bhow much (on|for|at|to)\b|\btotal (on|for)\b|\bearn|\bincome|\bsalary|\breceived|\bgot paid|\binvest|\bsav(e|ed|ing|ings)\b|\bwhere did (my|the) money go|\bbreakdown\b|\bbiggest\b|\bmost on\b|\btop (categories|spends?)/.test(q);
    if(!moneyQ) return null;
    if(!txns.length) return say('The Expense Tracker has no statements in this browser yet — upload one there and ask again.');
    const firstData = txns.reduce((m, t)=>!m || t.date < m ? t.date : m, '');
    const named = catOf(q).length || Array.from(new Set(txns.map(t=>t.merchantName).filter(Boolean))).some(m=>{ const w = String(m).toLowerCase().split(/[^a-z0-9]+/).filter(x=>x.length >= 4)[0]; return w && q.includes(' ' + w); });
    const p = period(q, today, lastData) || (named && !/\bmonth\b/.test(q)
      ? {from: firstData, to: lastData, name: 'your statements (' + label(firstData.slice(0, 7)) + ' – ' + label(lastData.slice(0, 7)) + ')'}
      : {from: lastData.slice(0, 7) + '-01', to: shiftM(lastData.slice(0, 7), 1) + '-00', name: label(lastData.slice(0, 7)) + ' (your latest month)', month: lastData.slice(0, 7)});
    const a = totals(txns, p);
    // compare with the month before
    if(/\bmore than\b|\bless than\b|\bcompared?\b|\bvs\.?\b|\bversus\b|\bthan last month\b/.test(q) && p.month){
      const prevM = shiftM(p.month, -1), b = totals(txns, {from: prevM + '-01', to: shiftM(prevM, 1) + '-00'});
      const diff = a.spend - b.spend;
      return say(`You spent ${inr(a.spend)} in ${p.name} and ${inr(b.spend)} in ${label(prevM)} — ${diff >= 0 ? inr(diff) + ' more' : inr(-diff) + ' less'} (${b.spend ? (diff / b.spend * 100 >= 0 ? '+' : '') + (diff / b.spend * 100).toFixed(0) + '%' : 'no spend the month before'}).`);
    }
    if(/\bearn|\bincome|\bsalary|\breceived|\bgot paid/.test(q)) return say(`Money in during ${p.name}: ${inr(a.income)}.`);
    if(/\binvest/.test(q)) return say(`You invested ${inr(a.invested)} in ${p.name}${a.redeemed ? ' and took out ' + inr(a.redeemed) : ''}.`);
    if(/\bsav(e|ed|ing|ings)\b/.test(q)){ const saved = a.income - a.spend; return say(`In ${p.name}: ${inr(a.income)} came in and ${inr(a.spend)} was spent — ${saved >= 0 ? inr(saved) + ' saved' : inr(-saved) + ' more spent than earned'}${a.income ? ' (' + (saved / a.income * 100).toFixed(0) + '% of income)' : ''}${a.invested ? '; ' + inr(a.invested) + ' of it went into investments' : ''}.`); }
    // a merchant named in the question
    const merchants = Object.keys(a.byMerchant).concat(txns.map(t=>t.merchantName).filter(Boolean));
    const mk = Array.from(new Set(merchants)).find(m=>{ const w = String(m).toLowerCase().split(/[^a-z0-9]+/).filter(x=>x.length >= 4)[0]; return w && q.includes(' ' + w); });
    if(mk && /\bon\b|\bat\b|\bto\b|\bfrom\b/.test(q)){
      const w = String(mk).toLowerCase().split(/[^a-z0-9]+/).filter(x=>x.length >= 4)[0];
      let sum = 0, n = 0; txns.forEach(t=>{ if(within(t, p) && t.direction === 'debit' && !t.excluded && String(t.merchantName || '').toLowerCase().includes(w)){ sum += t.amount; n++; } });
      return say(`${mk.replace(/^./, c=>c.toUpperCase())}: ${inr(sum)} in ${p.name} (${n} payment${n === 1 ? '' : 's'}).`);
    }
    const cats = catOf(q);
    if(cats.length){
      const parts = cats.map(c=>[c, a.byCat[c] || 0]);
      const sum = parts.reduce((s, x)=>s + x[1], 0);
      return say(parts.length === 1 ? `You spent ${inr(sum)} on ${parts[0][0]} in ${p.name}${a.spend ? ' — ' + (sum / a.spend * 100).toFixed(0) + '% of all spending' : ''}.`
        : `In ${p.name}: ` + parts.map(([c, v])=>c + ' ' + inr(v)).join(', ') + ` — ${inr(sum)} together.`);
    }
    // everything, with the biggest categories
    const top = Object.entries(a.byCat).filter(([, v])=>v > 0).sort((x, y)=>y[1] - x[1]).slice(0, 5);
    return say(`You spent ${inr(a.spend)} in ${p.name}${top.length ? '. Biggest: ' + top.map(([c, v])=>c + ' ' + inr(v)).join(', ') : ''}.`);
  }

  /* An AI's answer checked against your data: a ₹ figure that is not in it (or a sum of it) is flagged. */
  function checkFigures(text, known){
    const nums = s => (String(s).match(/₹\s?[\d,]+(?:\.\d+)?\s*(?:cr(?:ore)?|l(?:akh|ac)?s?)?/gi) || []).map(x=>{
      const v = parseFloat(x.replace(/[₹,\s]/g, '').replace(/[a-z]+$/i, '')), unit = (/cr/i.test(x) ? 1e7 : /\d\s*l/i.test(x) ? 1e5 : 1);
      return {raw: x.trim(), v: v * unit};
    });
    const have = nums(known).map(x=>x.v);
    const ok = v => have.some(h=>Math.abs(h - v) <= Math.max(1, Math.abs(h) * 0.015)) || v < 100;
    const unknown = nums(text).filter(x=>!ok(x.v));
    return unknown.map(x=>x.raw);
  }

  return {answer, checkFigures, period, totals, inr, big};
})();
if(typeof window !== 'undefined') window.MoneyAsk = MoneyAsk;
if(typeof module !== 'undefined') module.exports = MoneyAsk;
