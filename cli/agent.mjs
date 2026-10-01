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
const SYSTEM = today => `You are a general research assistant running on the user's own Mac; questions can be about anything. Today is ${today}.
Work like a careful researcher:
- If the question needs current information or specific facts (news, prices, rates, dates, numbers, names, "latest"), use web_search first. Search again with better words if the results are weak. Open the most promising pages with open_page to read the details — snippets are often not enough.
- For ANY arithmetic (multiplying a price by a quantity, totals, percentages, EMI) and for counting days between dates ("days from today to 8 November 2026"), call calculate first and use its result; never do sums or date counts in your head.
- Search snippets can be old or wrong: before answering a factual question, open the most relevant page or two and confirm.
- For general explanations you know well (what something is, how it works), you may answer directly.
- Sources disagree sometimes: say so, and prefer the newest and most official.
- When you have enough, write the answer once: clear plain sentences, every fact from a source marked with its number like [3]. Copy numbers and names exactly as the source gives them. Say what you could not find. No separate "Final answer" section, no repeating yourself.
Do not invent sources or numbers.`;
// the rules every answer is held to, your own rules (~/.money-ai/rules.md) and the mistakes it made before
const RULEBOOK = o => (o.rules && o.rules.length ? '\nRules (your draft is checked against them and sent back if it breaks one):\n' + o.rules.map(r=>'- ' + r).join('\n') : '') +
  (o.userRules ? '\nThe user\'s own rules:\n' + o.userRules : '') +
  (o.mistakes && o.mistakes.length ? '\nMistakes you made before — do not repeat them:\n' + o.mistakes.map(m=>'- ' + m).join('\n') : '') +
  (o.timing ? '\n' + o.timing : '');

