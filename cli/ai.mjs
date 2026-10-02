#!/usr/bin/env node
/* =========================================================
   ai — your own AI on the command line, on its own (like a terminal assistant); ask about anything.
   Every command and setting: ai help (cli/help.mjs, also docs/HELP.md).
     ai "question"              one answer: sums worked out exactly, facts looked up, anything else searched on the
                                web, read, and answered by an AI with its sources
     ai                         a conversation (follow-up questions keep the thread)
     ai -f notes.txt "question" answer from a file (text, markdown, CSV, JSON, HTML) as well as the web
     ai --no-web / --no-ai      only what it knows / only the web's own sentences (no AI)
     ai --json "question"       the answer as JSON (for scripts)
     ai --cloud "question"      a hard question may be written by a cloud model     (ai cloud on|off: always)
     ai setup                   keys for the search services and the AIs (kept in ~/.money-ai/, only on this Mac)
     ai status                  what is set up
     ai rules                   the rules every answer is checked against, yours (~/.money-ai/rules.md) and what it learned
     ai ui                      the same AI in a small page in your browser (http://127.0.0.1:8899)
     ai teach "lesson"          correct the last answer; questions like it get your lesson first   (ai forget 2: drop lesson 2)
   The same engine as the apps (engine/*.js); the same search and reading as the relay (relay/worker.js) — here with
   no relay, since a terminal may call the services directly.
   ========================================================= */
import {createRequire} from 'module';
import {fileURLToPath} from 'url';
import fs from 'fs';
import os from 'os';
import path from 'path';
import vm from 'vm';
import readline from 'readline';
import * as Local from './local.mjs';
import {runAgent} from './agent.mjs';
import * as Market from './market.mjs';
import * as Runner from './runner.mjs';
import * as Help from './help.mjs';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const HOME = path.join(os.homedir(), '.money-ai');
const CONFIG = path.join(HOME, 'config.json'), STORE = path.join(HOME, 'store.json'), RULES_FILE = path.join(HOME, 'rules.md'), LAST = path.join(HOME, 'last.json');
// your own rules: one per line starting with "- " (the rest of the file is notes)
const userRules = () => { try{ return fs.readFileSync(RULES_FILE, 'utf8').split('\n').filter(l=>/^\s*[-*]\s+\S/.test(l)).map(l=>l.replace(/^\s*[-*]\s+/, '').trim()).slice(0, 20); }catch(e){ return []; } };
const tty = process.stdout.isTTY, C = (n, s) => tty ? `\x1b[${n}m${s}\x1b[0m` : s;
const dim = s => C(2, s), bold = s => C(1, s), cyan = s => C(36, s), yellow = s => C(33, s), red = s => C(31, s), green = s => C(32, s);

/* ---------------------------------------------------------------- settings, kept on this Mac only */
const readJson = (f, d) => { try{ return JSON.parse(fs.readFileSync(f, 'utf8')); }catch(e){ return d; } };
const writeJson = (f, v) => { fs.mkdirSync(HOME, {recursive: true, mode: 0o700}); fs.writeFileSync(f, JSON.stringify(v, null, 2), {mode: 0o600}); };
const config = () => {
  const c = readJson(CONFIG, {search: {}, ai: {keys: {}}});
  const e = process.env;
  // keys in the environment win (TAVILY_KEYS, SERPAPI_KEY, GOOGLE_API_KEY, GOOGLE_CX, JINA_KEY, GEMINI_API_KEY, GROQ_API_KEY, …)
  c.search = Object.assign({}, c.search, Object.fromEntries(Object.entries({tavily: e.TAVILY_KEYS && e.TAVILY_KEYS.split(','), serpapi: e.SERPAPI_KEY, googleKey: e.GOOGLE_API_KEY, googleCx: e.GOOGLE_CX, jina: e.JINA_KEY}).filter(([, v])=>v)));
  c.ai = c.ai || {keys: {}};
  ['gemini', 'groq', 'cerebras', 'mistral', 'openrouter', 'anthropic'].forEach(k=>{ const v = e[k.toUpperCase() + '_API_KEY']; if(v) c.ai.keys[k] = v; });
  if(e.OLLAMA_HOST) c.ai.keys.ollama = e.OLLAMA_HOST;
  return c;
};

/* ---------------------------------------------------------------- the engine, loaded as the apps load it */
function engine(cfg){
  const store = readJson(STORE, {});
  store['money-ai'] = JSON.stringify(Object.assign({}, JSON.parse(store['money-ai'] || '{}'), {keys: cfg.ai.keys || {}, first: cfg.ai.first || 'auto'}));
  const save = () => { try{ writeJson(STORE, store); }catch(e){} };
  const localStorage = {getItem: k=>k in store ? store[k] : null, setItem: (k, v)=>{ store[k] = String(v); save(); }, removeItem: k=>{ delete store[k]; save(); }};
  global.localStorage = localStorage;
  const ctx = {window: {addEventListener(){}, dispatchEvent(){}}, document: {addEventListener(){}, querySelectorAll: ()=>[]}, localStorage,
    location: {origin: 'cli', hostname: 'cli'}, navigator: {userAgent: 'money-ai-cli'}, console, fetch, AbortController, Response, Headers, setTimeout, clearTimeout,
    setInterval: ()=>0, JSON, Date, Math, Intl, CustomEvent: class{ constructor(t){ this.type = t; } }};
  ctx.window.CustomEvent = ctx.CustomEvent;
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'engine/ai.js'), 'utf8') + '\nthis.MoneyAI = MoneyAI;', ctx);
  global.MoneyBrain = require(path.join(ROOT, 'engine/brain.js'));
  global.MoneyBrain.reload();                                       // what the terminal or the helper learned since
  const Web = require(path.join(ROOT, 'engine/web.js'));
  return {AI: ctx.MoneyAI, Web};
}
// Wikimedia asks programs to say who they are
const _fetch = global.fetch;
global.fetch = (url, o) => _fetch(url, Object.assign({}, o, {headers: Object.assign({'user-agent': 'money-ai-cli/1.0 (+https://github.com/Anilgupta2606/AI)'}, (o || {}).headers)}));

async function searcher(cfg){
  const relay = await import(path.join(ROOT, 'relay/worker.js'));
  const env = {TAVILY_KEYS: (cfg.search.tavily || []).join(','), SERPAPI_KEY: cfg.search.serpapi, GOOGLE_API_KEY: cfg.search.googleKey, GOOGLE_CX: cfg.search.googleCx, JINA_KEY: cfg.search.jina};
  const any = !!(env.TAVILY_KEYS || env.SERPAPI_KEY || (env.GOOGLE_API_KEY && env.GOOGLE_CX));
  return {any, search: (q, n) => relay.search(env, q, n), read: (url, links) => relay.read(env, url, links)};
}

