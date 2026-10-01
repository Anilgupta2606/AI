/* =========================================================
   AGENT — the model at the wheel, the way Claude works: it gets tools and decides, step by step, what to do —
   search, open pages, search again, calculate, read a file — until it can answer; then it answers with sources.
   Runs with a model on this Mac (Ollama, tool calling). Every number in the answer is checked against what was read.
   ========================================================= */
import fs from 'fs';
import path from 'path';

const TOOLS = [
  {type: 'function', function: {name: 'web_search', description: 'Search the web. Use it for anything current (news, prices, rates, scores, schedules), for specific facts you are not sure of, and to check claims. Returns numbered results with short snippets.',
    parameters: {type: 'object', properties: {query: {type: 'string', description: 'What to search for, like a person types into a search engine'}}, required: ['query']}}},
  {type: 'function', function: {name: 'open_page', description: 'Open a web page (from the search results or a link) and read the parts that matter for the question. Use it when a snippet is not enough.',
    parameters: {type: 'object', properties: {url: {type: 'string'}, looking_for: {type: 'string', description: 'What you want to find on the page'}}, required: ['url']}}},
  {type: 'function', function: {name: 'calculate', description: 'Work out arithmetic exactly (EMI, SIP, percentages, sums). Give an expression like "(1250+750)/8" or a sentence like "EMI for 50 lakh at 8.5% for 20 years".',
    parameters: {type: 'object', properties: {expression: {type: 'string'}}, required: ['expression']}}},
  {type: 'function', function: {name: 'market_analysis', description: 'Real prices and a technical analysis worked out in code for an index, stock, crypto, currency or commodity: trend, moving averages, RSI, MACD, Bollinger bands, support and resistance, 52-week range, recent changes and what would confirm or cancel the move. Use it for any question about a market or share: its price, trend, "will it fall/rise", technical analysis.',
    parameters: {type: 'object', properties: {market: {type: 'string', description: 'What to analyse, as the user says it: "Nifty 50", "Indian stock market", "Sensex", "Reliance", "HDFC Bank", "bitcoin", "gold"'}, timeframe: {type: 'string', enum: ['day', 'week', 'hour'], description: 'Candle size: day (default), week or hour'}}, required: ['market']}}},
  {type: 'function', function: {name: 'run_code', description: 'Run a complete program and get its output or error, to test code you wrote (in a sandbox: no internet, no files outside its own folder, 20 s limit). Languages: python, javascript, c, cpp. Print results so you can see them.',
    parameters: {type: 'object', properties: {language: {type: 'string', enum: ['python', 'javascript', 'c', 'cpp', 'java']}, code: {type: 'string', description: 'The whole program'}, stdin: {type: 'string', description: 'Input to feed it (optional)'}}, required: ['language', 'code']}}},
  {type: 'function', function: {name: 'read_file', description: 'Read a text file on this computer that the user mentioned.',
    parameters: {type: 'object', properties: {path: {type: 'string'}}, required: ['path']}}},
];
const SYSTEM = today => `You are a general research assistant running on the user's own Mac; questions can be about anything. Today is ${today}.
Work like a careful researcher:
- If the question needs current information or specific facts (news, prices, rates, dates, numbers, names, "latest"), use web_search first. Search again with better words if the results are weak. Open the most promising pages with open_page to read the details — snippets are often not enough.
- For ANY arithmetic (multiplying a price by a quantity, totals, percentages, EMI) and for counting days between dates ("days from today to 8 November 2026"), call calculate first and use its result; never do sums or date counts in your head.
- Search snippets can be old or wrong: before answering a factual question, open the most relevant page or two and confirm.
- For general explanations you know well (what something is, how it works), you may answer directly.
- You can write and build code yourself — nothing needs to exist on the internet first. When asked for a program: write it, then test it with run_code (python, javascript, c or cpp); if it fails or the output is wrong, read the error, fix the code and run it again (up to 3 tries) — the way a programmer works. For a language that cannot run here (like Java), write it carefully and test the same logic in python if useful. Use web_search only to check how a library or API is used. Then answer with the final code in a fenced Markdown block with its language (\`\`\`python … \`\`\`), the output it produced, and a short explanation. Never say you cannot write code.
- Files the user attached are in run_code's folder by the name given (open('sales.csv')). To analyse a table (totals, averages, top items, trends, filters), write Python with the csv module (no pandas) and run it — do not add up numbers by eye; a table's exact summary is given at its top. For a document, quote the parts you use.
- Format answers in Markdown: start with the answer itself (not "The page confirms…" or "Based on my search…"), then short paragraphs, "- " lists for steps or points, **bold** for the key figure.
- For markets and shares (an index, a stock, crypto, gold, a currency) — prices, trend, technical analysis, "will it fall or rise", "what do you think" — call market_analysis: it fetches real prices and works out the indicators. Never say you have no market data. Then web_search for the news behind the move. Answer with the trend, the key levels (support, resistance, averages), what the indicators lean to and what would confirm or cancel a further fall or rise. It is analysis, not a promise: no one knows the future, and do not tell the user to buy or sell.
- Sources disagree sometimes: say so, and prefer the newest and most official.
- When you have enough, write the answer once: clear plain sentences, every fact from a source marked with its number like [3]. Copy numbers and names exactly as the source gives them. Say what you could not find. No separate "Final answer" section, no repeating yourself.
Do not invent sources or numbers.`;
// the rules every answer is held to, your own rules (~/.money-ai/rules.md) and the mistakes it made before
const RULEBOOK = o => (o.rules && o.rules.length ? '\nRules (your draft is checked against them and sent back if it breaks one):\n' + o.rules.map(r=>'- ' + r).join('\n') : '') +
  (o.userRules ? '\nThe user\'s own rules:\n' + o.userRules : '') +
  (o.mistakes && o.mistakes.length ? '\nMistakes you made before — do not repeat them:\n' + o.mistakes.map(m=>'- ' + m).join('\n') : '') +
  (o.timing ? '\n' + o.timing : '');