export async function runAgent(question, o){
  const step = t => { try{ o.onStep && o.onStep(t); }catch(e){} };
  const today = new Date().toISOString().slice(0, 10);
  const sources = [];                                             // everything read, numbered as the model sees it
  const numberOf = (url, title, text) => { let s = sources.find(x=>x.url === url); if(!s){ s = {n: sources.length + 1, url, title: title || url, text: ''}; sources.push(s); } if(text) s.text += ' ' + text; return s.n; };
  // corrections from before go right with the question (a small model reads what is near the question best)
  const lessons = o.cases && o.cases.length ? '\n\n(Corrections you were given before for questions like this — they override what you remember; still check with a search when the answer can change:\n' + o.cases.map(m=>'- ' + m).join('\n') + ')' : '';
  const messages = [{role: 'system', content: SYSTEM(today) + RULEBOOK(o)}].concat(o.history || [], [{role: 'user', content: question + lessons}]);
  if(o.files && o.files.length) messages.push({role: 'user', content: 'Files I mentioned: ' + o.files.join(', ') + ' (use read_file).'});
  const timely = o.isTimely ? o.isTimely(question) : /\b(today|now|latest|current|recent|news|price|rate|score|who is|who won)\b/i.test(question);
  let nudged = false, nudgedOpen = false, searches = 0, opened = 0, revisions = 0, firstIssues = null, best = null;
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
      const years = Array.from(new Set((String(page.content).match(/\b20[0-3]\d\b/g) || []))).sort();
      const when = page.published ? 'published ' + String(page.published).slice(0, 10) : years.length ? 'years mentioned: ' + years.slice(-3).join(', ') : 'date not shown';
      return `[${n}] ${page.title} (${when})\n${best.slice(0, 3500)}`;
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
    // a small model sometimes writes the call instead of making it: web_search("…"), {"name": "calculate", …}
    const written = /^\W*(web_search|open_page|calculate|read_file)\s*\(\s*(?:\w+\s*=\s*)?["']?([\s\S]*?)["']?\s*\)\W*$/.exec(text) ||
      (()=>{ const all = Array.from(text.matchAll(/\b(web_search|open_page|calculate|read_file)\s*\(\s*(?:\w+\s*=\s*)?["']([^"'\n]{1,300})["']\s*\)/g)); return all.length && !/\[\d+\]/.test(text) ? all[all.length - 1] : null; })() ||
      (()=>{ try{ const j = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)); const a = j.arguments || j.parameters || {}; return j.name && /^(web_search|open_page|calculate|read_file)$/.test(j.name) ? [null, j.name, a.query || a.url || a.expression || a.path || ''] : null; }catch(e){ return null; } })();
    if(written && written[2] && turn < 9){
      const name = written[1], arg = String(written[2]).trim(), key = {web_search: 'query', open_page: 'url', calculate: 'expression', read_file: 'path'}[name];
      messages.push({role: 'assistant', content: '', tool_calls: [{function: {name, arguments: {[key]: arg}}}]});
      let result;
      try{ result = await run(name, {[key]: arg}); }catch(e){ result = 'That did not work: ' + e.message; }
      messages.push({role: 'tool', tool_name: name, content: result});
      continue;
    }
    if(!text && best) text = best.text;                            // out of steps mid-fix: the best draft so far stands
    // a question about now, answered from memory: look it up first (once)
    if(!searches && !nudged && timely && turn < 8){
      nudged = true;
      messages.push({role: 'assistant', content: text}, {role: 'user', content: 'That needs current information. Use web_search to check before answering.'});
      continue;
    }
    // not an answer (a bare expression, a fragment): ask for a proper one
    if((text.length < 25 || /^[\d\s()+\-−×*/.,a-z^=]{0,80}$/i.test(text) && !/[.!?]$/.test(text)) && turn < 8){
      messages.push({role: 'assistant', content: text}, {role: 'user', content: 'Please finish: use calculate if you need a sum or a day count, then answer in a full sentence.'});
      continue;
    }
    // searched but read nothing: snippets are often old or partial — open a page or two and confirm (once)
    if(searches && !opened && !nudgedOpen && turn < 8){
      nudgedOpen = true;
      messages.push({role: 'assistant', content: text}, {role: 'user', content: 'Before you answer: open the one or two most relevant result pages with open_page and confirm the facts (snippets can be old or wrong). Then answer.'});
      continue;
    }
    // the draft is checked against the rules; what breaks them goes back to the model (twice at most) to fix with its tools
    const toolOut = messages.filter(m=>m.role === 'tool').map(m=>m.content).join(' ');
    const calcOut = messages.filter(m=>m.role === 'tool' && m.tool_name === 'calculate').map(m=>m.content).join(' ');
    const issues = o.review ? o.review(text, {question, sources, extra: calcOut + ' ' + toolOut, searched: searches > 0, timely}) : [];
    if(process.env.MONEY_AI_DEBUG) console.error('\n--- draft:\n' + text + '\n--- issues: ' + JSON.stringify(issues) + '\n--- sources: ' + sources.map(s=>'[' + s.n + '] ' + s.text.length + ' chars ' + s.url).join('\n'));
    if(!firstIssues){ firstIssues = issues; if(issues.length && o.remember) o.remember(issues, question); }
    // a rewrite is kept only if it breaks fewer rules than the best draft so far (a small model can "fix" a right number into a wrong one)
    const weight = list => list.reduce((t, i)=>t + (/R3|R4|R5|R6|R7|R8|R10|R11/.test(i.rule) ? 3 : 1), 0);
    if(!best || weight(issues) < weight(best.issues)) best = {text, issues};
    // a day count is never left to the model: the calculator works it out for each date in the answer
    const dayFacts = best.issues.some(i=>i.rule === 'R6') && o.datesIn ? Array.from(new Set(o.datesIn(best.text).map(d=>d.toISOString().slice(0, 10)))).filter(d=>d > today).slice(0, 2).map(d=>o.calc('days from today to ' + d)).filter(Boolean) : [];
    if(best.issues.length && revisions < 2 && turn < 8){
      revisions++;
      if(dayFacts.length) messages.push({role: 'tool', tool_name: 'calculate', content: dayFacts.join(' ')});
      step('Checking against the rules… ' + best.issues.length + ' to fix');
      messages.push({role: 'assistant', content: best.text}, {role: 'user', content: 'Your draft breaks these rules:\n' + best.issues.map(i=>'- ' + i.text).join('\n') +
        '\nFix each one: search, open_page or calculate if you need to. If a number or name is not in what you read, open the page that has it or leave it out — never put in a different number you have not read. ' +
        (dayFacts.length ? 'The calculator says: ' + dayFacts.join(' ') + ' Use exactly that count. ' : '') +
        'Then write the whole answer again, as if for the first time (do not mention a draft or corrections).'});
      continue;
    }
    text = best.text;
    const issuesLeft = best.issues;
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
    return {text, model: (r.model || 'local model') + ' (on this Mac)', sources: sources.filter(s=>cited.has(s.n)).map(s=>({i: s.n, title: s.title, url: s.url})),
      by: (r.model || 'local model') + ' on this Mac · ' + searches + ' search' + (searches === 1 ? '' : 'es') + (usedSearch.size ? ' (' + Array.from(usedSearch).join(', ') + ')' : '') + ', ' + opened + ' page' + (opened === 1 ? '' : 's') + ' read' + (usedRead.size ? ' (' + Array.from(usedRead).join(', ') + ')' : '') +
        (o.review ? ' · rules: ' + (firstIssues && firstIssues.length ? firstIssues.length + ' caught, ' + Math.max(0, firstIssues.length - issuesLeft.length) + ' fixed' : 'all kept') : ''),
      issues: issuesLeft};
  }
  return {text: 'I could not finish within 10 steps. Try a narrower question.', sources: []};
}
