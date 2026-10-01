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
  {type: 'function', function: {name: 'read_file', description: 'Read a text file on this computer that the user mentioned.',
    parameters: {type: 'object', properties: {path: {type: 'string'}}, required: ['path']}}},
];
const SYSTEM = today => `You are Money AI, a research assistant running on the user's own Mac. Today is ${today}.
Work like a careful researcher:
- If the question needs current information or specific facts (news, prices, rates, dates, numbers, names, "latest"), use web_search first. Search again with better words if the results are weak. Open the most promising pages with open_page to read the details — snippets are often not enough.
- For ANY arithmetic (multiplying a price by a quantity, totals, percentages, EMI) and for counting days between dates ("days from today to 8 November 2026"), call calculate first and use its result; never do sums or date counts in your head.
- Search snippets can be old or wrong: before answering a factual question, open the most relevant page or two and confirm.
- For general explanations you know well (what something is, how it works), you may answer directly.
- Sources disagree sometimes: say so, and prefer the newest and most official.
- When you have enough, write the answer once: clear plain sentences, every fact from a source marked with its number like [3]. Copy numbers and names exactly as the source gives them. Say what you could not find. No separate "Final answer" section, no repeating yourself.
Do not invent sources or numbers.`;

export async function runAgent(question, o){
  const step = t => { try{ o.onStep && o.onStep(t); }catch(e){} };
  const today = new Date().toISOString().slice(0, 10);
  const sources = [];                                             // everything read, numbered as the model sees it
  const numberOf = (url, title, text) => { let s = sources.find(x=>x.url === url); if(!s){ s = {n: sources.length + 1, url, title: title || url, text: ''}; sources.push(s); } if(text) s.text += ' ' + text; return s.n; };
  const messages = [{role: 'system', content: SYSTEM(today)}].concat(o.history || [], [{role: 'user', content: question}]);
  if(o.files && o.files.length) messages.push({role: 'user', content: 'Files I mentioned: ' + o.files.join(', ') + ' (use read_file).'});
  const timely = /\b(today|now|latest|current|currently|this (week|month|year)|recent|news|live|price|rate|score|update|who is|who won|when is|when was|how much|how many days|days (left|until|till|to))\b/i.test(question);
  let nudged = false, nudgedOpen = false, searches = 0, opened = 0;
  const usedSearch = new Set(), usedRead = new Set();                // which services answered (a backup shows here)
  const run = async (name, args) => {
    if(name === 'web_search'){
      const q = String(args.query || question).slice(0, 300);
      step('🔎 Searching: ' + q);
      searches++;
      const r = await o.search(q, 8);
      usedSearch.add(r.provider || 'search');
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
      return `[${n}] ${page.title}${page.published ? ' (published ' + String(page.published).slice(0, 10) + ')' : ''}\n${best.slice(0, 3500)}`;
    }
    if(name === 'calculate'){
      step('🧮 Calculating: ' + String(args.expression).slice(0, 60));
      const r = o.calc(String(args.expression || ''));
      return r || 'Could not work that out — write it as a plain expression, like (1250+750)/8.';
    }
    if(name === 'read_file'){
      const p = path.resolve(String(args.path || ''));
      const allowed = (o.files || []).map(f=>path.resolve(f)).includes(p) || p.startsWith(process.cwd() + path.sep);
      if(!allowed) return 'I may read only files the user named, or files in the current folder.';
      if(!fs.existsSync(p)) return 'No such file: ' + p;
      step('📂 Reading file: ' + path.basename(p));
      const text = fs.readFileSync(p, 'utf8').slice(0, 20000);
      const n = numberOf('file://' + p, path.basename(p), text);
      return `[${n}] ${path.basename(p)}\n${text.slice(0, 8000)}`;
    }
    return 'Unknown tool.';
  };
  for(let turn = 0; turn < 10; turn++){
    step(turn ? 'Thinking about what it found…' : 'Thinking…');
    const r = await o.chat(messages, TOOLS);
    const msg = r.message || {};
    const calls = msg.tool_calls || [];
    if(calls.length && turn < 9){
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
    // a question about now, answered from memory: look it up first (once)
    if(!searches && !nudged && timely && turn < 8){
      nudged = true;
      messages.push({role: 'assistant', content: text}, {role: 'user', content: 'That needs current information. Use web_search to check before answering.'});
      continue;
    }
    // not an answer (a bare expression, a fragment): ask for a proper one
    if((text.length < 25 || /^[\d\s()+\-−×*/.,a-z]{0,60}$/i.test(text) && !/[.!?]$/.test(text)) && turn < 8){
      messages.push({role: 'assistant', content: text}, {role: 'user', content: 'Please finish: use calculate if you need a sum or a day count, then answer in a full sentence.'});
      continue;
    }
    // a day count must come from the calculator, never from the model's head (once)
    const calcOut = messages.filter(m=>m.role === 'tool' && m.tool_name === 'calculate').map(m=>m.content).join(' ');
    const counts = Array.from(text.matchAll(/(\d+)\s+(days?|weeks?)\b/gi)).map(m=>m[1]);
    if(counts.some(n=>!new RegExp('\\b' + n + '\\b').test(calcOut)) && !o._nudgedCalc && turn < 8){
      o._nudgedCalc = true;
      messages.push({role: 'assistant', content: text}, {role: 'user', content: 'Check the day count with calculate (for example "days from today to <the date you found>") and answer with its result.'});
      continue;
    }
    // searched but read nothing: snippets are often old or partial — open a page or two and confirm (once)
    if(searches && !opened && !nudgedOpen && turn < 8){
      nudgedOpen = true;
      messages.push({role: 'assistant', content: text}, {role: 'user', content: 'Before you answer: open the one or two most relevant result pages with open_page and confirm the facts (snippets can be old or wrong). Then answer.'});
      continue;
    }
    // every figure in the answer must be in what was read
    const nums = t => (t.match(/\d[\d,.]*\d|\d/g) || []).map(x=>x.replace(/,/g, '').replace(/\.$/, '')).filter(x=>x.length >= 3);
    const read = sources.map(s=>s.title + ' ' + s.text).join(' ') + ' ' + messages.filter(m=>m.role === 'tool').map(m=>m.content).join(' ');
    const have = new Set(nums(read));
    // sums written in the answer ("A × B = C") are worked out again: a right result counts as known, a wrong one is pointed out
    const val = x => parseFloat(String(x).replace(/[₹,\s]/g, ''));
    const wrongSums = [];
    for(const m of text.matchAll(/(₹?\s?[\d,]+(?:\.\d+)?)\s*([×x*\/+−-])\s*(₹?\s?[\d,]+(?:\.\d+)?)\s*=\s*(₹?\s?[\d,]+(?:\.\d+)?)/g)){
      const a = val(m[1]), b = val(m[3]), c = val(m[4]);
      const want = m[2] === '/' ? a / b : m[2] === '+' ? a + b : /[−-]/.test(m[2]) ? a - b : a * b;
      if(Math.abs(want - c) <= Math.max(0.011, Math.abs(want) * 0.0005)) nums(m[4]).forEach(n=>have.add(n));
      else wrongSums.push(m[0].trim() + ' (it is ' + (Math.round(want * 100) / 100).toLocaleString('en-IN') + ')');
    }
    if(wrongSums.length) text += '\n\n⚠ A sum in this answer is wrong: ' + wrongSums.join('; ') + '.';
    const foreign = sources.length ? Array.from(new Set(nums(text.replace(/\[\d+\]/g, '').replace(/⚠[^\n]*/g, '')).filter(n=>!have.has(n) && !/^(19|20)\d\d$/.test(n)))) : [];
    if(foreign.length) text += '\n\n⚠ Not found in what I read: ' + foreign.slice(0, 4).join(', ') + ' — check before relying on ' + (foreign.length === 1 ? 'it' : 'them') + '.';
    // a source number that points to nothing read is taken out
    text = text.replace(/\s*\[(\d+)\]/g, (m, n)=>sources.some(s=>s.n === +n) ? m : '');
    const cited = new Set((text.match(/\[(\d+)\]/g) || []).map(x=>+x.slice(1, -1)));
    return {text, sources: sources.filter(s=>cited.has(s.n)).map(s=>({i: s.n, title: s.title, url: s.url})),
      by: (r.model || 'local model') + ' on this Mac · ' + searches + ' search' + (searches === 1 ? '' : 'es') + (usedSearch.size ? ' (' + Array.from(usedSearch).join(', ') + ')' : '') + ', ' + opened + ' page' + (opened === 1 ? '' : 's') + ' read' + (usedRead.size ? ' (' + Array.from(usedRead).join(', ') + ')' : '')};
  }
  return {text: 'I could not finish within 10 steps. Try a narrower question.', sources: []};
}