// the tools this answer may use: switched-off ones left out, your connectors added as one tool
function toolsFor(o){
  const off = new Set(o.disabled || []);
  const map = {web_search: 'web', open_page: 'read', calculate: 'calc', market_analysis: 'market', run_code: 'code', read_file: 'files'};
  const list = TOOLS.filter(t=>!off.has(map[t.function.name]));
  const cs = (o.connectors || []).filter(c=>c.on !== false);
  if(cs.length) list.push({type: 'function', function: {name: 'use_connector', description: 'Ask one of the user\'s connectors (data sources):\n' + cs.map(c=>'- ' + c.name + ': ' + c.description).join('\n'),
    parameters: {type: 'object', properties: {connector: {type: 'string', enum: cs.map(c=>c.name)}, query: {type: 'string', description: 'What to look up, as the connector expects it'}}, required: ['connector', 'query']}}});
  return list;
}
/* a table's exact summary: rows, columns, and for each column its total / average / lowest / highest (numbers)
   or how many different values and the most common ones (text) — so the model never has to add up by eye */
function tableSummary(text, sep){
  const rows = [];
  for(const line of String(text).split(/\r?\n/)){
    if(!line.trim()) continue;
    const cells = []; let cur = '', q = false;
    for(let i = 0; i < line.length; i++){ const ch = line[i];
      if(q){ if(ch === '"' && line[i + 1] === '"'){ cur += '"'; i++; } else if(ch === '"') q = false; else cur += ch; }
      else if(ch === '"') q = true; else if(ch === sep){ cells.push(cur); cur = ''; } else cur += ch; }
    cells.push(cur); rows.push(cells);
    if(rows.length > 200001) break;
  }
  if(rows.length < 2 || rows[0].length < 2) return '';
  const head = rows[0].map((h, i)=>String(h).trim() || 'column ' + (i + 1)), body = rows.slice(1);
  const num = v => { const t = String(v).replace(/[₹$€£,\s%]/g, ''); return /^-?\d+(\.\d+)?$/.test(t) ? +t : null; };
  const fmt = x => Math.abs(x) >= 1000 ? Number(x.toFixed(2)).toLocaleString('en-IN') : String(Number(x.toFixed(4)));
  const cols = head.map((h, i)=>{
    const vals = body.map(r=>r[i]).filter(v=>v != null && String(v).trim() !== '');
    const ns = vals.map(num).filter(v=>v != null);
    if(vals.length && ns.length >= vals.length * 0.8){ const sum = ns.reduce((a, b)=>a + b, 0); return `- ${h}: numbers (${ns.length}) — total ${fmt(sum)}, average ${fmt(sum / ns.length)}, lowest ${fmt(Math.min(...ns))}, highest ${fmt(Math.max(...ns))}`; }
    const counts = {}; vals.forEach(v=>{ counts[v] = (counts[v] || 0) + 1; });
    const top = Object.entries(counts).sort((a, b)=>b[1] - a[1]).slice(0, 5).map(([v, n])=>`${String(v).slice(0, 30)} (${n})`);
    return `- ${h}: text, ${Object.keys(counts).length} different — most common: ${top.join(', ')}`;
  });
  // totals by group: each number column split by each column with few different values (and by month for dates)
  const numCols = head.map((h, i)=>i).filter(i=>{ const v = body.map(r=>r[i]).filter(x=>x != null && String(x).trim() !== ''); return v.length && v.map(num).filter(x=>x != null).length >= v.length * 0.8; }).slice(0, 3);
  const groupCols = head.map((h, i)=>i).filter(i=>!numCols.includes(i)).map(i=>{
    const month = body.every(r=>!r[i] || /^\d{4}-\d{2}-\d{2}|^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(String(r[i]).trim()));
    const key = r => { const v = String(r[i] || '').trim(); if(!month) return v; const m = /^(\d{4})-(\d{2})/.exec(v) || (/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/.exec(v) ? (()=>{ const d = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/.exec(v); return [null, (d[3].length === 2 ? '20' + d[3] : d[3]), d[2].padStart(2, '0')]; })() : null); return m ? m[1] + '-' + m[2] : v; };
    return {i, month, key, n: new Set(body.map(key)).size};
  }).filter(g=>g.n >= 2 && g.n <= 25 && g.n < body.length);
  const groups = [];
  for(const v of numCols){
    const all = body.map(r=>num(r[v])).filter(x=>x != null), grand = all.reduce((a, b)=>a + b, 0);
    groups.push(`${head[v]}: grand total ${fmt(grand)} over ${all.length} rows, average per row ${fmt(grand / (all.length || 1))}`);
    for(const g of groupCols){
      const t = {}, c = {};
      body.forEach(r=>{ const x = num(r[v]); if(x == null) return; const k = g.key(r) || '(blank)'; t[k] = (t[k] || 0) + x; c[k] = (c[k] || 0) + 1; });
      const list = Object.entries(t).sort((a, b)=>g.month ? a[0].localeCompare(b[0]) : b[1] - a[1]);
      groups.push(`${head[v]} by ${head[g.i]}${g.month ? ' (month)' : ''}${g.month ? '' : ', highest first'}: ` + list.map(([k, x])=>`${k} ${fmt(x)} (${c[k]} row${c[k] === 1 ? '' : 's'}, ${(x / grand * 100).toFixed(1)}%)`).join(' · '));
    }
  }
  return 'TABLE SUMMARY (worked out exactly — use these figures, do not add up yourself): ' + body.length + ' rows × ' + head.length + ' columns\n' + cols.join('\n') + (groups.length ? '\nTotals:\n- ' + groups.join('\n- ') : '');
}
export async function runAgent(question, o){
  const step = t => { try{ o.onStep && o.onStep(t); }catch(e){} };
  // the full record of each step (what it searched and got back, read, worked out, ran, and what the checks sent back)
  const trace = (kind, title, detail) => { try{ o.onTrace && o.onTrace({kind, title: String(title).slice(0, 160), detail: typeof detail === 'string' ? detail.slice(0, 3000) : detail}); }catch(e){} };
  // a draft sent back to the model with what to fix
  const pushBack = (draft, why) => {
    trace('check', 'Sent back: ' + String(why).split(/[.:\n]/)[0].slice(0, 90), {draft: String(draft || '').slice(0, 2000), why: String(why).slice(0, 1500)});
    messages.push({role: 'assistant', content: draft}, {role: 'user', content: why});
  };
  const today = new Date().toISOString().slice(0, 10);
  const sources = [];                                             // everything read, numbered as the model sees it
  const numberOf = (url, title, text) => { let s = sources.find(x=>x.url === url); if(!s){ s = {n: sources.length + 1, url, title: title || url, text: ''}; sources.push(s); } if(text) s.text += ' ' + text; return s.n; };
  // corrections from before go right with the question (a small model reads what is near the question best)
  // pictures the user attached: a model that can see describes each one (and reads its text exactly) — that
  // description is a source like any other, so the answer can still search, calculate and check
  for(const im of (o.attachments || []).filter(a=>a.image)){
    if(!o.see){ im.text = '(This picture could not be read here: no model on this Mac can see images.)'; continue; }
    step('🖼 Looking at ' + im.name);
    try{ const r = await o.see(im, question); im.text = r.text; trace('read', 'Looked at ' + im.name + ' (' + r.model + ')', {excerpt: r.text.slice(0, 1500)}); }
    catch(e){ im.text = '(The picture could not be read: ' + e.message + ')'; }
    im.name = im.name + ' (picture — what it shows)';
  }
  // files the user attached on the page: each a numbered source; a long one sends the parts that answer the question.
  // A table (CSV, a sheet of Excel) also gets its exact summary worked out here, and every file is in run_code's folder.
  const safe = n => String(n || 'file').replace(/\.[^.]+$/, m=>m.toLowerCase()).replace(/[^\w.\-]+/g, '_').replace(/_+/g, '_').replace(/^[_.]+/, '').slice(-80) || 'file';
  const attached = (o.attachments || []).map(a=>{
    if(!a.image && /\.(csv|tsv)$/i.test(a.name)){ const p = tableSummary(a.text, /\.tsv$/i.test(a.name) ? '\t' : ','); if(p) a.text = p + '\n\n' + a.text; }
    if(!a.image && o.runCode) a.name = a.name + ' — in run_code: open(\'' + safe(a.name) + '\')';
    const t = String(a.text || ''), n = numberOf('file://' + a.name, a.name, t.slice(0, 30000));
    const body = t.length <= 7000 ? t : o.pick(question, t, 16).slice(0, 6000);
    return `[${n}] ${a.name}${t.length > 7000 ? ' (the parts that matter, of ' + t.length + ' characters)' : ''}\n${body}`;
  });
  const lessons = o.cases && o.cases.length ? '\n\n(Corrections you were given before for questions like this — they override what you remember; still check with a search when the answer can change:\n' + o.cases.map(m=>'- ' + m).join('\n') + ')' : '';
  const tools = toolsFor(o);
  // your goal for this conversation and what you asked it to remember about you
  const about = (o.goal ? '\nThe user\'s goal in this conversation: ' + o.goal : '') + (o.profile && o.profile.length ? '\nWhat the user asked you to remember about them:\n' + o.profile.map(p=>'- ' + p).join('\n') : '') +
    ((o.disabled || []).length ? '\nSwitched off by the user (do not try them): ' + o.disabled.join(', ') + '.' : '');
  const messages = [{role: 'system', content: SYSTEM(today) + RULEBOOK(o) + about}].concat(o.history || [], [{role: 'user', content: question + lessons + (attached.length ? '\n\nFiles I attached (answer from them; cite them like [1]):\n' + attached.join('\n\n') : '')}]);
  if(o.files && o.files.length) messages.push({role: 'user', content: 'Files I mentioned: ' + o.files.join(', ') + ' (use read_file).'});
  const timely = (o.attachments || []).length ? false : o.isTimely ? o.isTimely(question) : /\b(today|now|latest|current|recent|news|price|rate|score|who is|who won)\b/i.test(question);
  let lastResults = [], lastChart = null, prevIssues = '';
  let runs = 0, lastRun = null, nudgedRun = false, fixes = 0;
  let nudged = false, nudgedOpen = false, searches = 0, opened = 0, revisions = 0, firstIssues = null, best = null;
  const usedSearch = new Set(), usedRead = new Set();                // which services answered (a backup shows here)
  const run = async (name, args) => {
    if(name === 'web_search'){
      const q = String(args.query || question).slice(0, 300);
      step('🔎 Searching: ' + q);
      searches++;
      const r = await o.search(q, 8);
      lastResults = r.results || [];
      usedSearch.add(r.provider || 'search');
      trace('search', 'Searched: ' + q, {results: r.results.slice(0, 8).map(x=>({title: x.title, url: x.url, date: x.date ? String(x.date).slice(0, 10) : ''})), via: r.provider || ''});
      return r.results.map(x=>`[${numberOf(x.url, x.title, x.snippet)}] ${x.title}${x.date ? ' (' + String(x.date).slice(0, 10) + ')' : ''}\n${x.url}\n${x.snippet}`).join('\n\n') || 'No results.';
    }
    if(name === 'open_page'){
      const url = String(args.url || '');
      if(!/^https?:\/\//.test(url)) return 'Give a full web address (from the results).';
      step('📄 Reading: ' + url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 70));
      opened++;
      const page = await o.read(url, false);
      usedRead.add(page.via === 'this Mac' ? 'read on this Mac' : 'read via ' + (page.via || 'backup'));
      // only the parts that answer the question (a small model reads only so much)
      const best = o.pick(question + ' ' + (args.looking_for || ''), page.content, 10);
      const n = numberOf(page.url || url, page.title, best);
      const years = Array.from(new Set((String(page.content).match(/\b20[0-3]\d\b/g) || []))).sort();
      const when = page.published ? 'published ' + String(page.published).slice(0, 10) : years.length ? 'years mentioned: ' + years.slice(-3).join(', ') : 'date not shown';
      trace('read', 'Read: ' + (page.title || url).slice(0, 100), {url: page.url || url, when, excerpt: best.slice(0, 1500)});
      return `[${n}] ${page.title} (${when})\n${best.slice(0, 3500)}`;
    }
    if(name === 'calculate'){
      step('🧮 Calculating: ' + String(args.expression).slice(0, 60));
      const r = o.calc(String(args.expression || ''));
      trace('calc', 'Calculated: ' + String(args.expression || ''), r || 'Could not work that out');
      return r || 'Could not work that out — write it as a plain expression, like (1250+750)/8.';
    }
    if(name === 'market_analysis'){
      if(!o.market) return 'Market data is not available here.';
      const tf = String(args.timeframe || 'day');
      step('📈 Analysing: ' + String(args.market || question).slice(0, 50) + ' (' + tf + ')');
      const a = await o.market(String(args.market || question), tf);
      lastChart = a.chart;
      usedSearch.add('market prices');
      const n = numberOf(a.url, a.name + ' — ' + tf + ' prices, analysed here', a.text);
      trace('calc', 'Analysed: ' + a.name + ' (' + tf + ')', a.text);
      return `[${n}] ${a.text}`;
    }
    if(name === 'run_code'){
      if(!o.runCode) return 'Running code is not available here.';
      step('▶️ Running ' + String(args.language || 'code') + ' (try ' + (++runs) + ')');
      const r = await o.runCode({language: args.language, code: args.code, stdin: args.stdin, files: (o.attachments || []).filter(a=>!a.image).map(a=>({name: a.name.replace(/ — in run_code:.*$/, ''), text: a.text.replace(/^TABLE SUMMARY[\s\S]*?\n\n/, '')}))});
      lastRun = Object.assign({}, r, {code: String(args.code || '')});
      trace('run', 'Ran ' + (r.language || args.language) + ' — ' + (r.ok ? 'worked' : r.exit === 'timeout' ? 'too slow (stopped)' : 'failed'), {lang: r.language || args.language, code: String(args.code || '').slice(0, 6000), output: r.output, ok: r.ok});
      return (r.ok ? 'It ran (exit 0' : 'It failed (exit ' + r.exit) + (r.ms ? ', ' + r.ms + ' ms' : '') + '). Output:\n' + r.output;
    }
    if(name === 'use_connector'){
      const c = (o.connectors || []).find(x=>x.name === args.connector && x.on !== false);
      if(!c || !o.callConnector) return 'No such connector.';
      step('🔌 ' + c.name + ': ' + String(args.query || '').slice(0, 60));
      const r = await o.callConnector(c, String(args.query || question));
      const n = numberOf(r.url, c.name + ' — ' + String(args.query || '').slice(0, 60), r.text);
      trace('read', 'Connector ' + c.name + ': ' + String(args.query || ''), {url: r.url, excerpt: r.text.slice(0, 1500)});
      return `[${n}] ${c.name}\n${r.text.slice(0, 4000)}`;
    }
    if(name === 'read_file'){
      const p = path.resolve(String(args.path || ''));
      const allowed = (o.files || []).map(f=>path.resolve(f)).includes(p) || p.startsWith(process.cwd() + path.sep);
      if(!allowed) return 'I may read only files the user named, or files in the current folder.';
      if(!fs.existsSync(p)) return 'No such file: ' + p;
      step('📂 Reading file: ' + path.basename(p));
      const text = fs.readFileSync(p, 'utf8').slice(0, 20000);
      const n = numberOf('file://' + p, path.basename(p), text);
      trace('read', 'Read file: ' + path.basename(p), {excerpt: text.slice(0, 1500)});
      return `[${n}] ${path.basename(p)}\n${text.slice(0, 8000)}`;
    }
    return 'Unknown tool.';
  };
  /* SPEED: research first, then think. A question about now gets its search and its two best pages (read in
     parallel), and a market question its prices, before the model's first turn — instead of the model asking for
     them one slow turn at a time. They go in as if the model had asked, so everything after works the same. */
  const codeQ = /\b(write|build|create|make|implement|fix|debug)\b[\s\S]{0,40}\b(code|program|script|function|class|app|algorithm)\b|\b(python|javascript|java|c\+\+|sql)\b[\s\S]{0,30}\b(program|code|script|function)\b/i.test(question);
  // cloud on and a hard question: research here, then the bigger model writes it at once (no slow local draft first)
  let forceCloud = !!(o.cloud && (/\b(analy[sz]e|analysis|compare|comparison|in detail|pros and cons|strategy|design|architecture|plan|why does|explain how)\b/i.test(question) || codeQ));
  const asTool = async (name, args) => {
    const id = 'pre' + messages.length;
    messages.push({role: 'assistant', content: '', tool_calls: [{id, function: {name, arguments: args}}]});
    let result; try{ result = await run(name, args); }catch(e){ result = 'That did not work: ' + e.message; }
    messages.push({role: 'tool', tool_name: name, content: result});
    return result;
  };
  if(o.prefetch !== false && !(o.files && o.files.length) && !(o.attachments && o.attachments.length)){
    const off = new Set(o.disabled || []);
    const marketQ = o.market && !off.has('market') && /\b(stock|stocks|share|shares|market|markets|nifty|sensex|bank nifty|bitcoin|btc|ethereum|crypto|gold price|silver price|crude|index|forex|technical analysis)\b/i.test(question);
    if(marketQ){
      step('📈 Getting real prices first');
      await asTool('market_analysis', {market: question, timeframe: /\bweek/i.test(question) ? 'week' : /\bhour/i.test(question) ? 'hour' : 'day'});
      const newsQ = await asTool('web_search', {query: question.replace(/\b(can you|please|do|technical analysis|what you feel|will it|see if)\b/gi, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) + ' news today'});
      if(forceCloud){ const pick = lastResults.filter(x=>x.url && !/youtube|facebook|instagram|x\.com|twitter/i.test(x.url)).slice(0, 2); await Promise.all(pick.map(x=>run('open_page', {url: x.url}).then(g=>messages.push({role: 'tool', tool_name: 'open_page', content: g})).catch(()=>{}))); }
    } else if((timely || forceCloud) && !codeQ && o.search && !off.has('web')){
      step('Researching before thinking');
      await asTool('web_search', {query: question});
      const pick = lastResults.filter(x=>x.url && !/youtube\.com|youtu\.be|facebook\.com|instagram\.com|x\.com|twitter\.com|tiktok\.com|\.pdf$/i.test(x.url)).slice(0, 2);
      if(pick.length){
        const id = 'pre' + messages.length;
        messages.push({role: 'assistant', content: '', tool_calls: pick.map((x, i)=>({id: id + i, function: {name: 'open_page', arguments: {url: x.url}}}))});
        const got = await Promise.all(pick.map(x=>run('open_page', {url: x.url}).catch(e=>'That page could not be read: ' + e.message)));
        got.forEach(g=>messages.push({role: 'tool', tool_name: 'open_page', content: g}));
      }
    }
  }
  for(let turn = 0; turn < 10; turn++){
    step(turn ? 'Thinking about what it found…' : 'Thinking…');
    // the answer as it is written (a turn that ends in a tool call is not the answer: the page drops it)
    if(forceCloud) step('Handing it to the bigger model');
    const r = forceCloud ? {message: {role: 'assistant', content: ''}, model: 'cloud'} : await o.chat(messages, tools, {onDelta: t => { try{ o.onDraft && o.onDraft(t); }catch(e){} }});
    const msg = r.message || {};
    const calls = msg.tool_calls || [];
    if(calls.length && turn < 9){
      if(String(msg.content || '').trim()) trace('think', 'Thinking', String(msg.content).replace(/<think>|<\/think>/g, '').trim());
      messages.push({role: 'assistant', content: msg.content || '', tool_calls: calls});
      for(const c of calls.slice(0, 3)){
        const fn = c.function || {};
        let args = fn.arguments || {};
        if(typeof args === 'string'){ try{ args = JSON.parse(args); }catch(e){ args = {query: args}; } }
        let result;
        try{ result = await run(fn.name, args); }catch(e){ result = 'That did not work: ' + e.message; }
        messages.push({role: 'tool', tool_name: fn.name, content: result});
      }
      continue;
    }
    let text = String(msg.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    // a small model sometimes writes the call instead of making it: web_search("…"), {"name": "calculate", …}
    const written = /^\W*(web_search|open_page|calculate|read_file|market_analysis|run_code|use_connector)\s*\(\s*(?:\w+\s*=\s*)?["']?([\s\S]*?)["']?\s*\)\W*$/.exec(text) ||
      (()=>{ const all = Array.from(text.matchAll(/\b(web_search|open_page|calculate|read_file|market_analysis|run_code|use_connector)\s*\(\s*(?:\w+\s*=\s*)?["']([^"'\n]{1,300})["']\s*\)/g)); return all.length && !/\[\d+\]/.test(text) ? all[all.length - 1] : null; })() ||
      (()=>{
        // {"name": "run_code", "arguments": {...}} — often in a ```json block, sometimes missing its last brace
        const at = text.indexOf('{'); if(at < 0 || !/"name"\s*:/.test(text)) return null;
        let body = text.slice(at).replace(/```[\s\S]*$/, '').trim(), j = null;
        body = body.replace(/\\'/g, "'");                             // \' is not JSON, but models write it
        for(let k = 0; k < 3 && !j; k++){ try{ j = JSON.parse(body); }catch(e){ body += '}'; } }
        if(!j || !/^(web_search|open_page|calculate|read_file|market_analysis|run_code|use_connector)$/.test(j.name || '')) return null;
        const a = j.arguments || j.parameters || {};
        return [null, j.name, a.query || a.url || a.expression || a.path || a.market || a.code || a.connector || 'x', typeof a === 'object' ? a : null];
      })();
    if(written && written[2] && turn < 9){
      const name = written[1], arg = String(written[2]).trim(), key = {web_search: 'query', open_page: 'url', calculate: 'expression', read_file: 'path', market_analysis: 'market', run_code: 'code', use_connector: 'query'}[name];
      const args = written[3] || {[key]: arg};                       // the whole set of arguments when it wrote them out
      messages.push({role: 'assistant', content: '', tool_calls: [{function: {name, arguments: args}}]});
      let result;
      try{ result = await run(name, args); }catch(e){ result = 'That did not work: ' + e.message; }
      messages.push({role: 'tool', tool_name: name, content: result});
      continue;
    }
    if(!text && best) text = best.text;                            // out of steps mid-fix: the best draft so far stands
    // a question about now, answered from memory: look it up first (once)
    if(!forceCloud && !searches && !nudged && timely && turn < 8){
      nudged = true;
      pushBack(text, 'That needs current information. Use web_search to check before answering.');
      continue;
    }
    // not an answer (a bare expression, a fragment): ask for a proper one
    if(!forceCloud && (text.length < 25 || /^[\d\s()+\-−×*/.,a-z^=]{0,80}$/i.test(text) && !/[.!?]$/.test(text)) && turn < 8){
      pushBack(text, 'Please finish: use calculate if you need a sum or a day count, then answer in a full sentence.');
      continue;
    }
    // code: never handed over untested — run it; if the last run failed, fix it and run again (like a programmer)
    if(!forceCloud && o.runCode && turn < 8){
      const runnable = Array.from(text.matchAll(/```[ \t]*(python3?|py|javascript|js|node|c|cpp|c\+\+)\s*\n([\s\S]*?)```/gi));
      const madeUp = !runs && /\*\*output|^output:|output when run|it prints/im.test(text) && /```/.test(text);
      if((runnable.length || madeUp) && !runs && !nudgedRun){
        nudgedRun = true;
        pushBack(text, (madeUp ? 'You showed output without running the code — never invent output. ' : '') + 'Before you answer, test the program: call run_code with the whole program (use only the standard library unless the user asked for a package). If it fails, fix it and run again. Then give the final code and the real output it printed.');
        continue;
      }
      if(lastRun && !lastRun.ok && fixes < 3 && runs < 5){
        fixes++;
        pushBack(text, 'The last run failed (' + lastRun.exit + '):\n' + String(lastRun.output).slice(-1500) + '\nFind the cause, fix the code, and run it again with run_code.');
        continue;
      }
    }
    // searched but read nothing: snippets are often old or partial — open a page or two and confirm (once)
    if(!forceCloud && searches && !opened && !nudgedOpen && turn < 8){
      nudgedOpen = true;
      pushBack(text, 'Before you answer: open the one or two most relevant result pages with open_page and confirm the facts (snippets can be old or wrong). Then answer.');
      continue;
    }
    // the draft is checked against the rules; what breaks them goes back to the model (twice at most) to fix with its tools
    const toolOut = messages.filter(m=>m.role === 'tool').map(m=>m.content).join(' ');
    const calcOut = messages.filter(m=>m.role === 'tool' && m.tool_name === 'calculate').map(m=>m.content).join(' ');
    const issues = forceCloud || !o.review ? [] : o.review(text, {question, sources, extra: calcOut + ' ' + toolOut, searched: searches > 0, timely});
    if(process.env.MONEY_AI_DEBUG) console.error('\n--- draft:\n' + text + '\n--- issues: ' + JSON.stringify(issues) + '\n--- sources: ' + sources.map(s=>'[' + s.n + '] ' + s.text.length + ' chars ' + s.url).join('\n'));
    trace('check', issues.length ? 'Rules check: ' + issues.length + ' to fix' : 'Rules check: all kept', issues.length ? issues.map(i=>i.rule + ' — ' + i.text).join('\n') : 'Every rule kept.');
    if(!firstIssues){ firstIssues = issues; if(issues.length && o.remember) o.remember(issues, question); }
    // a rewrite is kept only if it breaks fewer rules than the best draft so far (a small model can "fix" a right number into a wrong one)
    const weight = list => list.reduce((t, i)=>t + (/R3|R4|R5|R6|R7|R10|R11/.test(i.rule) ? 3 : 1), 0);
    if(!best || weight(issues) < weight(best.issues)) best = {text, issues};
    // a day count is never left to the model: the calculator works it out for each date in the answer
    const dayFacts = best.issues.some(i=>i.rule === 'R6') && o.datesIn ? Array.from(new Set(o.datesIn(best.text).map(d=>d.toISOString().slice(0, 10)))).filter(d=>d > today).slice(0, 2).map(d=>o.calc('days from today to ' + d)).filter(Boolean) : [];
    // a rewrite with exactly the same problems will not get better by trying again
    const same = revisions && prevIssues === issues.map(i=>i.rule + i.text).join('|');
    prevIssues = issues.map(i=>i.rule + i.text).join('|');
    if(best.issues.length && revisions < 2 && turn < 8 && !same){
      revisions++;
      if(dayFacts.length) messages.push({role: 'tool', tool_name: 'calculate', content: dayFacts.join(' ')});
      step('Checking against the rules… ' + best.issues.length + ' to fix');
      pushBack(best.text, 'Your draft breaks these rules:\n' + best.issues.map(i=>'- ' + i.text).join('\n') +
        '\nFix each one: search, open_page or calculate if you need to. If a number or name is not in what you read, open the page that has it or leave it out — never put in a different number you have not read. ' +
        (dayFacts.length ? 'The calculator says: ' + dayFacts.join(' ') + ' Use exactly that count. ' : '') +
        'Then write the whole answer again, as if for the first time (do not mention a draft or corrections).');
      continue;
    }
    text = best.text;
    const issuesLeft = best.issues.slice();
    /* A BIGGER BRAIN WHEN NEEDED (only if you switched it on): a hard question — deep analysis, code, or an answer
       still breaking a rule after two fixes — is written by a cloud model from everything found here (pages read,
       prices, sums, code runs). Its code is run here and sent back if it fails; its answer is held to the same
       rules and kept only if it is no worse. */
    let cloudBy = '';
    const hard = /\b(analy[sz]e|analysis|compare|comparison|in detail|pros and cons|strategy|design|architecture|plan|why does|explain how)\b/i.test(question) || codeQ;
    if(o.cloud && (hard || issuesLeft.some(i=>/R3|R4|R5|R7|R8|R10|R11/.test(i.rule)) || (lastRun && !lastRun.ok))){
      try{
        step('Asking a bigger model to write this one');
        const found = sources.slice(0, 10).map(x=>`[${x.n}] ${x.title} — ${x.url}\n${String(x.text).slice(0, 1600)}`).join('\n\n');
        const work = messages.filter(m=>m.role === 'tool' && /calculate|market_analysis|run_code/.test(m.tool_name || '')).map(m=>m.tool_name + ':\n' + String(m.content).slice(0, 2500)).join('\n\n');
        const sys = SYSTEM(today).replace(/Work like a careful researcher:[\s\S]*$/, '') + '\nWrite the final answer to the question from the research below (gathered just now on the user\'s Mac). Mark facts from a source with its number like [3]; use only numbers from the research or the work shown. For code: one complete, working program in a fenced block with its language, then how to run it.' + RULEBOOK(o);
        let turns = (o.history || []).concat([{role: 'user', content: 'Question: ' + question + '\n\nResearch:\n' + (found || '(none)') + (work ? '\n\nWork done here:\n' + work : '') + (text ? '\n\nThe small model\'s draft (improve on it, do not mention it):\n' + text.slice(0, 3000) : '')}]);
        const tidyCites = t => String(t || '').replace(/【(\d+)(?:†[^】]*)?】/g, '[$1]').trim();
        let c = await o.cloud(sys, turns), ctext = tidyCites(c.text);
        // its code, run here; an error goes back to it (twice at most)
        for(let k = 0; k < 2 && o.runCode && codeQ; k++){
          const m = /```[ \t]*(python3?|py|javascript|js|c|cpp|c\+\+)\s*\n([\s\S]*?)```/i.exec(ctext);
          if(!m) break;
          step('▶️ Running the bigger model\'s ' + m[1]);
          const rr = await o.runCode({language: m[1], code: m[2], files: (o.attachments || []).filter(a=>!a.image).map(a=>({name: a.name.replace(/ — in run_code:.*$/, ''), text: a.text.replace(/^TABLE SUMMARY[\s\S]*?\n\n/, '')}))});
          trace('run', 'Ran ' + (rr.language || m[1]) + ' (cloud model\'s code) — ' + (rr.ok ? 'worked' : 'failed'), {lang: rr.language || m[1], code: m[2].slice(0, 6000), output: rr.output, ok: rr.ok});
          lastRun = rr; runs++;
          if(rr.ok){ if(!/output/i.test(ctext)) ctext += '\n\n**Output when run here:**\n```\n' + rr.output.slice(0, 1500) + '\n```'; break; }
          turns = turns.concat([{role: 'assistant', content: ctext}, {role: 'user', content: 'It failed when run:\n' + rr.output.slice(-1500) + '\nFix it; reply with the whole corrected answer.'}]);
          c = await o.cloud(sys, turns); ctext = tidyCites(c.text);
        }
        const cIssues = o.review ? o.review(ctext, {question, sources, extra: messages.filter(m=>m.role === 'tool').map(m=>m.content).join(' ') + ' ' + ctext.match(/```[\s\S]*?```/g), searched: searches > 0, timely}) : [];
        trace('think', 'Bigger model (' + c.provider + ' · ' + c.model + ') wrote the answer', ctext.slice(0, 3000));
        if(ctext && (forceCloud || weight(cIssues) <= weight(issuesLeft))){ text = ctext; issuesLeft.length = 0; cIssues.forEach(i=>issuesLeft.push(i)); cloudBy = c.provider + ' · ' + c.model; }
        else trace('check', 'Kept the small model\'s answer: the bigger model\'s broke more rules', cIssues.map(i=>i.rule + ' — ' + i.text).join('\n'));
      }catch(e){ trace('check', 'The bigger model could not answer: ' + e.message, ''); step('Bigger model unavailable: ' + e.message); }
    }
    if(forceCloud && !cloudBy){ forceCloud = false; best = null; firstIssues = null; step('Writing it on this Mac instead'); continue; }
    // TRUST BUT VERIFY: the code in the answer is run here before it is shown; any "Output" it claims is replaced by
    // what really printed (a small model sometimes writes output it never ran)
    if(o.runCode && !(o.disabled || []).includes('code')){
      let m = /```[ \t]*(python3?|py|javascript|js|c|cpp|c\+\+)\s*\n([\s\S]*?)```/i.exec(text), lang, code;
      if(m){ lang = m[1]; code = m[2]; }
      else { const j = /```json\s*([\s\S]*?)```/i.exec(text); if(j){ try{ const o2 = JSON.parse(j[1].replace(/\\'/g, "'")); const a2 = o2.arguments || {}; if(o2.name === 'run_code' && a2.code){ lang = a2.language || 'python'; code = a2.code; text = text.replace(j[0], '```' + lang + '\n' + code.trim() + '\n```'); } }catch(e){} } }
      if(code && !(lastRun && lastRun.code && lastRun.code.trim() === code.trim())){
        step('▶️ Checking the code in the answer');
        const rr = await o.runCode({language: lang, code, files: (o.attachments || []).filter(a=>!a.image).map(a=>({name: a.name.replace(/ — in run_code:.*$/, ''), text: a.text.replace(/^TABLE SUMMARY[\s\S]*?\n\n/, '')}))});
        runs++; lastRun = Object.assign({}, rr, {code});
        trace('run', 'Ran the code in the answer — ' + (rr.ok ? 'worked' : 'failed'), {lang: rr.language || lang, code: code.slice(0, 6000), output: rr.output, ok: rr.ok});
      }
      if(code && lastRun && lastRun.code && lastRun.code.trim() === code.trim()){
        const real = String(lastRun.output).slice(0, 2000);
        const outBlock = /(\*\*output[^*\n]*\*\*:?|output:)\s*\n```[^\n]*\n[\s\S]*?```/i;
        const shown = (lastRun.ok ? '**Output (run on this Mac):**' : '**⚠ It fails when run on this Mac:**') + '\n```\n' + real + '\n```';
        text = outBlock.test(text) ? text.replace(outBlock, shown) : text + '\n\n' + shown;
      }
    }
    // a coding answer always shows the code that was tested and what it printed (not just a description)
    if(codeQ && lastRun && lastRun.ok && lastRun.code && !/```/.test(text))
      text += '\n\n```' + (lastRun.language || '') + '\n' + lastRun.code.trim() + '\n```\n\n**Output (run on this Mac):**\n```\n' + String(lastRun.output).slice(0, 2000) + '\n```';
    // what is still wrong after fixing is shown, not hidden
    const warn = issuesLeft.filter(i=>/R4|R5|R7|R8|R10|R11/.test(i.rule)).map(i=>'⚠ ' + i.text);
    if(issuesLeft.some(i=>i.rule === 'R6') && dayFacts.length) warn.push('✔ Checked with the calculator: ' + dayFacts.join(' '));
    if(warn.length) text += '\n\n' + warn.join('\n');
    // an answer built on something that cannot have happened yet: say so first, not in a footnote
    const future = issuesLeft.find(i=>i.rule === 'R10');
    if(future) text = '⚠ Careful — this answer may be built on an older year\'s news: ' + future.text + '\n\n' + text.replace('\n⚠ ' + future.text, '');
    // a source number that points to nothing read is taken out
    text = text.replace(/\s*\[(\d+)\]/g, (m, n)=>sources.some(s=>s.n === +n) ? m : '');
    const cited = new Set((text.match(/\[(\d+)\]/g) || []).map(x=>+x.slice(1, -1)));
    if(cloudBy) step('Written by ' + cloudBy);
    return {text, chart: lastChart, read: sources.filter(s=>!cited.has(s.n) && /^https?:/.test(s.url)).slice(0, 8).map(s=>({i: s.n, title: s.title, url: s.url})), model: cloudBy ? cloudBy + ' (cloud), research on this Mac' : (r.model || 'local model') + ' (on this Mac)', sources: sources.filter(s=>cited.has(s.n)).map(s=>({i: s.n, title: s.title, url: s.url})),
      by: (cloudBy ? cloudBy + ' (cloud), researched' : (r.model || 'local model')) + ' on this Mac · ' + searches + ' search' + (searches === 1 ? '' : 'es') + (usedSearch.size ? ' (' + Array.from(usedSearch).join(', ') + ')' : '') + ', ' + opened + ' page' + (opened === 1 ? '' : 's') + ' read' + (usedRead.size ? ' (' + Array.from(usedRead).join(', ') + ')' : '') +
        (runs ? ' · code run ' + runs + '×' + (lastRun ? (lastRun.ok ? ', last run worked' : ', last run failed') : '') : '') +
        (o.review ? ' · rules: ' + (firstIssues && firstIssues.length ? firstIssues.length + ' caught, ' + Math.max(0, firstIssues.length - issuesLeft.length) + ' fixed' : 'all kept') : ''),
      issues: issuesLeft};
  }
  return {text: 'I could not finish within 10 steps. Try a narrower question.', sources: []};
}