/* ---------------------------------------------------------------- one question */
const FILE_TYPES = /\.(txt|md|markdown|csv|tsv|json|html?|xml|log|yaml|yml|ini|js|ts|py|sql)$/i;
async function answer(question, o){
  const cfg = config();
  o.disabled = Array.from(new Set((o.disabled || []).concat(cfg.ai.off || [])));
  // the page's cloud keys, for this one answer only (never written to disk)
  if(o.cloudKeys) cfg.ai.keys = Object.assign({}, cfg.ai.keys, Object.fromEntries(Object.entries(o.cloudKeys).filter(([k, v])=>/^(gemini|groq|cerebras|mistral|openrouter|anthropic)$/.test(k) && typeof v === 'string' && v.length < 400)));
  const {AI, Web} = engine(cfg), S = await searcher(cfg);
  const hasAi = AI.aiAvailable() && !o.noAi;
  const step = t => { if(o.onStep) return o.onStep(t); if(o.json || !tty) return; if(/^(?:[🔎📄🧮📂📈]|▶)/u.test(t)) process.stderr.write('\r\x1b[K' + dim('  ' + t) + '\n'); else process.stderr.write('\r\x1b[K' + dim('… ' + t)); };
  const done = () => { if(!o.json && tty && !o.onStep) process.stderr.write('\r\x1b[K'); };
  const chat = hasAi ? (system, turns, opts) => AI.chat(system, (o.history || []).concat(turns), Object.assign({}, opts, {onProgress: t=>step(t)})) : null;
  // a file: its text is a source too
  let fileSources = [];
  for(const f of o.files || []){
    if(!fs.existsSync(f)) throw new Error('No such file: ' + f);
    if(!FILE_TYPES.test(f)) throw new Error('I read text files (txt, md, csv, json, html…); ' + path.basename(f) + ' is not one.');
    fileSources.push({title: path.basename(f), url: 'file://' + path.resolve(f), content: fs.readFileSync(f, 'utf8').slice(0, 60000)});
  }
  // 1. worked out or looked up exactly (sums, rates, weather, time, meanings, facts) — unless a file is given
  // a follow-up ("and for 10 years?", "what about Bank Nifty?") needs the conversation, so it goes to the model, not the quick tools
  const followUp = (o.history || []).length && /^(and|also|what about|how about|then|so|but|same|now|ok|okay|why|what if)\b|\b(it|that|this|those|them|these|same|above|previous|earlier)\b/i.test(question.trim()) && question.trim().split(/\s+/).length < 14;
  const attached = (o.attachments || []).length > 0;
  if(imageAsk(question) && !(o.attachments || []).some(a=>a.image)){ step('🎨 Making the picture'); const out = await makeImage(question, o); done(); return out; }
  // about earlier chats ("what did you tell me…"): that is for the AI with your chats, not the quick tools
  const aboutPast = /\b(you (told|said|suggested|gave|recommended)|did you (tell|say)|we (discussed|talked)|last time|earlier (chat|conversation|question)|previous (chat|conversation)|my (earlier|previous|last) (question|chat))\b/i.test(question);
  // the same question a moment ago (no files, not a follow-up): at once
  if(!fileSources.length && !followUp && !o.fresh && !attached && !aboutPast && !(o.history || []).length){
    const c = cached(question, Web);
    if(c){ done(); return Object.assign(c, {saved: true, by: 'Answered ' + (c.ageMin ? c.ageMin + ' min ago' : 'just now') + ' (the same question) · ' + (c.by || '')}); }
  }
  // an answer you marked 👍 for this same question (settled facts only), unless you ask for it fresh
  if(!fileSources.length && !followUp && !o.fresh && !attached && !aboutPast){
    const g = Web.findGood(question);
    if(g){ done(); return {text: g.text, sources: g.sources || [], model: 'Your saved answer', saved: true, by: 'Your saved answer from ' + g.at + ' (you marked it 👍)' + (g.model ? ' · first written by ' + g.model : '')}; }
  }
  if(!fileSources.length && !o.deep && !followUp && !attached && !aboutPast){
    step('Checking what can be worked out or looked up exactly…');
    let quick = formatAsk(question).lang ? null : await Web.answer(question, {factsOnly: !!S.any}).catch(()=>null);    // "reply in Hindi": the model answers
    // a looked-up fact only when it answers this question: not when the question has a qualifier the lookup
    // ignores ("the FIRST prime minister", "who WROTE…", "when did X BECOME…"), and not when its answer misses
    // the question's own key words ("national anthem" answered with the national song)
    if(quick && quick.kind === 'fact'){
      const qualified = /\b(first|second|third|last|former|previous|ex-?|founding|original|earliest|oldest|youngest|wrote|written|composed|invented|discovered|founded|built|designed|became|become|becomes|elected|appointed|in which year|which year|when did|when was|how long|until|before|after|during|never)\b/i.test(question);
      const STOPQ = /^(who|what|which|when|where|is|are|was|were|the|a|an|of|in|on|for|to|and|or|does|did|do|has|have|how|many|much|name|tell|me)$/i;
      const keyw = String(question).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(w=>w.length > 2 && !STOPQ.test(w));
      const said = String(quick.text || '').toLowerCase();
      const covered = keyw.filter(w=>said.includes(w.replace(/s$/, ''))).length;
      if(qualified || (keyw.length >= 2 && covered < Math.ceil(keyw.length / 2))) quick = null;
    }
    if(quick && quick.kind !== 'not-found' && quick.kind !== 'read'){ done(); return formatted(question, Object.assign({by: 'Worked out exactly · ' + quick.kind + ' (no AI)'}, quick)); }
  }
  // 2. the model on this Mac at the wheel: it searches (your SearXNG), reads pages (here), calculates and answers
  const ollama = cfg.ai.keys.ollama;
  if(ollama && !o.noAi && !o.classic){
    let models = [];
    try{ models = ((await (await fetch(ollama.replace(/\/+$/, '') + '/api/tags')).json()).models || []).map(m=>m.name); }catch(e){}
    const general = models.filter(m=>!/coder|embed/i.test(m));
    const model = general.length ? AI.rankModels('ollama', general, 'smart')[0] : null;
    // a programming question goes to the coding model when it is on this Mac (better code for its size)
    const coder = models.find(m=>/coder/i.test(m));
    const codeQ = /\b(write|build|create|make|implement|fix|debug|refactor)\b[\s\S]{0,40}\b(code|program|script|function|class|app|algorithm|query)\b|\b(python|javascript|java|c\+\+|sql|typescript|bash)\b[\s\S]{0,30}\b(program|code|script|function|query)\b|```/i.test(question);
    // THE RIGHT MODEL FOR THE QUESTION: code, analysis (tables, sums, money, markets), or general — each kind has its
    // model (ai models; set from the model race), unless you chose one for everything (ai model <name>, --model)
    const chosen = o.model || process.env.MONEY_AI_MODEL || cfg.ai.model;
    if(chosen && !models.includes(chosen)) throw new Error('The model ' + chosen + ' is not on this Mac (ollama pull ' + chosen + ', or ai model auto)');
    const routes = routesFor(cfg, models);
    const kind = codeQ ? 'code' : (attached && (o.attachments || []).concat(fileSources).some(a=>/\.(csv|tsv)$/i.test(a.name || a.title || '')))
      || /\b(analy[sz]e|analysis|average|total|sum|percent(age)?|growth|trend|compare|comparison|statistics?|forecast|calculate|emi|sip|cagr|interest|returns?|budget|invest(ment)?|loan|inflation|stock|shares?|nifty|sensex|market|portfolio|profit|revenue|cost)\b/i.test(question) ? 'analysis' : 'general';
    const useModel = chosen || routes[kind] || model;
    // not in memory yet: say so (a first load takes a few seconds on this Mac)
    try{ const ps = ((await (await _fetch(ollama.replace(/\/+$/, '') + '/api/ps')).json()).models || []).map(m=>m.name);
      if(!ps.includes(useModel)) step('⏳ Loading the ' + (chosen ? '' : kind + ' ') + 'model (' + useModel + ') — the first answer after a switch takes a few seconds longer'); }catch(e){}
    if(model || o.model || cfg.ai.model){
      // your search engine not answering: restart it (a few seconds) before any backup is used
      let localUp = await Local.searxngUp();
      if(!localUp && !o.noWeb && process.platform === 'darwin'){
        step('Starting your search engine…');
        try{ (await import('child_process')).execSync('launchctl kickstart -k gui/$(id -u)/com.moneyai.searxng 2>/dev/null || launchctl load ~/Library/LaunchAgents/com.moneyai.searxng.plist 2>/dev/null', {stdio: 'ignore', shell: '/bin/sh'}); }catch(e){}
        for(let i = 0; i < 12 && !localUp; i++){ await new Promise(r=>setTimeout(r, 1000)); localUp = await Local.searxngUp(); }
      }
      const search = async (q, n) => {
        if(o.noWeb) throw new Error('web search is off (--no-web)');
        if(localUp){ try{ return await Local.search(q, n); }catch(e){ if(!S.any) throw e; } }
        if(S.any) return S.search(q, n);                      // only if your own search engine is down
        throw new Error('Your search engine (SearXNG) is not running — start it with:  launchctl kickstart -k gui/$(id -u)/com.moneyai.searxng');
      };
      const read = async (url, links) => { try{ return await Local.read(url, links); }catch(e){ if(cfg.search.jina) return S.read(url, links); throw e; } };
      // streamed, so the answer can be shown as it is written; kept loaded for 30 minutes (no reload between questions)
      const chat = async (messages, tools, opts) => {
        if(o.signal && o.signal.aborted) throw new Error('Stopped');
        const r = await fetch(ollama.replace(/\/+$/, '') + '/api/chat', {method: 'POST', signal: o.signal, body: JSON.stringify({model: useModel, messages, tools, stream: true, think: false, keep_alive: '10m', options: {temperature: 0.2, num_ctx: 12288}})});
        if(!r.ok) throw new Error('The model answered ' + r.status + ': ' + (await r.text()).slice(0, 200));
        let content = '', calls = [], buf = '', last = 0;
        const dec = new TextDecoder();
        for await (const chunk of r.body){
          buf += dec.decode(chunk, {stream: true});
          let i;
          while((i = buf.indexOf('\n')) >= 0){
            const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
            if(!line) continue;
            const j = JSON.parse(line);
            if(j.error) throw new Error('The model: ' + j.error);
            const m = j.message || {};
            if(m.content) content += m.content;
            if(m.tool_calls) calls = calls.concat(m.tool_calls);
            if(opts && opts.onDelta && !calls.length && Date.now() - last > 120){ last = Date.now(); opts.onDelta(content); }
          }
        }
        if(opts && opts.onDelta && !calls.length) opts.onDelta(content);
        return {message: {role: 'assistant', content, tool_calls: calls.length ? calls : undefined}, model: useModel + (chosen ? '' : ' · ' + kind + ' model')};
      };
      // pictures: a model on this Mac that can see (gemma3 and the like) describes them and reads their text
      const vision = routes.vision;
      const see = vision ? async (im, q) => {
        step('🖼 Looking at the picture with ' + vision);
        const r = await _fetch(ollama.replace(/\/+$/, '') + '/api/chat', {method: 'POST', body: JSON.stringify({model: vision, stream: false, keep_alive: '10m', options: {temperature: 0.1, num_ctx: 8192},
          messages: [{role: 'user', content: 'The user asks: "' + q + '"\nDescribe this picture in detail so someone who cannot see it can answer that. Copy any text, numbers, labels, tables or code in it exactly. Say what kind of picture it is (photo, screenshot, chart, receipt, document…). Do not guess what is not visible.', images: [im.image]}]})});
        if(!r.ok) throw new Error(vision + ' answered ' + r.status);
        const j = await r.json();
        return {text: String((j.message || {}).content || '').trim(), model: vision};
      } : null;
      const pick = (q, text, n) => { const b = Web.bestSentences(q, [{title: '', url: '', text, rank: 0}], n); return b.length ? b.map(x=>x.s).join(' ') : String(text).slice(0, 2500); };
      // dates too: "days from today to 8 November 2026", "days between 2026-10-01 and 2026-11-08"
      const MON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
      const dateOf = t => { t = String(t).trim().toLowerCase().replace(/(\d)(st|nd|rd|th)\b/, '$1').replace(/,/g, '');
        if(/^today$/.test(t)) return new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
        let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t); if(m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
        m = /^(\d{1,2})\s+([a-z]+)\s+(\d{4})$/.exec(t); if(m && MON.indexOf(m[2].slice(0, 3)) >= 0) return new Date(Date.UTC(+m[3], MON.indexOf(m[2].slice(0, 3)), +m[1]));
        m = /^([a-z]+)\s+(\d{1,2})\s+(\d{4})$/.exec(t); if(m && MON.indexOf(m[1].slice(0, 3)) >= 0) return new Date(Date.UTC(+m[3], MON.indexOf(m[1].slice(0, 3)), +m[2]));
        return null; };
      const calc = expr => {
        const e = String(expr).replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
        // "days from A to B", or "B - A" with two dates
        const d = /days?\s+(?:from|between)\s+(.+?)\s+(?:to|and|until|till)\s+(.+?)\s*\??$/i.exec(e) || (()=>{ const m = /^(.+?)\s+[-−–]\s+(.+)$/.exec(e); return m && dateOf(m[1]) && dateOf(m[2]) ? [null, m[2], m[1]] : null; })();
        if(d){ const a = dateOf(d[1]), b = dateOf(d[2]); if(a && b){ const n = Math.round((b - a) / 86400000); return `${n} days from ${a.toISOString().slice(0, 10)} to ${b.toISOString().slice(0, 10)}${Math.abs(n) >= 7 ? ' (' + Math.floor(Math.abs(n) / 7) + ' weeks ' + (Math.abs(n) % 7) + ' days)' : ''}.`; } }
        const r = Web.calc(expr) || Web.calc('what is ' + expr); return r ? r.text : null; };
      const ur = userRules();
      const out = await runAgent(question, {search, read, chat, pick, calc, files: o.files, history: o.history, onStep: step, onTrace: o.onTrace, onDraft: o.onDraft, attachments: (o.attachments || []).concat(fileSources.map(f=>({name: path.basename(f.url.replace(/^file:\/\//, '')), text: f.content}))), see, signal: o.signal, format: formatAsk(question),
        trustOf: Web.trustOf, trustRank: u => Web.TRUST_RANK[Web.trustOf(u)] || 0, searchChats: (q, n) => searchSessions(q, n),
        goal: o.goal, profile: profile().map(p=>p.text), disabled: o.disabled || [], connectors: (o.disabled || []).includes('connectors') ? [] : getConnectors(), callConnector,
        cloud: (o.cloud || o.cloudKeys || cfg.ai.cloud) && AI.aiStatus().some(x=>!/ollama|webllm/.test(x.id)) ? (system, turns) => AI.chat(system, turns, {skip: ['ollama', 'webllm'], maxTokens: 3000}, o.signal) : null,
        market: (o.disabled || []).includes('market') ? null : (q, tf) => Market.analyse(q, tf), runCode: (o.disabled || []).includes('code') ? null : a => Runner.run(a), review: Web.review, isTimely: Web.isTimely, datesIn: Web.datesIn, remember: Web.remember, cases: Web.casesFor(question), timing: Web.timingNote(question), rules: Object.values(Web.RULES), userRules: ur.map(r=>'- ' + r).join('\n'), mistakes: Web.pastMistakes()});
      done(); formatted(question, out); if(!(o.history || []).length && !attached) keepAnswer(question, out); return out;
    }
  }
  // 3. no model on this Mac: the classic way (search, read, then an online AI answers)
  if((S.any && !o.noWeb) || fileSources.length){
    const search = async (q, n) => {
      const web = S.any && !o.noWeb ? await S.search(q, n) : {provider: 'your files', results: []};
      return {provider: web.provider, results: fileSources.concat(web.results)};
    };
    const out = await Web.deep(question, {search, read: S.read, chat, onStep: step});
    done(); return out;
  }
  // 3. no search keys: Wikipedia, then (if there is one) an AI puts it in words
  const read = await Web.answer(question).catch(()=>null);
  if(read && read.kind !== 'not-found'){ done(); return hasAi && read.passages ? await Web.rephrase(question, read, chat) : read; }
  if(hasAi){ step('Asking the AI (no web search set up)…'); const r = await AI.chat('Answer plainly and briefly. Say so when you are not sure.', (o.history || []).concat([{role: 'user', content: question}]), {}); done();
    return {text: r.text.trim(), sources: [], by: r.provider + ' · ' + r.model + ' — from its own knowledge (no web search set up: run  ai setup)'}; }
  done();
  return {text: read ? read.text : 'I could not answer that. Run  ai setup  to add a web search service or an AI key.', sources: []};
}
const trustLine = v => v ? (v.confidence === 'High' ? green('  ✓ Confidence high') : v.confidence === 'Low' ? red('  ⚠ Confidence low') : yellow('  ~ Confidence medium')) + dim(' — ' + v.supported + ' of ' + v.checked + ' claims backed by the sources' + (v.by ? ' (checked by ' + v.by + ')' : '')) +
  (v.contradicted.length ? '\n' + v.contradicted.map(c=>red('    ✗ ') + c.claim.slice(0, 140) + dim(c.why ? ' — ' + c.why : '')).join('\n') : '') : '';
const show = (out, o) => {
  try{ if(out && out.q) writeJson(LAST, {question: out.q, text: String(out.text || '').slice(0, 2000), at: new Date().toISOString()}); }catch(e){}
  if(o.json){ console.log(JSON.stringify(out, null, 2)); return; }
  console.log('\n' + String(out.text || '').replace(/\[(\d+)\]/g, (m)=>cyan(m)) + '\n');
  (out.sources || []).forEach((s, i)=>console.log(dim('  [' + (s.i || i + 1) + '] ' + s.title + (s.url && !/^file:/.test(s.url) ? ' — ' + s.url : ''))));
  if(out.by) console.log(dim('  ' + out.by));
  if(out.images && out.images[0] && out.images[0].file && tty && process.platform === 'darwin' && !o.json) import('child_process').then(c=>c.execFile('open', [out.images[0].file]));
  console.log('');
};

/* ---------------------------------------------------------------- setup and status */
function ask(q, hidden){
  return new Promise(res=>{
    const rl = readline.createInterface({input: process.stdin, output: process.stdout, terminal: true});
    if(hidden){ const w = rl._writeToOutput.bind(rl); rl._writeToOutput = s => w(s.startsWith(q) ? s : s.replace(/[^\r\n]/g, '•')); }
    rl.question(q, a=>{ rl.close(); if(hidden) process.stdout.write('\n'); res(a.trim()); });
  });
}
async function setup(){
  const c = readJson(CONFIG, {search: {}, ai: {keys: {}}});
  c.search = c.search || {}; c.ai = c.ai || {keys: {}};
  console.log(bold('\nAI — setup') + dim('  (kept in ' + CONFIG + ', readable only by you; Enter keeps what is there, "-" removes it)\n'));
  const field = async (label, get, set, hidden) => { const now = get(); const a = await ask(label + (now ? dim(' [set]') : '') + ': ', hidden); if(a === '-') set(undefined); else if(a) set(a); };
  console.log(bold('Web search') + dim(' — any one is enough; more means more free searches'));
  await field('  Tavily keys (comma-separated, from several accounts)', ()=>c.search.tavily && c.search.tavily.length, v=>{ c.search.tavily = v ? v.split(',').map(s=>s.trim()).filter(Boolean) : []; }, true);
  await field('  SerpApi key', ()=>c.search.serpapi, v=>{ c.search.serpapi = v; }, true);
  await field('  Google Programmable Search API key', ()=>c.search.googleKey, v=>{ c.search.googleKey = v; }, true);
  await field('  Google search engine ID (cx)', ()=>c.search.googleCx, v=>{ c.search.googleCx = v; });
  await field('  Jina Reader key (optional)', ()=>c.search.jina, v=>{ c.search.jina = v; }, true);
  console.log(bold('\nAI') + dim(' — the one that reads and answers; free keys: Gemini, Groq, Cerebras, Mistral, OpenRouter'));
  for(const k of ['gemini', 'groq', 'cerebras', 'mistral', 'openrouter', 'anthropic']) await field('  ' + k, ()=>c.ai.keys[k], v=>{ if(v) c.ai.keys[k] = v; else delete c.ai.keys[k]; }, true);
  await field('  Ollama address (this Mac, e.g. http://localhost:11434)', ()=>c.ai.keys.ollama, v=>{ if(v) c.ai.keys.ollama = v; else delete c.ai.keys.ollama; });
  writeJson(CONFIG, c);
  console.log(green('\nSaved.') + ' Try:  ai "what is the repo rate today?"\n');
}
async function status(){
  const cfg = config(), {AI} = engine(cfg), S = await searcher(cfg);
  const up = await Local.searxngUp();
  let localModel = '';
  try{ const ms = ((await (await fetch(String(cfg.ai.keys.ollama || 'http://localhost:11434').replace(/\/+$/, '') + '/api/tags')).json()).models || []).map(m=>m.name); const gm = ms.filter(m=>!/coder|embed/i.test(m)); localModel = gm.length ? AI.rankModels('ollama', gm, 'smart')[0] : ''; if(ms.some(m=>/coder/i.test(m))) localModel += ' (code: ' + ms.find(m=>/coder/i.test(m)) + ')'; }catch(e){}
  console.log(bold('\nWorks on its own: ') + (up && localModel ? green('yes') + ' — your search engine ' + green('(SearXNG, running)') + ', pages read on this Mac, model ' + green(localModel) + ' on this Mac'
    : yellow((up ? '' : 'SearXNG is not running (launchctl kickstart -k gui/$(id -u)/com.moneyai.searxng). ') + (localModel ? '' : 'No model on this Mac (ollama pull qwen3:4b-instruct).'))));
  console.log(bold('Backups (used only if yours is down): ') + ([cfg.search.tavily && cfg.search.tavily.length ? 'Tavily ×' + cfg.search.tavily.length : '', cfg.search.serpapi ? 'SerpApi' : '', cfg.search.googleKey && cfg.search.googleCx ? 'Google' : ''].filter(Boolean).join(', ') || 'none') + (cfg.search.jina ? ', Jina Reader' : ''));
  console.log(bold('Cloud AI for hard questions: ') + (cfg.ai.cloud ? green('on') : 'off') + (cloudNames().length ? dim(' — keys: ' + cloudNames().join(', ')) : dim(' — no cloud keys')));
  const st = AI.aiStatus();
  console.log(bold('AI: ') + (st.length ? st.map(x=>x.name + (x.resting ? yellow(' (resting)') : '')).join(' → ') : yellow('none — run  ai setup')) + '\n');
}

async function rules(){
  const cfg = config(), {Web} = engine(cfg);
  if(!fs.existsSync(RULES_FILE)) { fs.mkdirSync(HOME, {recursive: true, mode: 0o700}); fs.writeFileSync(RULES_FILE, '# Your rules for your AI\n# One rule per line starting with "- ". Every answer is told to follow them.\n# For example:\n#   - Give amounts in rupees with Indian commas (1,00,000)\n#   - For cricket, say the match format (Test, ODI, T20)\n', {mode: 0o600}); }
  console.log(bold('\nEvery answer is checked against:'));
  Object.entries(Web.RULES).forEach(([k, v])=>console.log('  ' + dim(k) + ' ' + v));
  const ur = userRules();
  console.log(bold('\nYour rules') + dim(' (' + RULES_FILE + ')') + ':' + (ur.length ? '' : dim(' none yet — add lines starting with "- "')));
  ur.forEach(r=>console.log('  - ' + r));
  const ms = global.MoneyBrain.lessons({app: 'ai', topic: 'mistake'}).filter(L=>!L.off).sort((a, b)=>b.n - a.n);
  console.log(bold('\nMistakes it was caught making') + dim(' (it is reminded of these before every answer)') + ':' + (ms.length ? '' : dim(' none yet')));
  ms.forEach(L=>console.log('  ' + yellow(L.n + '×') + ' ' + (Web.RULES[L.key] || L.key)));
  const cs = cases();
  console.log(bold('\nLessons from particular questions') + dim(' (given first to questions like them; ai forget <n> drops one)') + ':' + (cs.length ? '' : dim(' none yet')));
  cs.forEach((L, i)=>{ const r = global.MoneyBrain.recall('ai', 'case', L.key, {min: 0.001}); console.log('  ' + cyan(String(i + 1)) + ' ' + (r ? r.value : '') + dim(L.why === 'You corrected it' ? '  (you taught this)' : '')); });
  console.log('');
}

const cases = () => global.MoneyBrain.lessons({app: 'ai'}).filter(L=>!L.off && (L.topic === 'case' || L.topic === 'good')).sort((a, b)=>a.first - b.first);
export async function teach(lesson, question){
  const cfg = config(), {Web} = engine(cfg), last = question ? {question} : readJson(LAST, null);
  lesson = String(lesson || '').trim();
  if(!last || !last.question) return console.log(yellow('Ask something first; then  ai teach "what is right"  corrects that answer.'));
  if(lesson.length < 8) return console.log(yellow('Say what is right, for example:  ai teach "The October 2026 meeting is on 5-7 October; it has not happened yet"'));
  Web.learnCase(last.question, [{rule: 'you'}], {text: 'For “' + last.question.slice(0, 90) + '”: ' + lesson});
  if(question) return true;
  console.log(green('Learned.') + ' Questions like “' + last.question.slice(0, 70) + '” will start with your lesson.  (ai rules lists everything it learned)');
}
/* what it has learned, for the page: the rules, your rules, mistakes by rule, lessons from particular questions */
export function learned(){
  const cfg = config(), {Web} = engine(cfg), B = global.MoneyBrain;
  return {rules: Web.RULES, yours: userRules(), rulesFile: RULES_FILE,
    mistakes: B.lessons({app: 'ai', topic: 'mistake'}).filter(L=>!L.off).sort((a, b)=>b.n - a.n).map(L=>({rule: L.key, text: Web.RULES[L.key] || L.key, n: L.n})),
    cases: cases().filter(L=>L.topic === 'case').map(L=>{ const r = B.recall('ai', 'case', L.key, {min: 0.001}); return {id: L.id, question: L.label || '', lesson: r ? r.value : '', taught: L.why === 'You corrected it', n: L.n}; }),
    profile: profile(),
    saved: cases().filter(L=>L.topic === 'good').map(L=>({id: L.id, question: L.label || ''})),
    selfexam: readJson(path.join(HOME, 'selfexam.json'), null)};
}
// 👍 keeps a settled answer for next time; 👎 with what was wrong becomes a lesson for questions like it
export function feedback({question, good, note, answer}){
  const cfg = config(), {Web} = engine(cfg);
  if(good) return {ok: true, saved: Web.saveGood(String(question || ''), answer || {})};
  global.MoneyBrain.learn('ai', 'mistake', 'you', 'yes', {label: 'Answers you marked wrong', why: String(question || '').slice(0, 120)});
  if(note && String(note).trim().length >= 8) Web.learnCase(String(question), [{rule: 'you'}], {text: 'For “' + String(question).slice(0, 90) + '”: ' + String(note).trim()});
  return {ok: true};
}
export function forgetId(id){ const cfg = config(); engine(cfg); const L = cases().concat(global.MoneyBrain.lessons({app: 'ai', topic: 'profile'})).find(x=>x.id === id); if(!L) return false; global.MoneyBrain.forget(id); return true; }
export {answer};
/* FORMAT the user asked for, kept in code where it can be: "a number only" -> just the number */
export const formatAsk = q => ({
  numberOnly: /\b(number only|only (the|a) number|just the number|numeric answer only|digits only)\b/i.test(q),
  oneWord: /\b(one word|single word|in a word)\b(?! or more)/i.test(q) && /\b(only|answer|reply)\b/i.test(q),
  bullets: (/\bexactly (\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b[^.?!]*\b(bullet|item|point)s?\b|\bas a bullet list\b/i.exec(q) || [])[1] || null,
  lang: (/\b(?:reply|answer|respond|write)\s+(?:only\s+)?in\s+(hindi|marathi|gujarati|tamil|telugu|bengali|kannada|french|spanish|german)\b/i.exec(q) || [])[1] || null,
  terse: /\b(nothing else|no explanation|without explanation|just (the )?answer)\b/i.test(q),
});
function formatted(q, out){
  const f = formatAsk(q);
  if(f.numberOnly){ const ns = String(out.text || '').replace(/\[\d+\]/g, '').match(/-?\d[\d,]*(?:\.\d+)?/g) || []; if(ns.length) out.text = ns[ns.length - 1]; }
  return out;
}

/* SECOND OPINION: another pass, strict and narrow — each claim judged only against its own evidence
   (supported / not found / contradicted). A fast cloud model when cloud is on (a different model from the one that
   wrote it), else a JSON-only local pass. It sets the final confidence; a contradiction is remembered as a lesson. */
export async function verifyClaims(out, question, o){
  o = o || {};
  const t = out && out.trust; if(!t || !t.claims || !t.claims.length) return null;
  const cfg = config(), {AI, Web} = engine(cfg);
  const prompt = 'Judge each claim ONLY from its evidence (text read from the web or files). SUPPORTED: the evidence states it (numbers must match). NOT_FOUND: the evidence does not say it. CONTRADICTED: the evidence says something different.\n\n' +
    t.claims.map((c, i)=>`Claim ${i + 1}: ${c.claim.replace(/\[\d+\]/g, '')}\nEvidence ${i + 1}: ${c.evidence || '(none)'}`).join('\n\n') +
    '\n\nReply with JSON only: {"verdicts":[{"n":1,"v":"SUPPORTED|NOT_FOUND|CONTRADICTED","why":"under 15 words"}]}';
  let raw = '', by = '';
  try{
    if(cloudNames().length && (cfg.ai.cloud || o.cloud)){
      let r = null;
      for(const only of [['groq', 'cerebras'], ['gemini', 'mistral', 'openrouter']]){ try{ r = await AI.chat('You are a strict fact checker. Output JSON only.', [{role: 'user', content: prompt}], {only, maxTokens: 500}, o.signal); break; }catch(e){} }
      if(r){ raw = r.text; by = r.provider + ' · ' + r.model; }
    }
    if(!raw){
      const host = String(cfg.ai.keys.ollama || '').replace(/\/+$/, ''), m = await localModel();
      if(!host || !m) return null;
      const r = await _fetch(host + '/api/generate', {method: 'POST', signal: o.signal, body: JSON.stringify({model: m, prompt: 'You are a strict fact checker. Output JSON only.\n\n' + prompt, format: 'json', stream: false, think: false, keep_alive: '10m', options: {temperature: 0, num_predict: 400, num_ctx: 8192}})});
      raw = (await r.json()).response || ''; by = m + ' (second pass)';
    }
  }catch(e){ return null; }
  let v = []; try{ v = (JSON.parse(String(raw).slice(String(raw).indexOf('{'), String(raw).lastIndexOf('}') + 1)).verdicts || []); }catch(e){ return null; }
  const at = n => (v.find(x=>+x.n === n) || {});
  const res = t.claims.map((c, i)=>({claim: c.claim, v: String(at(i + 1).v || 'NOT_FOUND').toUpperCase().replace(/\s+/g, '_'), why: String(at(i + 1).why || '').slice(0, 120), numbersOk: c.ok}));
  // a claim whose figures are not in the evidence is not "supported", whatever the checker says
  res.forEach(r=>{ if(r.v === 'SUPPORTED' && !r.numbersOk) r.v = 'NOT_FOUND'; });
  const supported = res.filter(r=>r.v === 'SUPPORTED').length, contra = res.filter(r=>r.v === 'CONTRADICTED'), missing = res.filter(r=>r.v === 'NOT_FOUND');
  let confidence = contra.length ? 'Low' : missing.length * 2 >= res.length ? 'Low' : supported === res.length && t.confidence !== 'Low' && (t.domains >= 2 || t.trusted >= 1) ? 'High' : 'Medium';
  if(contra.length && question) Web.remember(contra.map(c=>({rule: 'R12', text: 'Contradicted by its own sources: "' + c.claim.slice(0, 120) + '"'})), question);
  return {confidence, checked: res.length, supported, notFound: missing.map(r=>r.claim), contradicted: contra.map(r=>({claim: r.claim, why: r.why})), by, claims: res};
}

/* the same question again soon: answered at once (30 minutes for things that change, a day for the rest) */
const CACHE = path.join(HOME, 'cache.json');
const cacheKey = q => String(q).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
function cached(q, Web){ const c = readJson(CACHE, {})[cacheKey(q)]; if(!c) return null; const age = Date.now() - c.at; return age < (Web.isTimely(q) ? 30 * 60000 : 24 * 3600000) ? Object.assign({}, c.out, {ageMin: Math.round(age / 60000)}) : null; }
function keepAnswer(q, out){
  if(!out || !out.text || /Stopped|could not finish/.test(out.text)) return;
  const all = readJson(CACHE, {}); all[cacheKey(q)] = {at: Date.now(), out: {text: out.text, sources: out.sources, read: out.read, by: out.by, model: out.model, chart: out.chart, trust: out.trust}};
  const keep = Object.entries(all).sort((a, b)=>b[1].at - a[1].at).slice(0, 60);
  try{ writeJson(CACHE, Object.fromEntries(keep)); }catch(e){}
}

/* PICTURES FROM A DESCRIPTION: "draw / make / generate an image of…" — made by your relay (Cloudflare Workers AI,
   FLUX.1 schnell, your account's free daily allowance), saved in ~/Pictures/AI Images and shown on the page. */
export const imageAsk = q => /\b(generate|create|make|draw|design|paint|render|produce|sketch|imagine)\b[\s\S]{0,50}\b(image|picture|photo|illustration|drawing|painting|logo|poster|wallpaper|art(work)?|sketch|icon|banner|portrait|scene)\b|^\s*(an? )?(image|picture|drawing|painting) of\b/i.test(q) && !/\b(describe|explain|what is (in|on)|read) (this|the|my) (image|picture|photo)\b/i.test(q);
export async function makeImage(prompt, o){
  o = o || {};
  const cfg = config(), url = String((cfg.relay || {}).url || process.env.MONEY_AI_RELAY || '').replace(/\/+$/, '');
  let token = ''; try{ token = fs.readFileSync(path.join(HOME, 'relay-token'), 'utf8').trim(); }catch(e){}
  if(!url || !token) throw new Error('Pictures are made by your relay: its address and token are not set on this Mac (~/.money-ai/relay-token).');
  // the description, without "please generate an image of"
  const desc = String(prompt).replace(/^\s*(please\s+)?(can you\s+)?(generate|create|make|draw|design|paint|render|produce|sketch|imagine)\s+(me\s+)?(an?\s+)?(image|picture|photo|illustration|drawing|painting|artwork|sketch)?\s*(of|showing|with)?\s*/i, '').trim() || prompt;
  const r = await _fetch(url + '/image?steps=6&prompt=' + encodeURIComponent(desc.slice(0, 900)), {headers: {'x-relay-token': token}, signal: o.signal});
  const j = await r.json().catch(()=>({error: 'The relay answered ' + r.status}));
  if(!r.ok || j.error) throw new Error(j.error || 'The relay answered ' + r.status);
  const dir = path.join(os.homedir(), 'Pictures', 'AI Images'); fs.mkdirSync(dir, {recursive: true});
  const file = path.join(dir, new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '-' + desc.replace(/[^\w ]/g, '').trim().split(/\s+/).slice(0, 6).join('-').toLowerCase() + '.jpg');
  fs.writeFileSync(file, Buffer.from(j.image, 'base64'));
  return {text: 'Here is your picture of **' + desc + '**.\n\nSaved on this Mac: `' + file.replace(os.homedir(), '~') + '`', images: [{b64: j.image, mime: j.mime || 'image/jpeg', file}], sources: [],
    model: j.model + ', your Cloudflare account', by: 'Made by ' + j.model + ' through your relay · ' + Math.round(j.image.length * 0.75 / 1024) + ' KB'};
}

/* ROUTES: which model answers which kind of question. Saved by the model race (test/exam/pick-models.mjs) or by
   ai models set <kind> <model>; else: the best general model, the coding model for code, a model that can see for pictures. */
export const KINDS = ['general', 'code', 'analysis', 'vision'];
function routesFor(cfg, models){
  const general = models.filter(m=>!/coder|embed|guardian/i.test(m));
  const best = general.length ? engine(cfg).AI.rankModels('ollama', general, 'smart')[0] : models[0];
  const def = {general: best, code: models.find(m=>/coder/i.test(m)) || best, analysis: best, vision: models.find(m=>/gemma[34]|llava|vision|qwen2\.5-?vl|minicpm-v|ministral-3|qwen3\.5/i.test(m)) || null};
  const saved = cfg.ai.routes || {};
  const out = {};
  KINDS.forEach(k=>{ out[k] = saved[k] && models.includes(saved[k]) ? saved[k] : def[k]; });
  return out;
}
export function setRoutes(r){
  const c = readJson(CONFIG, {search: {}, ai: {keys: {}}}); c.ai = c.ai || {keys: {}};
  c.ai.routes = Object.assign({}, c.ai.routes || {}, Object.fromEntries(Object.entries(r || {}).filter(([k, v])=>KINDS.includes(k) && typeof v === 'string' && v)));
  writeJson(CONFIG, c); return c.ai.routes;
}

/* three short follow-up questions for an answer: a fast cloud model when cloud is on, else a short local run */
export async function followUps(question, text, o){
  o = o || {};
  if(!text || /no AI\)|Your saved answer/.test(o.by || '')) return [];
  const cfg = config(), {AI} = engine(cfg);
  const prompt = 'Question: ' + String(question).slice(0, 400) + '\n\nAnswer: ' + String(text).replace(/```[\s\S]*?```/g, '[code]').slice(0, 1500) +
    '\n\nWrite 3 short follow-up questions the user is likely to ask next (each under 12 words, in the same language as the question). One per line, no numbers, no quotes, nothing else.';
  let out = '';
  try{
    if(cfg.ai.cloud && cloudNames().length){ const r = await AI.chat('You suggest follow-up questions.', [{role: 'user', content: prompt}], {skip: ['ollama', 'webllm'], maxTokens: 120, tier: 'fast'}, o.signal); out = r.text; }
    else {
      const host = String(cfg.ai.keys.ollama || '').replace(/\/+$/, ''), m = await localModel();
      if(!host || !m) return [];
      const r = await _fetch(host + '/api/generate', {method: 'POST', signal: o.signal, body: JSON.stringify({model: m, prompt, stream: false, think: false, keep_alive: '10m', options: {temperature: 0.4, num_predict: 90, num_ctx: 4096}})});
      out = (await r.json()).response || '';
    }
  }catch(e){ return []; }
  return String(out).split('\n').map(l=>l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').replace(/^["']|["']$/g, '').trim()).filter(l=>l.length > 6 && l.length < 120 && /\?$/.test(l)).slice(0, 3);
}
export async function warm(){
  const cfg = config(), host = String(cfg.ai.keys.ollama || '').replace(/\/+$/, ''), m = await localModel();
  if(!host || !m) return false;
  try{ await fetch(host + '/api/generate', {method: 'POST', body: JSON.stringify({model: m, prompt: '', keep_alive: '10m'})}); return true; }catch(e){ return false; }
}
export async function localModel(){
  const cfg = config(), {AI} = engine(cfg), host = String(cfg.ai.keys.ollama || '').replace(/\/+$/, '');
  if(!host) return '';
  try{ const ms = ((await (await fetch(host + '/api/tags')).json()).models || []).map(m=>m.name); return ms.filter(m=>!/coder|embed/i.test(m)).length ? AI.rankModels('ollama', ms.filter(m=>!/coder|embed/i.test(m)), 'smart')[0] : ''; }catch(e){ return ''; }
}
/* ---------------------------------------------------------------- CONNECTORS: data sources it can ask (like plug-ins)
   Each is a web address with {query} in it; it is called on this Mac, never an address inside your home network.
   The presets are public and need no key; you can add your own (name, what it is for, the address). */
const CONNECTORS = path.join(HOME, 'connectors.json');
export const PRESETS = [
  {name: 'Wikipedia', description: 'A short summary of a topic or person from Wikipedia (query: the exact article title)', url: 'https://en.wikipedia.org/api/rest_v1/page/summary/{query}'},
  {name: 'Dictionary', description: 'Meanings of a word, with examples, from Wiktionary (query: the word)', url: 'https://en.wiktionary.org/api/rest_v1/page/definition/{query}'},
  {name: 'Exchange rates', description: 'Today\'s exchange rates from one currency to all others (query: a currency code like USD or INR)', url: 'https://open.er-api.com/v6/latest/{query}'},
  {name: 'Books', description: 'Find books: title, author, first published year (query: title or author)', url: 'https://openlibrary.org/search.json?limit=5&fields=title,author_name,first_publish_year,subject&q={query}'},
  {name: 'GitHub', description: 'Find open-source code projects: name, stars, description (query: what the project does)', url: 'https://api.github.com/search/repositories?per_page=5&q={query}'},
  {name: 'Hacker News', description: 'What programmers are discussing: stories and links (query: a topic)', url: 'https://hn.algolia.com/api/v1/search?hitsPerPage=6&query={query}'},
  {name: 'Weather', description: 'Weather now and the next 3 days for a place: temperature, rain, wind, humidity (query: a city, like Pune)', url: 'https://wttr.in/{query}?format=j1'},
  {name: 'News', description: 'Latest news headlines with dates and links from Google News (query: a topic or name)', url: 'https://news.google.com/rss/search?hl=en-IN&gl=IN&ceid=IN:en&q={query}'},
  {name: 'Research papers', description: 'Scientific papers: title, year, citations, DOI, from OpenAlex (query: a topic)', url: 'https://api.openalex.org/works?per-page=6&select=title,publication_year,doi,cited_by_count,primary_location&search={query}'},
  {name: 'Stack Overflow', description: 'Programming questions and how many answers they have (query: the problem in a few words)', url: 'https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance&site=stackoverflow&pagesize=6&q={query}'},
  {name: 'Crypto prices', description: 'Live crypto prices in rupees and dollars with the 24-hour change (query: coin ids, comma-separated, like bitcoin,ethereum)', url: 'https://api.coingecko.com/api/v3/simple/price?vs_currencies=inr,usd&include_24hr_change=true&ids={query}'},
  {name: 'Public holidays', description: 'Public holidays of a country in a year (query: YEAR/COUNTRY-CODE, like 2026/US or 2026/GB; India is not covered — search the web for Indian holidays)', url: 'https://date.nager.at/api/v3/PublicHolidays/{query}'},
  {name: 'Places', description: 'Where a place is: full address, area, coordinates, from OpenStreetMap (query: a place or address)', url: 'https://nominatim.openstreetmap.org/search?format=json&limit=3&addressdetails=1&q={query}'},
  {name: 'Python packages', description: 'A Python package on PyPI: latest version, summary, links (query: the package name)', url: 'https://pypi.org/pypi/{query}/json'},
  {name: 'npm packages', description: 'A JavaScript package on npm: latest version, description, dependencies (query: the package name)', url: 'https://registry.npmjs.org/{query}/latest'},
  {name: 'Similar words', description: 'Words with a similar meaning (synonyms) for writing (query: a word or phrase)', url: 'https://api.datamuse.com/words?max=15&ml={query}'},
];
export function getConnectors(){
  const saved = readJson(CONNECTORS, null);
  if(saved && Array.isArray(saved.list)){
    const have = new Set(saved.list.map(c=>c.name));
    return saved.list.concat(PRESETS.filter(p=>!have.has(p.name)).map(c=>Object.assign({on: true, preset: true}, c)));
  }
  return PRESETS.map(c=>Object.assign({on: true, preset: true}, c));
}
export function saveConnectors(list){
  const clean = (Array.isArray(list) ? list : []).slice(0, 30).map(c=>({name: String(c.name || '').trim().slice(0, 40), description: String(c.description || '').trim().slice(0, 240), url: String(c.url || '').trim().slice(0, 500), on: c.on !== false, preset: !!c.preset}))
    .filter(c=>/^[\w .&'-]{2,40}$/.test(c.name) && /^https:\/\/[^\s]+\{query\}/.test(c.url) && c.description.length >= 5 && !Local.isPrivate(c.url.replace('{query}', 'x')));
  writeJson(CONNECTORS, {list: clean});
  return clean;
}
export async function callConnector(c, query){
  const q = String(query).trim().slice(0, 300);
  const url = c.url.replace('{query}', /\/\{query\}$/.test(c.url) && /^[\w./-]+$/.test(q) ? q : encodeURIComponent(q).replace(/%2C/g, ','));
  if(Local.isPrivate(url)) throw new Error('That address is inside your network — not called');
  const ctl = new AbortController(), t = setTimeout(()=>ctl.abort(), 15000);
  try{
    const r = await _fetch(url, {headers: {'user-agent': 'money-ai/1.0 (+https://github.com/Anilgupta2606/AI)', accept: 'application/json, text/plain;q=0.9, */*;q=0.5'}, signal: ctl.signal});
    const type = r.headers.get('content-type') || '', body = await r.text();
    if(!r.ok) throw new Error(c.name + ' answered ' + r.status);
    let text = body;
    if(/json/.test(type)){ try{ text = JSON.stringify(JSON.parse(body)); }catch(e){} }
    else if(/xml|rss/.test(type) || /^\s*<\?xml/.test(body)){
      const items = Array.from(body.matchAll(/<item>([\s\S]*?)<\/item>/g)).slice(0, 10).map(m=>{ const g = t => ((new RegExp('<' + t + '>([\\s\\S]*?)</' + t + '>')).exec(m[1]) || [])[1] || ''; return '- ' + g('title').replace(/<!\[CDATA\[|\]\]>/g, '') + ' (' + g('pubDate').slice(0, 16) + ') ' + g('link'); });
      text = items.length ? items.join('\n') : body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    }
    else if(/html/.test(type)) text = body.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    return {url, text: text.slice(0, 8000)};
  }finally{ clearTimeout(t); }
}
/* what you asked it to remember about you (/remember), and your rules (/rule) */
export function remember(text){ engine(config()); text = String(text || '').trim().slice(0, 300); if(text.length < 3) return false; global.MoneyBrain.learn('ai', 'profile', text.toLowerCase().slice(0, 80), text, {label: text, weight: 3}); return true; }
const profile = () => global.MoneyBrain.lessons({app: 'ai', topic: 'profile'}).filter(L=>!L.off).map(L=>({id: L.id, text: L.label || L.key}));
export function addRule(text){
  text = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  if(text.length < 5) return false;
  if(!fs.existsSync(RULES_FILE)) writeJson(path.join(HOME, '.keep'), {});
  fs.appendFileSync(RULES_FILE, (fs.existsSync(RULES_FILE) && !fs.readFileSync(RULES_FILE, 'utf8').endsWith('\n') ? '\n' : '') + '- ' + text + '\n', {mode: 0o600});
  return true;
}

/* AI keys from the page (Money Home's Setup holds them in the browser): saved for the terminal and the helper in
   ~/.money-ai/config.json (readable only by you). Only AI services; the answer says which, never the keys. */
const CLOUD = /^(gemini|groq|cerebras|mistral|openrouter|anthropic)$/;
export function saveKeys(keys){
  const c = readJson(CONFIG, {search: {}, ai: {keys: {}}});
  c.ai = c.ai || {keys: {}}; c.ai.keys = c.ai.keys || {};
  const got = Object.entries(keys || {}).filter(([k, v])=>CLOUD.test(k) && typeof v === 'string' && v.trim().length >= 10 && v.length < 400 && !/\s/.test(v.trim()));
  got.forEach(([k, v])=>{ c.ai.keys[k] = v.trim(); });
  writeJson(CONFIG, c);
  return got.map(([k])=>k);
}
export function cloudNames(){ const k = (config().ai || {}).keys || {}; return Object.keys(k).filter(n=>CLOUD.test(n) && k[n]); }

/* the published page, on this Mac, swaps lessons with the terminal's memory (the page's sync then carries them to your phone) */
const onlyAi = b => ({lessons: Object.fromEntries(Object.entries((b && b.lessons) || {}).filter(([, L])=>L && L.app === 'ai')),
  forgotten: Object.fromEntries(Object.entries((b && b.forgotten) || {}).filter(([id])=>id.startsWith('ai:'))), updatedAt: (b && b.updatedAt) || 0});
export function brainExport(){ engine(config()); return onlyAi(global.MoneyBrain.exportAll()); }
export function brainMerge(other){ engine(config()); return global.MoneyBrain.merge(onlyAi(other)); }
function forgetLesson(n){
  const cfg = config(); engine(cfg);
  const L = cases()[+n - 1];
  if(!L) return console.log(yellow('No lesson ' + n + ' — see  ai rules'));
  global.MoneyBrain.forget(L.id);
  console.log(green('Forgotten: ') + String(L.label || L.key).slice(0, 80));
}

/* ---------------------------------------------------------------- CHATS: every conversation kept, to come back to
   ~/.money-ai/sessions/<id>.json — the page's and the terminal's in one place, so either can resume the other's.
   {id, title, source, created, updated, goal, turns: [{q, answer: {text, sources, by, model, secs, chart}, steps, traces}]} */
const SESSIONS = path.join(HOME, 'sessions');
const newId = () => new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14) + '-' + Math.random().toString(36).slice(2, 6);
const okId = id => /^[\w-]{6,40}$/.test(String(id || ''));
export function listSessions(){
  try{ fs.mkdirSync(SESSIONS, {recursive: true, mode: 0o700}); }catch(e){}
  return fs.readdirSync(SESSIONS).filter(f=>f.endsWith('.json')).map(f=>{ const x = readJson(path.join(SESSIONS, f), null); return x && {id: x.id, title: x.title, source: x.source, updated: x.updated, created: x.created, turns: (x.turns || []).length}; })
    .filter(Boolean).sort((a, b)=>String(b.updated).localeCompare(String(a.updated)));
}
export function loadSession(id){ return okId(id) ? readJson(path.join(SESSIONS, id + '.json'), null) : null; }
export function saveSession(x){
  if(!x || !okId(x.id)) return null;
  const turns = (Array.isArray(x.turns) ? x.turns : []).slice(-60).map(t=>({q: String(t.q || '').slice(0, 4000), answer: t.answer || {}, steps: t.steps || [], traces: t.traces || []}));
  if(!turns.length) return null;
  const old = loadSession(x.id) || {};
  const s2 = {id: x.id, title: String(x.title || turns[0].q).replace(/\s+/g, ' ').slice(0, 80), source: x.source || old.source || 'page', created: old.created || x.created || new Date().toISOString(), updated: new Date().toISOString(), goal: String(x.goal || '').slice(0, 400), turns};
  let body = JSON.stringify(s2);
  if(body.length > 4e6){ s2.turns = turns.map(t=>Object.assign({}, t, {traces: []})); body = JSON.stringify(s2); }
  fs.mkdirSync(SESSIONS, {recursive: true, mode: 0o700});
  fs.writeFileSync(path.join(SESSIONS, x.id + '.json'), body, {mode: 0o600});
  // keep the newest 100
  listSessions().slice(100).forEach(o=>{ try{ fs.unlinkSync(path.join(SESSIONS, o.id + '.json')); }catch(e){} });
  return s2.id;
}
/* search every chat (questions and answers): all the words must appear; newest first, with the matching part */
export function searchSessions(q, limit){
  const words = String(q || '').toLowerCase().split(/\s+/).filter(w=>w.length > 1).slice(0, 8);
  if(!words.length) return [];
  const out = [];
  for(const x of listSessions()){
    const full = loadSession(x.id); if(!full) continue;
    (full.turns || []).forEach((t, i)=>{
      const a = String((t.answer || {}).text || ''), hay = (t.q + '\n' + a).toLowerCase();
      if(!words.every(w=>hay.includes(w))) return;
      const at = Math.max(0, a.toLowerCase().indexOf(words[0]) - 80);
      out.push({id: full.id, title: full.title, updated: full.updated, turn: i, q: t.q, snippet: (at ? '…' : '') + a.slice(at, at + 260).replace(/\s+/g, ' ')});
    });
    if(out.length >= (limit || 20)) break;
  }
  return out.slice(0, limit || 20);
}
export function deleteSession(id){ if(!okId(id)) return false; try{ fs.unlinkSync(path.join(SESSIONS, id + '.json')); return true; }catch(e){ return false; } }
const ago = iso => { const m = Math.round((Date.now() - new Date(iso)) / 60000); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' d ago'; };
function printSessions(list){
  if(!list.length) return console.log(dim('  No chats yet.'));
  list.slice(0, 15).forEach((x, i)=>console.log('  ' + cyan(String(i + 1).padStart(2)) + '  ' + x.title.slice(0, 70) + dim('  · ' + x.turns + ' question' + (x.turns === 1 ? '' : 's') + ' · ' + ago(x.updated) + ' · ' + x.source)));
}
// bring a chat back into a conversation: its thread (last 3 exchanges), its goal, and a look at where it left off
function resumeInto(o, x){
  o.session = {id: x.id, title: x.title, source: 'terminal', goal: x.goal || '', turns: x.turns.slice()};
  o.goal = x.goal || '';
  o.history = x.turns.slice(-3).flatMap(t=>[{role: 'user', content: t.q}, {role: 'assistant', content: String((t.answer || {}).text || '').slice(0, 1500)}]);
  console.log(bold('\nResumed: ') + x.title + dim('  (' + x.turns.length + ' question' + (x.turns.length === 1 ? '' : 's') + (o.goal ? ' · 🎯 ' + o.goal : '') + ')'));
  x.turns.slice(-2).forEach(t=>{ console.log(cyan('› ') + t.q); console.log(dim('  ' + String((t.answer || {}).text || '').replace(/\s+/g, ' ').slice(0, 220) + (String((t.answer || {}).text || '').length > 220 ? '…' : ''))); });
  console.log('');
}
async function pickSession(arg, inConversation){
  const list = listSessions();
  if(!list.length){ console.log(dim('No chats to resume yet.')); return null; }
  if(arg && /^\d+$/.test(arg)) return list[+arg - 1] ? loadSession(list[+arg - 1].id) : null;
  if(arg) return loadSession(arg);
  if(inConversation){ console.log(bold('\nYour chats')); printSessions(list); console.log(dim('\n  /resume <number> to continue one')); return null; }
  if(!process.stdin.isTTY) return loadSession(list[0].id);
  console.log(bold('\nYour chats') + dim('  (newest first)'));
  printSessions(list);
  const a = await ask('\nResume which? ' + dim('[1] '));
  const n = /^\d+$/.test(a) ? +a : 1;
  return list[n - 1] ? loadSession(list[n - 1].id) : null;
}

/* ---------------------------------------------------------------- SCHEDULED TASKS: a question asked for you at a time
   ~/.money-ai/tasks.json. The helper (always running) checks every minute; each result is added to the task's own
   chat (⏰ in the list) and macOS shows a notification. A time missed while the Mac slept runs when it wakes. */
const TASKS = path.join(HOME, 'tasks.json');
const DAYSETS = {daily: [0, 1, 2, 3, 4, 5, 6], weekdays: [1, 2, 3, 4, 5], weekends: [0, 6]};
export function listTasks(){ return (readJson(TASKS, {list: []}).list || []); }
function writeTasks(list){ writeJson(TASKS, {list}); return list; }
export function saveTask(t){
  const list = listTasks();
  const days = Array.isArray(t.days) ? t.days.map(Number).filter(d=>d >= 0 && d <= 6) : DAYSETS[t.days] || DAYSETS.daily;
  const clean = {id: okId(t.id) ? t.id : newId(), prompt: String(t.prompt || '').trim().slice(0, 1000), time: /^([01]\d|2[0-3]):[0-5]\d$/.test(t.time) ? t.time : '09:00', days: days.length ? days : DAYSETS.daily, on: t.on !== false, cloud: !!t.cloud};
  if(clean.prompt.length < 4) return null;
  const old = list.find(x=>x.id === clean.id);
  if(old) Object.assign(old, clean); else list.push(Object.assign(clean, {last: '', sessionId: newId()}));
  writeTasks(list);
  return clean.id;
}
export function deleteTask(id){ writeTasks(listTasks().filter(t=>t.id !== id)); return true; }
let taskRunning = false;
export async function runTask(id){
  const list = listTasks(), t = list.find(x=>x.id === id);
  if(!t || taskRunning) return null;
  taskRunning = true;
  try{
    const sess = loadSession(t.sessionId) || {id: t.sessionId, source: 'task', turns: []};
    const out = await answer(t.prompt, {history: [], files: [], cloud: t.cloud});
    sess.turns.push({q: t.prompt + '  (⏰ ' + new Date().toLocaleString('en-IN', {dateStyle: 'medium', timeStyle: 'short'}) + ')', answer: {text: out.text, sources: out.sources || [], by: out.by || '', model: out.model || '', chart: out.chart || null}});
    saveSession({id: sess.id, title: '⏰ ' + t.prompt, source: 'task', turns: sess.turns});
    t.last = new Date().toISOString().slice(0, 10); t.lastAt = new Date().toISOString();
    writeTasks(list);
    // a notification on this Mac (the first line of the answer)
    if(process.platform === 'darwin'){ try{ const msg = String(out.text).replace(/[#*`>\[\]]/g, '').replace(/\s+/g, ' ').slice(0, 180).replace(/["\\]/g, ''); (await import('child_process')).execFile('osascript', ['-e', 'display notification "' + msg + '" with title "AI — ' + t.prompt.slice(0, 40).replace(/["\\]/g, '') + '"']); }catch(e){} }
    return out;
  }finally{ taskRunning = false; }
}
// every minute: what is due today and not yet run
export async function tick(){
  const now = new Date(), hm = now.toTimeString().slice(0, 5), today = now.toISOString().slice(0, 10);
  for(const t of listTasks()) if(t.on !== false && t.days.includes(now.getDay()) && hm >= t.time && t.last !== today){ await runTask(t.id).catch(()=>{}); break; }
}
const dayText = d => JSON.stringify(d) === JSON.stringify(DAYSETS.daily) ? 'every day' : JSON.stringify(d) === JSON.stringify(DAYSETS.weekdays) ? 'weekdays' : JSON.stringify(d) === JSON.stringify(DAYSETS.weekends) ? 'weekends' : d.map(x=>['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][x]).join(', ');
function printTasks(){
  const list = listTasks();
  if(!list.length) return console.log(dim('  No scheduled tasks. Add one:  ai task add 09:00 "Nifty summary with chart"   (weekdays: ai task add weekdays 09:00 "…")'));
  list.forEach((t, i)=>console.log('  ' + cyan(String(i + 1)) + ' ' + (t.on !== false ? green('on ') : yellow('off')) + ' ' + t.time + ' ' + dim(dayText(t.days).padEnd(10)) + ' ' + t.prompt.slice(0, 70) + dim(t.last ? '  · last ' + t.last : '')));
}

/* ---------------------------------------------------------------- help: the guide and your settings as they are now */
const TOOLS_ON_OFF = ['web', 'read', 'calc', 'market', 'code', 'connectors'];
async function helpState(o){
  const cfg = config(); engine(cfg);
  let models = [];
  try{ models = ((await (await _fetch(String(cfg.ai.keys.ollama || 'http://localhost:11434').replace(/\/+$/, '') + '/api/tags')).json()).models || []).map(m=>m.name); }catch(e){}
  const B = global.MoneyBrain, L = B.lessons({app: 'ai'}).filter(x=>!x.off), cs = getConnectors();
  return {searxng: await Local.searxngUp(), model: await localModel(), coder: models.find(m=>/coder/i.test(m)) || '', cloud: !!cfg.ai.cloud, cloudNames: cloudNames(),
    off: Array.from(new Set((cfg.ai.off || []).concat((o && o.disabled) || []))), connectors: cs.length, connectorsOn: cs.filter(c=>c.on !== false).length,
    rules: userRules().length, rulesFile: RULES_FILE.replace(os.homedir(), '~'), lessons: L.filter(x=>x.topic === 'case').length, saved: L.filter(x=>x.topic === 'good').length,
    profile: L.filter(x=>x.topic === 'profile').length, selfexam: readJson(path.join(HOME, 'selfexam.json'), null), goal: o && o.goal};
}
const showHelp = async o => console.log(Help.terminal(await helpState(o), {bold, dim, cyan, green, yellow}));
function setTool(name, on){
  if(!TOOLS_ON_OFF.includes(name)) return console.log(yellow('Tools: ' + TOOLS_ON_OFF.join(', ')));
  const c = readJson(CONFIG, {search: {}, ai: {keys: {}}}); c.ai = c.ai || {keys: {}};
  c.ai.off = Array.from(new Set((c.ai.off || []).filter(t=>t !== name).concat(on ? [] : [name])));
  writeJson(CONFIG, c);
  console.log((on ? green('On: ') : yellow('Off: ')) + name + dim(c.ai.off.length ? '   (off now: ' + c.ai.off.join(', ') + ')' : '   (everything is on)'));
}
function listConnectors(){
  getConnectors().forEach(c=>console.log('  ' + (c.on !== false ? green('on ') : yellow('off')) + ' ' + bold(c.name) + dim(' — ' + c.description)));
  console.log(dim('  Add or switch them on the page (ai ui → Connectors), or edit ~/.money-ai/connectors.json'));
}
function setCloud(v){
  const c = readJson(CONFIG, {search: {}, ai: {keys: {}}}); c.ai = c.ai || {keys: {}};
  if(/^(on|off)$/.test(v || '')){ c.ai.cloud = v === 'on'; writeJson(CONFIG, c); }
  const names = cloudNames();
  console.log(bold('Cloud AI for hard questions: ') + (c.ai.cloud ? green('on') : 'off') + dim('  (ai cloud on | off · one question: ai --cloud "…")'));
  console.log('Cloud AIs with keys: ' + (names.length ? names.join(', ') : yellow('none — use "Copy my AI keys to this Mac" on the AI page, or ai setup')));
}

/* ---------------------------------------------------------------- the command */
async function main(){
  const args = process.argv.slice(2);
  const o = {files: [], history: []};
  const rest = [];
  for(let i = 0; i < args.length; i++){
    const a = args[i];
    if(a === '-f' || a === '--file') o.files.push(args[++i]);
    else if(a === '--json') o.json = true;
    else if(a === '--no-web') o.noWeb = true;
    else if(a === '--no-ai') o.noAi = true;
    else if(a === '--deep') o.deep = true;
    else if(a === '--classic') o.classic = true;
    else if(a === '--cloud') o.cloud = true;
    else if(a === '--fresh') o.fresh = true;
    else if(a === '--model') o.model = args[++i];
    else if(a === '--resume' || a === '-r'){ o.resume = true; if(args[i + 1] && !/^-/.test(args[i + 1]) && (/^\d{1,3}$/.test(args[i + 1]) || okId(args[i + 1]) && /^\d{14}-/.test(args[i + 1]))) o.resumeArg = args[++i]; }
    else if(a === '-h' || a === '--help'){ await showHelp(o); return; }
    else rest.push(a);
  }
  if(rest[0] === 'setup') return setup();
  if(rest[0] === 'status') return status();
  if(rest[0] === 'rules' && rest.length === 1) return rules();
  if(rest[0] === 'models'){
    const c = config();
    let ms = []; try{ ms = ((await (await _fetch(String(c.ai.keys.ollama || 'http://localhost:11434').replace(/\/+$/, '') + '/api/tags')).json()).models || []).map(m=>m.name); }catch(e){}
    if(rest[1] === 'set' && KINDS.includes(rest[2]) && rest[3]){ if(!ms.includes(rest[3])) return console.log(yellow(rest[3] + ' is not on this Mac')); setRoutes({[rest[2]]: rest[3]}); }
    if(rest[1] === 'auto'){ const cc = readJson(CONFIG, {}); if(cc.ai){ delete cc.ai.routes; writeJson(CONFIG, cc); } }
    const r = routesFor(config(), ms);
    console.log(bold('\nWhich model answers what') + dim('  (ai models set <kind> <model> · ai models auto)'));
    console.log('  ' + 'general'.padEnd(10) + green(r.general || '—') + dim('   questions, research, writing'));
    console.log('  ' + 'code'.padEnd(10) + green(r.code || '—') + dim('   programs, functions, fixing code'));
    console.log('  ' + 'analysis'.padEnd(10) + green(r.analysis || '—') + dim('   tables, sums, money, markets'));
    console.log('  ' + 'vision'.padEnd(10) + green(r.vision || '—') + dim('   reading pictures'));
    if(c.ai.model) console.log(yellow('\n  Overridden: ' + c.ai.model + ' answers everything (ai model auto to use the kinds above)'));
    console.log(dim('\n  On this Mac: ' + ms.join(', ')) + '\n');
    return;
  }
  if(rest[0] === 'model' && rest.length <= 2){
    const c = readJson(CONFIG, {search: {}, ai: {keys: {}}}); c.ai = c.ai || {keys: {}};
    if(rest[1]){ if(rest[1] === 'auto') delete c.ai.model; else c.ai.model = rest[1]; writeJson(CONFIG, c); }
    let ms = []; try{ ms = ((await (await _fetch(String(c.ai.keys.ollama || 'http://localhost:11434').replace(/\/+$/, '') + '/api/tags')).json()).models || []).map(m=>m.name + dim(' ' + (m.size / 1e9).toFixed(1) + ' GB')); }catch(e){}
    console.log(bold('Model: ') + (c.ai.model ? green(c.ai.model) + dim('  (ai model auto: let it choose)') : 'auto' + dim(' — the best general model here, the coding model for code')));
    console.log(dim('On this Mac: ') + ms.join(dim(' · ')));
    return;
  }
  if(rest[0] === 'cloud' && rest[1] === 'test'){
    // one short question to each cloud AI with a key: which answer, which do not (and why)
    const cfg = config(), {AI} = engine(cfg);
    for(const id of cloudNames()){
      const t0 = Date.now();
      try{ const r = await AI.chat('Reply with the single word OK.', [{role: 'user', content: 'Say OK.'}], {only: [id], maxTokens: 20}); console.log(green('  ✓ ') + id.padEnd(11) + r.model + dim('  ' + (Date.now() - t0) + ' ms')); }
      catch(e){ console.log(red('  ✗ ') + id.padEnd(11) + String(e.message).slice(0, 120)); }
    }
    return;
  }
  if(rest[0] === 'cloud' && rest.length <= 2) return setCloud(rest[1]);
  if((rest[0] === 'off' || rest[0] === 'on') && rest.length === 2) return setTool(rest[1], rest[0] === 'on');
  if(rest[0] === 'connectors' && rest.length === 1) return listConnectors();
  if(rest[0] === 'tasks' && rest.length === 1){ console.log(bold('\nScheduled tasks') + dim('  (run by the helper; results in their own chat, ⏰)')); printTasks(); return; }
  if(rest[0] === 'task'){
    const list = listTasks(), [, verb, ...more] = rest;
    if(verb === 'add'){ let days = 'daily'; if(DAYSETS[more[0]]) days = more.shift(); const time = more.shift(), prompt = more.join(' ');
      const id = saveTask({time, days, prompt}); console.log(id ? green('Scheduled: ') + (time || '09:00') + ' ' + days + ' — ' + prompt : yellow('ai task add [daily|weekdays|weekends] HH:MM "what to ask"')); return; }
    const t = list[+more[0] - 1];
    if(!t) return console.log(yellow('ai task add | run <n> | on <n> | off <n> | rm <n>   (numbers from ai tasks)'));
    if(verb === 'rm'){ deleteTask(t.id); console.log(dim('Removed: ') + t.prompt); return; }
    if(verb === 'on' || verb === 'off'){ saveTask(Object.assign({}, t, {on: verb === 'on'})); console.log((verb === 'on' ? green('On: ') : yellow('Off: ')) + t.prompt); return; }
    if(verb === 'run'){ console.log(dim('Running: ') + t.prompt); const out = await runTask(t.id); if(out) show(Object.assign(out, {q: t.prompt}), o); return; }
    return console.log(yellow('ai task add | run <n> | on <n> | off <n> | rm <n>'));
  }
  if((rest[0] === 'sessions' || rest[0] === 'chats') && rest.length === 1){ console.log(bold('\nYour chats') + dim('  (ai --resume <number> to continue one)')); printSessions(listSessions()); return; }
  if(rest[0] === 'help' && rest.length === 1) return showHelp(o);
  if(rest[0] === 'teach' && rest.length > 1) return teach(rest.slice(1).join(' '));
  if(rest[0] === 'forget' && /^\d+$/.test(rest[1] || '') && rest.length === 2) return forgetLesson(rest[1]);
  if(rest[0] === 'ui'){ const url = 'http://127.0.0.1:8899/'; let up = false; try{ up = (await fetch(url + 'health')).ok; }catch(e){}
    if(!up){ (await import('./serve.mjs')).serve(); }
    (await import('child_process')).execFile('open', [url]); console.log('Your AI is open at ' + url + (up ? '' : dim('  (running here; Ctrl+C stops it)'))); return; }
  if(rest[0] === 'serve'){ (await import('./serve.mjs')).serve(); return; }      // the local helper for the website (normally started at login)
  if(rest.length){
    try{ const q = rest.join(' '); const out = Object.assign(await answer(q, o), {q}); show(out, o);
      if(out.trust && !out.saved && !o.json){ if(tty) process.stderr.write(dim('  checking the claims…') + '\r'); const v = await verifyClaims(out, q, o).catch(()=>null); if(tty) process.stderr.write('\r\x1b[K'); if(v) console.log(trustLine(v) + '\n'); } }catch(e){ console.error(red('✗ ' + e.message)); process.exitCode = 1; }
    return;
  }
  // a conversation (a new one, or a chat resumed with --resume)
  if(o.resume){ const x = await pickSession(o.resumeArg); if(x) resumeInto(o, x); else if(o.resumeArg) console.log(yellow('No such chat — ai sessions lists them.')); }
  if(!o.session) o.session = {id: newId(), source: 'terminal', turns: []};
  const keep = (q, out) => { o.session.turns.push({q, answer: {text: out.text, sources: out.sources || [], by: out.by || '', model: out.model || '', chart: out.chart || null}}); o.session.goal = o.goal || ''; saveSession(o.session); };
  console.log(bold('AI') + dim(' — ask anything; it works out, looks up and reads the web. /help for every command and setting, /exit to leave'));
  let lastOut = null, lastFollow = [];
  const rl = readline.createInterface({input: process.stdin, output: process.stdout, prompt: cyan('› ')});
  let closed = false; rl.on('close', ()=>{ closed = true; });
  const prompt = () => { if(!closed) try{ rl.prompt(); }catch(e){} };      // input may end while an answer is still coming
  prompt();
  for await (const line of rl){
    let q = line.trim();
    if(!q){ prompt(); continue; }
    if(q === '/exit' || q === '/quit') break;
    if(/^[1-3]$/.test(q) && lastFollow[+q - 1]){ const f = lastFollow[+q - 1]; console.log(cyan('› ') + f); q = f; }
    // commands: the same as on the page (/help lists them with your settings)
    const cm = /^\/(\w+)\s*([\s\S]*)$/.exec(q);
    if(cm){
      const [, c, arg] = cm, a = arg.trim();
      try{
        if(c === 'help') await showHelp(o);
        else if(c === 'wrong'){ if(a) await teach(a); else console.log(yellow('  /wrong <what is right>')); }
        else if(c === 'good'){ if(lastOut){ const r = feedback({question: lastOut.q, good: true, answer: lastOut}); console.log(r.saved ? green('  Kept — this question gets this answer next time') : dim('  Thanks — answers about now are not kept (they change)')); } else console.log(yellow('  Ask something first')); }
        else if(c === 'goal'){ o.goal = a.slice(0, 400); console.log(o.goal ? green('  🎯 Goal: ') + o.goal : dim('  Goal cleared')); }
        else if(c === 'rule'){ console.log(addRule(a) ? green('  Rule added — every answer follows it') : yellow('  /rule <a rule of at least a few words>')); }
        else if(c === 'remember'){ console.log(remember(a) ? green('  Remembered') : yellow('  /remember <something about you>')); }
        else if(c === 'fresh'){ if(a){ const out = Object.assign(await answer(a, Object.assign({}, o, {fresh: true})), {q: a}); show(out, o); lastOut = out; keep(a, out); } }
        else if(c === 'cloud') setCloud(a);
        else if(c === 'off' || c === 'on') setTool(a, c === 'on');
        else if(c === 'connectors') listConnectors();
        else if(c === 'learned' || c === 'rules') await rules();
        else if(c === 'status') await status();
        else if(c === 'new' || c === 'clear'){ o.history = []; o.files = []; o.goal = ''; o.session = {id: newId(), source: 'terminal', turns: []}; console.log(dim('  Started a new chat (the last one is kept: /resume or ai --resume).')); }
        else if(c === 'resume' || c === 'chats'){ const x = await pickSession(a, true); if(x) resumeInto(o, x); }
        else if(c === 'file'){ if(a){ o.files.push(a); console.log(dim('  Added ' + a)); } else console.log(yellow('  /file <path>')); }
        else console.log(yellow('  No such command — /help lists them'));
      }catch(e){ console.error(red('✗ ' + e.message)); }
      prompt(); continue;
    }
    try{
      const out = Object.assign(await answer(q, o), {q});
      lastOut = out;
      keep(q, out);
      if(out.trust && !out.saved){ const v = await verifyClaims(out, q, o).catch(()=>null); if(v) console.log(trustLine(v) + '\n'); }
      if(tty){ lastFollow = await followUps(q, out.text, {by: out.by}).catch(()=>[]); if(lastFollow.length) console.log(dim('  Next: ') + lastFollow.map((f, i)=>cyan(String(i + 1)) + ' ' + f).join(dim('  ·  ')) + '\n'); }
      show(out, o);
      o.history = o.history.concat([{role: 'user', content: q}, {role: 'assistant', content: String(out.text).slice(0, 1500)}]).slice(-6);
    }catch(e){ console.error(red('✗ ' + e.message)); }
    prompt();
  }
  rl.close();
}
const started = (()=>{ try{ return fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); }catch(e){ return false; } })();
if(started) main();
