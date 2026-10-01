"use strict";
/* =========================================================
   MONEY BRAIN — the site's own thinking and learning, shared by every app
   (Money Home, Trip Vault, the Ledger, the Expense Tracker). No AI model:
   plain code that
   · LEARNS from what you do (an edit, a delete, a lock, a correction): each
     lesson grows with every repeat, fades when it stops happening, and can
     be seen, edited or forgotten in Setup → What it has learned;
   · KNOWS facts from the internet, cached with where and when they came from;
   · THINKS with exact tools: distances and travel times, opening hours,
     a scheduler that searches for the best day, and explains each choice;
   · UNDERSTANDS plain requests ("too packed", "we are vegetarian", "no
     temples", "meeting on the 14th at 3 pm") without asking an AI.
   Nothing here leaves the device except inside the encrypted settings sync.
   Loads in the browser (window.MoneyBrain) and in node (tests).
   ========================================================= */
const MoneyBrain = (function(){
  const KEY = 'money-brain', HALF_LIFE_DAYS = 120, MIN_CONFIDENCE = 0.6;
  const store = () => { try{ return typeof localStorage !== 'undefined' ? localStorage : null; }catch(e){ return null; } };
  const read = () => { try{ const s = store(); return JSON.parse((s && s.getItem(KEY)) || 'null') || {v: 1, lessons: {}}; }catch(e){ return {v: 1, lessons: {}}; } };
  let mem = read();
  // another tab, or another program on this Mac (the terminal and the helper), may have learned meanwhile
  const reload = () => { mem = read(); };
  try{ if(typeof window !== 'undefined' && window.addEventListener) window.addEventListener('storage', e=>{ if(e.key === KEY) reload(); }); }catch(e){}
  function write(){
    mem.updatedAt = Date.now();
    try{ const s = store(); if(s) s.setItem(KEY, JSON.stringify(mem)); }catch(e){}
    try{ if(typeof MoneyShared !== 'undefined' && MoneyShared.markChanged) MoneyShared.markChanged(); }catch(e){}
    try{ if(typeof window !== 'undefined' && window.dispatchEvent) window.dispatchEvent(new CustomEvent('moneybrain-change')); }catch(e){}
  }
  const now = () => Date.now();
  const fade = (w, since) => w * Math.pow(0.5, Math.max(0, now() - since) / (HALF_LIFE_DAYS * 86400000));

  /* ================================================================ memory: lessons
     A lesson is one belief about you: app + topic + key -> value, with the evidence for it.
       choice  (votes for each value: "Swiggy" -> Food 12, Groceries 1; "museum" -> like 3, dislike 1)
       number  (a running average: lunch at about 13:30)
     learn() adds evidence; recall() answers only when the evidence is clear enough. */
  const idOf = (app, topic, key) => app + ':' + topic + ':' + String(key).toLowerCase();
  function learn(app, topic, key, value, o){
    o = o || {};
    if(key === undefined || key === null || key === '' || value === undefined || value === null || value === '') return null;
    const id = idOf(app, topic, key), w = o.weight === undefined ? 1 : o.weight;
    const L = mem.lessons[id] || {id, app, topic, key: String(key), kind: typeof value === 'number' ? 'number' : 'choice', votes: {}, n: 0, first: now()};
    if(L.pinned && !o.force) return L;
    if(L.kind === 'number'){
      const old = fade(L.w || 0, L.last || now());
      L.mean = old + w > 0 ? ((L.mean || 0) * old + value * w) / (old + w) : value;
      L.w = old + w;
    } else {
      Object.keys(L.votes).forEach(v=>{ L.votes[v] = fade(L.votes[v], L.last || now()); });
      L.votes[value] = (L.votes[value] || 0) + w;
    }
    L.n += 1; L.last = now();
    if(o.label) L.label = o.label;
    if(o.why) L.why = String(o.why).slice(0, 160);
    L.examples = [String(o.example || o.why || '').slice(0, 100)].concat(L.examples || []).filter(Boolean).slice(0, 3);
    mem.lessons[id] = L;
    write();
    return L;
  }
  /* -> {value, confidence (0-1), n, lesson} or null when it has not learned enough (or you switched it off) */
  function recall(app, topic, key, o){
    const L = mem.lessons[idOf(app, topic, key)];
    if(!L || L.off) return null;
    if(L.kind === 'number'){
      const w = L.pinned ? 9 : fade(L.w || 0, L.last);
      const confidence = L.pinned ? 1 : Math.min(1, w / 3);
      if(confidence < ((o && o.min) || 0.3)) return null;
      return {value: L.mean, confidence, n: L.n, lesson: L};
    }
    const votes = Object.entries(L.votes).map(([v, w])=>[v, L.pinned ? w : fade(w, L.last)]).sort((a, b)=>b[1] - a[1]);
    if(!votes.length) return null;
    const total = votes.reduce((s, x)=>s + x[1], 0), top = votes[0];
    // confidence: how one-sided the votes are, times how much evidence there is
    const confidence = L.pinned ? 1 : (top[1] / total) * Math.min(1, total / 3);
    if(confidence < ((o && o.min) || MIN_CONFIDENCE)) return null;
    return {value: top[0], confidence, n: L.n, lesson: L};
  }
  const lessons = f => Object.values(mem.lessons).filter(L=>!f || ((!f.app || L.app === f.app) && (!f.topic || L.topic === f.topic)))
    .sort((a, b)=>(b.last || 0) - (a.last || 0));
  function forget(id){ delete mem.lessons[id]; (mem.forgotten = mem.forgotten || {})[id] = now(); write(); }
  function forgetAll(){ Object.keys(mem.lessons).forEach(id=>{ (mem.forgotten = mem.forgotten || {})[id] = now(); }); mem.lessons = {}; write(); }
  function switchOff(id, off){ const L = mem.lessons[id]; if(L){ L.off = !!off; L.last = now(); write(); } }
  /* You say what is right: the lesson is fixed to it (learning does not move it any more) */
  function pin(id, value){
    const L = mem.lessons[id];
    if(!L) return;
    if(L.kind === 'number') L.mean = +value; else L.votes = {[value]: 9};
    L.pinned = true; L.off = false; L.last = now(); write();
  }
  /* For the encrypted settings sync: every lesson, and which were forgotten. */
  const exportAll = () => JSON.parse(JSON.stringify({lessons: mem.lessons, forgotten: mem.forgotten || {}, updatedAt: mem.updatedAt || 0}));
  /* Another device's memory: the lesson changed last wins; forgetting sticks unless it was learned again after. */
  function merge(other){
    if(!other || !other.lessons) return false;
    let changed = false;
    const forgotten = Object.assign({}, other.forgotten || {}, mem.forgotten || {});
    Object.values(other.lessons).forEach(L=>{
      const mine = mem.lessons[L.id];
      if((forgotten[L.id] || 0) >= (L.last || 0)) return;
      if(!mine || (L.last || 0) > (mine.last || 0)){ mem.lessons[L.id] = L; changed = true; }
    });
    Object.keys(mem.lessons).forEach(id=>{ if((forgotten[id] || 0) >= (mem.lessons[id].last || 0)){ delete mem.lessons[id]; changed = true; } });
    mem.forgotten = forgotten;
    if(changed) write();
    return changed;
  }
  /* In words, for the "What it has learned" page */
  function describe(L){
    if(L.label) return L.label;
    if(L.kind === 'number') return L.topic + ' ' + L.key + ': about ' + Math.round(L.mean * 10) / 10;
    const top = Object.entries(L.votes).sort((a, b)=>b[1] - a[1])[0];
    return L.key + ' → ' + (top ? top[0] : '?');
  }
  function confidenceOf(L){
    if(L.pinned) return 1;
    if(L.kind === 'number') return Math.min(1, fade(L.w || 0, L.last) / 3);
    const v = Object.values(L.votes).map(w=>fade(w, L.last)), t = v.reduce((s, x)=>s + x, 0);
    return t ? (Math.max.apply(null, v) / t) * Math.min(1, t / 3) : 0;
  }

  /* ================================================================ facts from the internet
     get(key, fetcher, {ttl}) -> the cached value while fresh, else fetcher() (and remembered with where/when) */
  const FACTS = 'money-brain-facts', facts = {};
  function factStore(){ try{ const s = store(); return JSON.parse((s && s.getItem(FACTS)) || '{}'); }catch(e){ return {}; } }
  async function fact(key, fetcher, o){
    o = o || {};
    const ttl = (o.ttl || 24 * 3600) * 1000;
    const hit = facts[key] || factStore()[key];
    if(hit && now() - hit.at < ttl) return hit.value;
    const value = await fetcher();
    facts[key] = {value, at: now(), source: o.source || ''};
    if(o.keep){ try{ const all = factStore(); all[key] = facts[key]; const keys = Object.keys(all); if(keys.length > 200) delete all[keys[0]]; store().setItem(FACTS, JSON.stringify(all)); }catch(e){} }
    return value;
  }

  /* ================================================================ reasoning tools */
  /* Distance in km between {lat, lng} points */
  function km(a, b){
    if(!a || !b || a.lat == null || b.lat == null) return null;
    const R = 6371, r = x => x * Math.PI / 180;
    const dLat = r(b.lat - a.lat), dLng = r(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  /* Minutes from a to b in a city: walking when it is close, else a cab (with the wait) - rounded to 5 */
  function travelMin(a, b, o){
    const d = km(a, b);
    if(d === null) return (o && o.unknown) || 25;
    const road = d * 1.3;                                  // streets are not straight lines
    const m = road < 1.2 ? road / 4.5 * 60 : 8 + road / ((o && o.kmh) || 24) * 60;
    return Math.max(5, Math.round(m / 5) * 5);
  }

  /* Opening hours in plain words -> {days: {0..6: [[openMin, closeMin]]}} or null when it cannot tell.
     "Sa-Th 8:30AM-8:30PM, Fr 2:30PM-8:30PM", "daily 9AM-10PM", "10:00-22:00", "Sun–Wed 10AM–10PM, Thu–Sat 10–midnight",
     "24 hours", "9AM-5PM, closed Mondays" */
  const DAY = {su: 0, sun: 0, sunday: 0, mo: 1, mon: 1, monday: 1, tu: 2, tue: 2, tues: 2, tuesday: 2, we: 3, wed: 3, wednesday: 3,
    th: 4, thu: 4, thur: 4, thurs: 4, thursday: 4, fr: 5, fri: 5, friday: 5, sa: 6, sat: 6, saturday: 6};
  const DAYW = '(sun(?:day)?|mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|su|mo|tu|we|th|fr|sa)';
  function parseHours(text){
    let t = String(text || '').toLowerCase().replace(/[–—−]/g, '-').replace(/\s+to\s+/g, '-').replace(/noon/g, '12pm').replace(/(\d)\s*\.\s*(\d\d)/g, '$1:$2');
    if(!t.trim()) return null;
    const all = [0, 1, 2, 3, 4, 5, 6], days = {};
    if(/24\s*(hours|hrs|\/7|x7)|open 24|always open/.test(t)){ all.forEach(d=>{ days[d] = [[0, 1440]]; }); return {days}; }
    const closed = [];
    t = t.replace(new RegExp('closed(?: on)?\\s+' + DAYW + 's?(?:\\s*(?:and|&|,)\\s*' + DAYW + 's?)*', 'g'), m=>{ (m.match(new RegExp(DAYW, 'g')) || []).forEach(d=>{ if(DAY[d] !== undefined) closed.push(DAY[d]); }); return ' '; });
    const timeRe = /(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?\s*-\s*(\d{1,2}|midnight)(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?/;
    let found = false, everyDay = false;
    t.split(/[,;]|\band\b(?=[^\d]*\d)/).forEach(part=>{
      const m = timeRe.exec(part);
      if(!m) return;
      const mer = x => x ? x.replace(/\./g, '') : '';
      let o = +m[1], om = +(m[2] || 0), c = m[4] === 'midnight' ? 24 : +m[4], cm = +(m[5] || 0);
      const oa = mer(m[3]), ca = mer(m[6]);
      if(ca === 'pm' && c < 12) c += 12;
      if(ca === 'am' && c === 12) c = 0;
      if(oa === 'pm' && o < 12) o += 12;
      if(oa === 'am' && o === 12) o = 0;
      if(!oa && ca === 'pm' && o + 12 <= c && o < 12 && o >= 1 && o < 6) o += 12;        // "2-8pm"
      let open = o * 60 + om, close = c * 60 + cm;
      if(!ca && !oa && c <= 12 && close <= open) close += 12 * 60;                        // "10-8" read as 10am-8pm
      if(close <= open) close = Math.min(1440, close + 1440);
      if(close === 0) close = 1440;
      // which days: a range "sat-thu", a list "mon, wed" or nothing (every day)
      const before = part.slice(0, m.index);
      const range = new RegExp(DAYW + '\\s*-\\s*' + DAYW).exec(before);
      let ds = all, named = true;
      if(range){ const a = DAY[range[1]], b = DAY[range[2]]; ds = []; for(let d = a; ; d = (d + 1) % 7){ ds.push(d); if(d === b || ds.length > 7) break; } }
      else { const list = (before.match(new RegExp('\\b' + DAYW + '\\b', 'g')) || []).map(d=>DAY[d]).filter(d=>d !== undefined); if(list.length) ds = list; else named = false; }
      if(!named) everyDay = true;
      ds.forEach(d=>{ (days[d] = days[d] || []).push([open, close]); });
      found = true;
    });
    if(!found) return null;
    // hours given for named days only ("Sa-Th 9-5"): the days not named are closed
    if(!everyDay) all.forEach(d=>{ if(!days[d]) days[d] = []; });
    closed.forEach(d=>{ days[d] = []; });
    return {days};
  }
  /* Is it open for the whole of [from, to] (minutes) on that date? true / false / null (not known) */
  function openDuring(hours, dateISO, from, to){
    if(!hours) return null;
    const d = new Date(dateISO + 'T00:00:00Z').getUTCDay(), w = hours.days[d];
    if(w === undefined) return null;
    return w.some(([o, c])=>from >= o && to <= c);
  }

  /* The best day: which candidates, in which order, at what times - by searching, not guessing.
     o: {window: {from, until} (minutes), start: {lat, lng}, busy: [{s, e, lat, lng, title}] (fixed items, meals),
         candidates: [{id, name, lat, lng, minutes, value, hours, flex}], date, max, buffer, valueAt(c, start) -> extra value}
     -> {stops: [{c, s, e, travel, why: []}], score}
     A beam search: at each step the few best partial days are kept and grown by every candidate that fits
     (open then, before the next fixed item, inside the day), scored by value minus travel and waiting. */
  function planDay(o){
    const buffer = o.buffer === undefined ? 20 : o.buffer, width = o.width || 8, max = o.max || 3;
    const busy = (o.busy || []).slice().sort((a, b)=>a.s - b.s);
    const cands = (o.candidates || []).filter(c=>c.value > -5);
    // the free stretches of the day between fixed items
    const free = [];
    let from = o.window.from;
    busy.forEach(b=>{ if(b.s - buffer > from) free.push([from, b.s - buffer, b]); from = Math.max(from, b.e + buffer); });
    if(o.window.until > from) free.push([from, o.window.until, null]);
    const posAt = (seq, t) => { const last = seq[seq.length - 1]; let p = last ? last.c : o.start, pt = last ? last.e : -1;
      busy.forEach(b=>{ if(b.e <= t && b.e > pt && b.lat != null){ p = b; pt = b.e; } }); return p; };
    let beam = [{seq: [], score: 0, t: o.window.from}];
    for(let depth = 0; depth < max; depth++){
      const next = [];
      beam.forEach(st=>{
        const used = new Set(st.seq.map(x=>x.c.id));
        cands.forEach(c=>{
          if(used.has(c.id)) return;
          const pos = posAt(st.seq, st.t);
          const trav = travelMin(pos, c);
          let s = st.t + (st.seq.length ? buffer : 0) + trav;
          // the first free stretch where it fits
          let placed = null;
          for(const [a, b] of free){
            const start = Math.max(s, a + (a > o.window.from ? trav : 0));
            let len = c.minutes;
            if(start + len > b && c.flex && b - start >= c.flex) len = b - start;       // a shorter visit still fits
            if(start + len <= b){
              const open = openDuring(c.hours, o.date, start, start + len);
              if(open === false){
                // open later that day? start then
                const d = c.hours && c.hours.days[new Date(o.date + 'T00:00:00Z').getUTCDay()];
                const later = (d || []).map(([oo, cc])=>[Math.max(oo, start), cc]).find(([oo, cc])=>oo + len <= Math.min(cc, b));
                if(later){ placed = {s: later[0], e: later[0] + len, open: true}; break; }
                continue;
              }
              placed = {s: start, e: start + len, open};
              break;
            }
          }
          if(!placed) return;
          const wait = Math.max(0, placed.s - s);
          // variety: a second place of the same kind the same day (two viewing decks, three museums) is worth less
          const same = c.category ? st.seq.filter(x=>x.c.category === c.category).length : 0;
          const gain = c.value + (o.valueAt ? o.valueAt(c, placed.s) : 0) - trav * 0.012 - wait * 0.002 - (placed.open === null ? 0.08 : 0) - same * (o.repeatPenalty === undefined ? 0.35 : o.repeatPenalty);
          next.push({seq: st.seq.concat([{c, s: placed.s, e: placed.e, travel: trav, open: placed.open}]), score: st.score + gain, t: placed.e});
        });
      });
      if(!next.length) break;
      next.sort((a, b)=>b.score - a.score);
      // keep the best, and only one of each set of stops (the same places in another order is the same day)
      const seen = new Set();
      beam = next.filter(x=>{ const k = x.seq.map(y=>y.c.id).sort().join('|'); if(seen.has(k)) return false; seen.add(k); return true; }).slice(0, width)
        .concat(beam.filter(x=>x.seq.length === depth && x.seq.length > 0 && x.score > 0).slice(0, 2));
    }
    const best = beam.filter(x=>x.score > -Infinity).sort((a, b)=>b.score - a.score)[0] || {seq: [], score: 0};
    return {stops: best.seq, score: best.score};
  }

  /* What a place is, from its name and description: the words people use for it */
  const CATS = [
    ['mosque', /\b(mosque|masjid)\b/i, 'mosques'], ['temple', /\b(temple|mandir|gurudwara|pagoda)\b/i, 'temples'], ['church', /\b(church|cathedral|basilica|chapel)\b/i, 'churches'],
    ['museum', /\b(museum|gallery|exhibition|heritage house|al fahidi|bastakiya)\b/i, 'museums and galleries'], ['market', /\b(souk|souq|market|bazaar|haat)\b/i, 'markets and souks'],
    ['mall', /\b(mall|plaza|shopping cent|outlet|city centre)\b/i, 'malls'], ['park', /\b(park|garden|lake|nature|zabeel|botanical)\b/i, 'parks and gardens'],
    ['beach', /\b(beach|bay|island|marina|creek|lagoon)\b/i, 'beaches and waterfronts'], ['view', /\b(tower|burj|frame|view|observation|sky|khalifa)\b/i, 'views and towers'],
    ['fort', /\b(fort|palace|castle|qila|mahal)\b/i, 'forts and palaces'], ['animals', /\b(zoo|aquarium|safari park|bird|dolphin)\b/i, 'zoos and aquariums'],
    ['fun', /\b(theme park|water park|wild wadi|aquaventure|kidzania|ski|img worlds|legoland|global village)\b/i, 'theme parks and fun'],
    ['desert', /\b(desert|dune|safari)\b/i, 'desert trips'], ['boat', /\b(cruise|abra|boat|dhow|ferry)\b/i, 'boat rides'],
  ];
  function categoryOf(name, note){
    const t = (name || '') + ' ' + (note || '');
    const hit = CATS.find(([, re])=>re.test(name || '')) || CATS.find(([, re])=>re.test(t));
    return hit ? hit[0] : 'sight';
  }
  const categoryName = c => (CATS.find(x=>x[0] === c) || [0, 0, c + 's'])[2];
  const CATEGORIES = CATS.map(([id, , name])=>({id, name}));

  /* ================================================================ understanding plain requests
     understand(text) -> [{do, ...}] actions an app can apply. It reads a request the way a person would:
     split into clauses ("no temples, more food places" = two wishes), and in each clause finds which way it
     leans (less / more), what it is about (a kind of place, food, the pace, a time, a day, who is coming).
     Hinglish is read too ("thoda relax plan karo", "veg khana chahiye", "mandir nahi"). Checked by
     test/exam (the understanding exam). Anything it cannot read is left to an AI. */
  const NUM = {one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, last: -1, final: -1};
  // Hinglish (and other shorthand) -> plain English, word by word
  const HINGLISH = [[/\bthoda\b/g, 'a bit'], [/\bbahut zyada\b|\bbohot zyada\b|\bzyada\b/g, 'too much'], [/\bkam karo\b|\bkam kar do\b/g, 'fewer please'],
    [/\bnahi\b|\bnahin\b|\bmat\b/g, 'no'], [/\bchahiye\b/g, 'want'], [/\bmandir\b/g, 'temple'], [/\bmasjid\b/g, 'mosque'], [/\bkhana\b/g, 'food'],
    [/\bjaana\b|\bjana\b/g, 'go'], [/\bghumna\b/g, 'sightseeing'], [/\baaram se\b/g, 'relaxed'], [/\baaram\b/g, 'rest'], [/\bjaldi\b/g, 'early'], [/\bder se\b/g, 'later'], [/\bbacche\b|\bbachche\b/g, 'kids'], [/\bghoomna\b/g, 'sightseeing'], [/\bsubah\b/g, 'morning'], [/\bshaam\b/g, 'evening'], [/\bkal\b/g, 'tomorrow'],
    [/\bho gaya\b/g, ''], [/\bkaro\b|\bkar do\b/g, 'please'], [/\bplan\b/g, 'plan']];
  // words that stand for several kinds of places
  const GROUPS = [[/\breligious (places|sites|stuff|spots)?|places of worship\b/g, ' temples mosques churches '], [/\bshopping\b/g, ' malls markets '],
    [/\bhistory\b|\bhistorical\b|\bheritage\b/g, ' museums forts '], [/\bnature\b|\bgreenery\b/g, ' parks '], [/\bart\b/g, ' galleries '],
    [/\bcity from above\b|\bskyline\b|\bgreat views?\b|\brooftops?\b|\bviewpoints?\b|\bobservation deck\b/g, ' views '], [/\bboat rides?\b|\bcruises?\b/g, ' boats ']];
  function catWords(t){
    const out = [];
    t = t.replace(/galleries/g, 'gallery').replace(/\b(\w{3,}?)(es|s)\b/g, (m, w, e)=>/(souq|souk|mosque|temple|church|museum|market|mall|park|garden|beach|tower|fort|palace|zoo|aquarium|cruise|bazaar|lake|island|dune|boat|dhow|view|gallery)$/.test(w + (e === 'es' ? 'e' : '')) ? w + (e === 'es' ? 'e' : '') : /(souq|souk|mosque|temple|church|museum|market|mall|park|garden|beach|tower|fort|palace|zoo|aquarium|bazaar|lake|island|dune|boat|dhow|view)$/.test(w) ? w : m);
    CATS.forEach(([id, re, name])=>{ if(re.test(t) || new RegExp('\\b' + name.split(' ')[0].replace(/s$/, '') + 's?\\b', 'i').test(t)) out.push(id); });
    if(/\bviews?\b/.test(t) && out.indexOf('view') < 0) out.push('view');
    if(/\bzoo\b|\banimals?\b|\bdolphins?\b|\bpenguins?\b|\bwildlife\b|\bsafari park\b/.test(t) && out.indexOf('animals') < 0) out.push('animals');
    return out;
  }
  const NEG = /\b(no|not|skip|avoid|without|less|fewer|don't|dont|do not|hate|dislike|remove|drop|too many|enough|not into|not interested|no more|cut|cancel|bored|boring|minimum|minimi[sz]e|not needed|no need|not necessary|not a fan|never|tired of|sick of|delete)\b/;
  const POS = /\b(more|love|loves|like|add|include|prefer|want|wants|interested|keen|enjoy|must|would be nice|would love|please|try|some|maximum|maximi[sz]e|see|visit|put in|lots of)\b/;
  /* A request it could not read, explained once (by an AI or by you): remembered, so the same words work next time. */
  const phraseKey = text => String(text || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\b(please|pls|plz|kindly|the|a|an|can|you|could|we|i)\b/g, ' ').replace(/\s+/g, ' ').trim();
  function rememberPhrase(app, text, acts){
    const k = phraseKey(text);
    if(!k || !acts || !acts.length) return;
    learn(app || 'home', 'phrase', k, JSON.stringify(acts), {weight: 3, label: '“' + String(text).slice(0, 60) + '” means: ' + acts.map(a=>a.do + (a.value ? ' ' + a.value : a.category ? ' ' + a.category : '')).join(', '), why: 'Explained once, remembered'});
  }
  function understand(text, o){
    const known = recall((o && o.app) || 'trip', 'phrase', phraseKey(text), {min: 0.5});
    if(known){ try{ return JSON.parse(known.value); }catch(e){} }
    let t = ' ' + String(text || '').toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ') + ' ';
    HINGLISH.forEach(([re, w])=>{ t = t.replace(re, w); });
    t = t.replace(/\bday (one|two|three|four|five|six|seven|eight|nine|ten)\b/g, (m, w)=>'day ' + NUM[w]);
    const acts = [];
    const timeOf = (h, mm, ap, pmIfBare) => { h = +h; mm = +(mm || 0); if(ap === 'pm' && h < 12) h += 12; if(ap === 'am' && h === 12) h = 0; if(!ap && pmIfBare && h < 12 && h >= 1) h += 12; return h * 60 + mm; };
    const dayRef = s => {
      const m = /\bday\s*(\d+)\b/.exec(s) || /\b(first|second|third|fourth|fifth|sixth|seventh|last|final)\s+(day|morning|afternoon|evening|night)\b/.exec(s) || /\bthe (last|final) day\b/.exec(s);
      if(m) return {day: NUM[m[1]] || +m[1]};
      const dm = /\b(?:on\s+)?(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)\b|\b(\d{1,2})\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s+(\d{1,2})\b/.exec(s);
      if(dm) return {date: +(dm[1] || dm[2] || dm[5]), month: dm[3] || dm[4] || ''};
      return null;
    };
    const whole = dayRef(t);
    // ---- clauses: at punctuation and "but"/"then", and before a new "more / less / no …" in the middle of a sentence
    const clauses = t.split(/[,.;!?]|\bbut\b|\bthen\b|\bwhile\b/).flatMap(c=>c.split(/(?<!\b(?:no|any|some|a few|much))\s(?=(?:more|less|fewer|no|skip|add|avoid|include)\b)/)).map(c=>' ' + c.trim() + ' ').filter(c=>c.trim());
    let paceDone = false;
    clauses.forEach((c, ci)=>{
      let g = c; GROUPS.forEach(([re, w])=>{ g = g.replace(re, w); });
      const cats = catWords(g);
      // Hindi puts the "no" after the thing ("mandir nahi jaana" -> "temple" + "no go"): a bare clause takes the next one's lean
      const nextBare = clauses[ci + 1] && !catWords(clauses[ci + 1]).length ? clauses[ci + 1] : '';
      const neg = NEG.test(c) || (!POS.test(c) && NEG.test(nextBare)), pos = POS.test(c);
      const walking = /walk/.test(c);
      // food places: "more food places", "foodies", "street food", "local food"
      const foodLike = /\bfoodies?\b|\bstreet food\b|\blocal (food|cuisine|dishes)\b|\b(more|some|good|maximum|lots of|best) (local )?(food|restaurants|places to eat|eating)\b|\bfood (places|spots|tour)\b|\beat the best\b|\btry the food\b/.test(c);
      if(cats.length){
        cats.forEach(cat=>acts.push({do: neg && !/\b(must|love|add)\b/.test(c.replace(/\bno more\b/, '')) ? 'dislike' : (pos || /\bday\b/.test(c) || /^\s*(a|some)\b/.test(c)) ? 'like' : 'like', category: cat}));
      }
      if(foodLike && !neg && !/veg|vegan|jain|halal/.test(c)) acts.push({do: 'like', category: 'food'});
      // pace, unless the clause was about a kind of place ("too many museums") or walking
      if(!cats.length && !walking && !paceDone){
        const relaxed = /too (packed|much|busy|tiring|hectic|full|ambitious|many (things|places|stops|sights))|overloaded|over ?packed|overwhelm|ambitious|exhaust|tired|tiring|rush|hectic|crazy|insane|intense|slow|relax|chill|easy ?going|take it easy|keep it light|lighter|fewer (places|stops|things|sights)?|not so many|cut down|(do|see) less|less (each|every|per) day|less (sightseeing|rushed|packed|busy)|running around|jet ?lag|breathing room|downtime|leisure|more (free|spare|down) ?time|more time to|more breaks|we are old|lazy trip/.test(c);
        const packed = /too (empty|light|slow|little)|looks empty|boring|nothing to do|as much as possible|more (things|places|sights|sightseeing|activities|stops)|add (more|something|anything)|fit (more|in more)|pack (it|more)|busier|energetic|lots of energy|full of energy|fill (it|the day)|handle a busy|(busy|packed|full) (schedule |days? )?(is|are) (fine|ok)|don't mind (a )?(busy|packed)|see everything/.test(c);
        if(relaxed){ acts.push({do: 'pace', value: 'relaxed', day: dayRef(c) || whole}); paceDone = true; }
        else if(packed){ acts.push({do: 'pace', value: 'packed', day: dayRef(c) || whole}); paceDone = true; }
      }
    });
    // a pace said in words the clauses split apart ("pack more in")
    if(!paceDone && !acts.some(a=>a.do === 'like' || a.do === 'dislike') && !/walk/.test(t)){
      if(/\bpack (it |more |them )?(in|more)\b|\bcram\b/.test(t)) acts.push({do: 'pace', value: 'packed', day: whole});
    }
    // ---- food
    if(/\bjain\b|no onion|no garlic/.test(t)) acts.push({do: 'food', value: 'jain vegetarian'});
    else if(/\bvegan\b/.test(t)) acts.push({do: 'food', value: 'vegan'});
    else if(/\bhalal\b/.test(t)) acts.push({do: 'food', value: 'halal'});
    else if((/\b(pure )?veg(etarian|gie)?\b|no meat|don't eat (meat|non[- ]?veg)|dont eat (meat|non[- ]?veg)|no non[- ]?veg|(no|don't eat|dont eat|without) (chicken|fish|mutton|beef|pork|seafood|lamb|eggs?|meat)\b/.test(t)) && !/non[- ]?veg(etarian)? (is |are )?(ok|fine|allowed)|we eat (meat|non[- ]?veg)/.test(t)) acts.push({do: 'food', value: 'vegetarian'});
    // ---- times: start / end of the day
    const st = /\b(?:start|begin|leave the hotel|leave|head out|go out)(?: the day| days| our day)?(?: at| by| from| after| around| before)?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/.exec(t) || /\bbegin at (\d{1,2})(?::(\d{2}))?\s*(am|pm)?/.exec(t) || /\bnothing before (\d{1,2})(?::(\d{2}))?\s*(am|pm)?/.exec(t);
    if(st) acts.push({do: 'dayStart', min: timeOf(st[1], st[2], st[3], +st[1] < 6)});
    else if(/start (the day )?(later|late)|sleep in|late (start|mornings?)|lazy mornings?|not too early|no early (starts|mornings?)|late risers?|night owls?|not (a )?morning (people|person)|wake up late/.test(t)) acts.push({do: 'dayStart', shift: 60});
    else if(/start (the day )?(earlier|early)|early starts?|early mornings? (are|is) (fine|ok)|early (risers?|birds?)/.test(t)) acts.push({do: 'dayStart', shift: -60});
    const back = /\b(?:back|return|at the hotel|in the hotel|home|finish(?: the day)?|done|wrap up|end the day)(?: at the hotel| to the hotel| in the hotel)? (?:by|before|at)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/.exec(t);
    if(back) acts.push({do: 'dayEnd', min: timeOf(back[1], back[2], back[3], true)});
    else if(/no late nights|early nights?|early to bed|not too late/.test(t)) acts.push({do: 'dayEnd', shift: -60});
    // ---- a fixed appointment: "meeting on the 14th at 3 pm", "dinner with friends on day 3 at 8pm"
    const appt = /\b(meeting|work call|call|appointment|dinner with|lunch with|breakfast with|visit(?:ing)? (?:my |our )?\w+|wedding|conference|event|show|match|concert|interview|tickets for a \w+)\b([^.;]*?)\b(?:at|@)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/.exec(t);
    if(appt && (appt[5] || appt[4] || /\bat\s+\d/.test(appt[0]))){
      acts.push({do: 'fixed', title: (appt[1] + appt[2]).replace(/\s+on\s+.*$/, '').replace(/\s+(on|at)$/, '').replace(/^tickets for an? /, '').replace(/\s+/g, ' ').trim(),
        min: timeOf(appt[3], appt[4], appt[5], +appt[3] < 8), day: dayRef(t), minutes: /dinner|lunch|wedding|show|match|concert/.test(appt[1]) ? 120 : 60});
    }
    // any other "<something> on <day> at <time>" (or "at <time> on <day>") with a clear time is a fixed appointment
    if(!acts.some(a=>a.do === 'fixed') && !/\b(start|begin|back|return|finish|leave|end the day)\b/.test(t)){
      const g2 = /\b(?:(?:i|we) (?:have|got) (?:an? |the |our |my )?|there is (?:an? )?)?([a-z][a-z ]{2,40}?)\s+(?:on\s+(?:the\s+)?(?:day\s*\d+|\d{1,2}(?:st|nd|rd|th)?|(?:first|second|third|fourth|last) day)[a-z ]*?\s+)?at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/.exec(t);
      if(g2 && dayRef(t) && !/^(start|back|free|keep)/.test(g2[1])) acts.push({do: 'fixed', title: g2[1].replace(/^(a|an|the|my|our)\s+/, '').trim(), min: timeOf(g2[2], g2[3], g2[4], false), day: dayRef(t), minutes: /dinner|lunch|party|birthday|show/.test(g2[1]) ? 120 : 60});
    }
    // ---- free time
    const partOf = s => (/(morning|afternoon|evening)/.exec(s) || [])[1] || (/after lunch/.test(s) ? 'afternoon' : /after dinner|night/.test(s) ? 'evening' : /before lunch/.test(s) ? 'morning' : undefined);
    const freeish = /\bfree\b|\boff\b|\bopen\b|nothing planned|no plans|nothing (on|in|for)\b|rest in the|keep (it|the)?\s*\w* ?free|leave .* free|day off|lazy day|rest day|empty (morning|afternoon|evening|day)/;
    const fc = clauses.find(c=>freeish.test(c)) || (freeish.test(t) ? t : null);
    if(fc){
      const part = partOf(fc) || (/\bday\b|\bday\s*\d/.test(fc) ? 'day' : null);
      if(part) acts.push({do: 'free', part, day: dayRef(fc) || (part !== 'day' ? whole : null) || (/day\s*\d|\b(first|second|third|last)\b/.test(fc) ? dayRef(fc) : null)});
    }
    // ---- who is coming
    if(/\bkids?\b|\bchild(ren)?\b|toddler|\bbaby\b|infant|\bson\b.*\d|\bdaughter\b.*\d|aged \d|\d+[ -]?(year|yr)s?[ -]?old/.test(t)) acts.push({do: 'travellers', value: 'with children'});
    if(/elderly|\belders?\b|senior|grand(ma|pa|mother|father)|wheelchair|can'?t walk|cannot walk|walk (much|a lot|far)|less walking|walk less|too much walking|(limit|minimi[sz]e|reduce|cut|less) (the )?walking|knee|stick|walker|mobility/.test(t)) acts.push({do: 'walking', value: 'less', day: whole || undefined});
    // a day mentioned once belongs to the wish it came with
    acts.forEach(a=>{ if(a.day === undefined && (a.do === 'pace')) a.day = whole; });
    const seen = new Set();
    return acts.filter(a=>{ const k = JSON.stringify(a); if(seen.has(k)) return false; seen.add(k); return true; });
  }

  /* ================================================================ checking what was read (by any reader or AI)
     Exact rules for the numbers on Indian documents and tickets. verify(kind, value, o) ->
       {ok, value (the corrected one, when a common misread fixes it), fixed: 'what was corrected' | '', level: 'ok'|'warn'|'error', text}
     find(kind, text) -> the values in a text that pass the check (to recover the right number when a reader got it wrong). */
  const V_D = [[0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],[3,4,0,1,2,8,9,5,6,7],[4,0,1,2,3,9,5,6,7,8],[5,9,8,7,6,0,4,3,2,1],[6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],[8,7,6,5,9,3,2,1,0,4],[9,8,7,6,5,4,3,2,1,0]];
  const V_P = [[0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],[8,9,1,6,0,4,3,5,2,7],[9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],[2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8]];
  const verhoeff = num => { let c = 0; String(num).split('').reverse().forEach((d, i)=>{ c = V_D[c][V_P[i % 8][+d]]; }); return c === 0; };
  // what scanners and readers commonly confuse: letters read in a digit's place, digits in a letter's place
  const toDigit = s => s.replace(/[Oo]/g, '0').replace(/[IlL|]/g, '1').replace(/[Ss]/g, '5').replace(/[B]/g, '8').replace(/[Z]/g, '2').replace(/[G]/g, '6').replace(/[T]/g, '7');
  const toLetter = s => s.replace(/0/g, 'O').replace(/1/g, 'I').replace(/5/g, 'S').replace(/8/g, 'B').replace(/2/g, 'Z').replace(/6/g, 'G');
  const clean = s => String(s == null ? '' : s).toUpperCase().replace(/[\s\-.]/g, '');
  const PAN_TYPE = {P: 'a person', C: 'a company', H: 'a Hindu undivided family', F: 'a firm', A: 'an association of persons', T: 'a trust', B: 'a body of individuals', L: 'a local authority', J: 'an artificial juridical person', G: 'the government'};
  const CHECKS = {
    aadhaar: {re: /(?<!\d\s?)\b[2-9]\d{3}\s?\d{4}\s?\d{4}\b(?!\s?\d)/g, name: 'Aadhaar number',     // not 12 digits out of a 16-digit VID
      test: v => /^[2-9]\d{11}$/.test(v) && verhoeff(v), fix: v => toDigit(v),
      why: v => !/^\d{12}$/.test(v) ? 'should be 12 digits' : /^[01]/.test(v) ? 'cannot start with 0 or 1' : 'fails its check digit (a digit is misread)'},
    pan: {re: /\b[A-Z]{5}\d{4}[A-Z]\b/g, name: 'PAN',
      test: v => /^[A-Z]{3}[PCHFATBLJG][A-Z]\d{4}[A-Z]$/.test(v),
      fix: v => v.length === 10 ? toLetter(v.slice(0, 5)) + toDigit(v.slice(5, 9)) + toLetter(v.slice(9)) : v,
      why: v => v.length !== 10 ? 'should be 10 characters (5 letters, 4 digits, 1 letter)' : !/^[A-Z]{5}\d{4}[A-Z]$/.test(v) ? 'should be 5 letters, 4 digits, 1 letter' : 'its 4th letter is not a known holder type'},
    passport: {re: /\b[A-Z]\d{7}\b/g, name: 'Passport number', test: v => /^[A-Z][1-9]\d{6}$/.test(v) || /^[A-Z0-9]{6,9}$/.test(v) && !/^\d+$/.test(v),
      fix: v => v.length === 8 ? toLetter(v[0]) + toDigit(v.slice(1)) : v, why: () => 'an Indian passport number is a letter and 7 digits'},
    licence: {re: /\b[A-Z]{2}[-\s]?\d{2}[-\s]?(?:19|20)\d{2}\s?\d{7}\b/g, name: 'Driving licence number',
      test: v => /^[A-Z]{2}\d{2}(19|20)\d{2}\d{7}$/.test(v) || /^[A-Z]{2}\d{2}\d{11}$/.test(v) || /^[A-Z]{2}-?\d{2}\/?\d{4,11}\/?\d{0,4}$/.test(v),
      fix: v => v.length >= 15 ? toLetter(v.slice(0, 2)) + toDigit(v.slice(2)) : v, why: () => 'usually the state code, 2 digits, the year and 7 digits (e.g. MH12 20150012345)'},
    'voter-id': {re: /\b[A-Z]{3}\d{7}\b/g, name: 'Voter ID (EPIC)', test: v => /^[A-Z]{3}\d{7}$/.test(v),
      fix: v => v.length === 10 ? toLetter(v.slice(0, 3)) + toDigit(v.slice(3)) : v, why: () => 'should be 3 letters and 7 digits'},
    ifsc: {re: /\b[A-Z]{4}0[A-Z0-9]{6}\b/g, name: 'IFSC', test: v => /^[A-Z]{4}0[A-Z0-9]{6}$/.test(v),
      fix: v => v.length === 11 ? toLetter(v.slice(0, 4)) + '0' + v.slice(5) : v, why: () => 'should be 4 letters, a zero, then 6 letters or digits'},
    pnr: {re: /\b[A-Z0-9]{6}\b/g, name: 'Booking reference (PNR)', test: v => /^[A-Z0-9]{6}$/.test(v) && /[A-Z]/.test(v) || /^\d{10}$/.test(v), fix: v => v, why: () => 'an airline PNR is 6 letters/digits; a train PNR is 10 digits'},
    flight: {re: /\b(?:[A-Z]\d|\d[A-Z]|[A-Z]{2})\s?\d{1,4}\b/g, name: 'Flight number', test: v => /^([A-Z]\d|\d[A-Z]|[A-Z]{2})\d{1,4}$/.test(v), fix: v => v.slice(0, 2) + toDigit(v.slice(2)), why: () => 'an airline code (2 characters) and up to 4 digits, e.g. 6E2134'},
  };
  function verify(kind, value, o){
    const C = CHECKS[kind];
    if(!C || value == null || value === '') return {ok: true, value, fixed: '', level: 'ok', text: ''};
    const raw = clean(value);
    if(/[X*•]{3,}/.test(raw)) return {ok: true, value, fixed: '', level: 'ok', text: 'masked on the document'};     // "XXXX XXXX 1234": printed masked
    if(C.test(raw)){
      let text = '';
      if(kind === 'pan' && o && o.person){ const sur = String(o.person).trim().split(/\s+/).pop(); if(raw[3] === 'P' && sur && raw[4] !== sur[0].toUpperCase()) text = 'Its 5th letter (' + raw[4] + ') is usually the first letter of the surname (' + sur + ') — check the name or the number'; }
      if(kind === 'pan' && raw[3] !== 'P') text = text || 'This PAN belongs to ' + PAN_TYPE[raw[3]] + ', not a person';
      return {ok: true, value: raw, fixed: '', level: text ? 'warn' : 'ok', text};
    }
    const fixedV = clean(C.fix(raw));
    if(fixedV !== raw && C.test(fixedV)) return {ok: true, value: fixedV, fixed: raw + ' → ' + fixedV, level: 'ok', text: 'Corrected a misread: ' + raw + ' → ' + fixedV};
    return {ok: false, value: raw, fixed: '', level: 'error', text: C.name + ' “' + String(value).trim() + '” ' + C.why(raw)};
  }
  /* The values in a text that pass the check, most likely first (to recover a number a reader misread). */
  function find(kind, text){
    const C = CHECKS[kind];
    if(!C || !text) return [];
    const out = [];
    (String(text).toUpperCase().match(C.re) || []).forEach(m=>{ const v = clean(m); if(C.test(v) && out.indexOf(v) < 0) out.push(v); });
    return out;
  }
  /* Is this a real calendar date (YYYY-MM-DD)? */
  const realDate = d => { if(!/^\d{4}-\d{2}-\d{2}$/.test(String(d || ''))) return false; const x = new Date(d + 'T00:00:00Z'); return !isNaN(x) && x.toISOString().slice(0, 10) === d; };

  return {learn, recall, lessons, forget, forgetAll, switchOff, pin, merge, exportAll, reload, describe, confidenceOf,
    fact, km, travelMin, parseHours, openDuring, planDay, categoryOf, categoryName, CATEGORIES, understand, rememberPhrase, phraseKey, verify, find, realDate, verhoeff,
    _reset: ()=>{ mem = {v: 1, lessons: {}}; }};
})();
if(typeof window !== 'undefined') window.MoneyBrain = MoneyBrain;
if(typeof module !== 'undefined') module.exports = MoneyBrain;
