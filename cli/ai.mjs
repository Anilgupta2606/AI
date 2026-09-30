#!/usr/bin/env node
/* =========================================================
   ai — the Money Home AI on the command line, on its own (like a terminal assistant).
     ai "question"              one answer: sums worked out exactly, facts looked up, anything else searched on the
                                web, read, and answered by an AI with its sources
     ai                         a conversation (follow-up questions keep the thread)
     ai -f notes.txt "question" answer from a file (text, markdown, CSV, JSON, HTML) as well as the web
     ai --no-web / --no-ai      only what it knows / only the web's own sentences (no AI)
     ai --json "question"       the answer as JSON (for scripts)
     ai setup                   keys for the search services and the AIs (kept in ~/.money-ai/, only on this Mac)
     ai status                  what is set up
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

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const HOME = path.join(os.homedir(), '.money-ai');
const CONFIG = path.join(HOME, 'config.json'), STORE = path.join(HOME, 'store.json');
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
  const cfg = config(), {AI, Web} = engine(cfg), S = await searcher(cfg);
  const hasAi = AI.aiAvailable() && !o.noAi;
  const step = t => { if(!o.json && tty) process.stderr.write('\r\x1b[K' + dim('… ' + t)); };
  const done = () => { if(!o.json && tty) process.stderr.write('\r\x1b[K'); };
  const chat = hasAi ? (system, turns, opts) => AI.chat(system, (o.history || []).concat(turns), Object.assign({}, opts, {onProgress: t=>step(t)})) : null;
  // a file: its text is a source too
  let fileSources = [];
  for(const f of o.files || []){
    if(!fs.existsSync(f)) throw new Error('No such file: ' + f);
    if(!FILE_TYPES.test(f)) throw new Error('I read text files (txt, md, csv, json, html…); ' + path.basename(f) + ' is not one.');
    fileSources.push({title: path.basename(f), url: 'file://' + path.resolve(f), content: fs.readFileSync(f, 'utf8').slice(0, 60000)});
  }
  // 1. worked out or looked up exactly (sums, rates, weather, time, meanings, facts) — unless a file is given
  if(!fileSources.length && !o.deep){
    step('Checking what can be worked out or looked up exactly…');
    const quick = await Web.answer(question, {factsOnly: !!S.any}).catch(()=>null);
    if(quick && quick.kind !== 'not-found' && quick.kind !== 'read'){ done(); return Object.assign({by: 'Money Brain · ' + quick.kind + ' (no AI)'}, quick); }
  }
  // 2. the web (and the files): search, read, think
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
const show = (out, o) => {
  if(o.json){ console.log(JSON.stringify(out, null, 2)); return; }
  console.log('\n' + String(out.text || '').replace(/\[(\d+)\]/g, (m)=>cyan(m)) + '\n');
  (out.sources || []).forEach((s, i)=>console.log(dim('  [' + (s.i || i + 1) + '] ' + s.title + (s.url && !/^file:/.test(s.url) ? ' — ' + s.url : ''))));
  if(out.by) console.log(dim('  ' + out.by));
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
  console.log(bold('\nMoney AI — setup') + dim('  (kept in ' + CONFIG + ', readable only by you; Enter keeps what is there, "-" removes it)\n'));
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
  console.log(bold('\nWeb search: ') + ([cfg.search.tavily && cfg.search.tavily.length ? 'Tavily ×' + cfg.search.tavily.length : '', cfg.search.serpapi ? 'SerpApi' : '', cfg.search.googleKey && cfg.search.googleCx ? 'Google' : ''].filter(Boolean).join(', ') || yellow('none — run  ai setup')));
  console.log(bold('Reading pages: ') + 'Jina Reader' + (cfg.search.jina ? ' (with key)' : ' (free)') + ', else directly');
  const st = AI.aiStatus();
  console.log(bold('AI: ') + (st.length ? st.map(x=>x.name + (x.resting ? yellow(' (resting)') : '')).join(' → ') : yellow('none — run  ai setup')) + '\n');
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
    else if(a === '-h' || a === '--help'){ console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(2, 13).join('\n').replace(/^\s*/gm, '')); return; }
    else rest.push(a);
  }
  if(rest[0] === 'setup') return setup();
  if(rest[0] === 'status') return status();
  if(rest.length){
    try{ show(await answer(rest.join(' '), o), o); }catch(e){ console.error(red('✗ ' + e.message)); process.exitCode = 1; }
    return;
  }
  // a conversation
  console.log(bold('Money AI') + dim(' — ask anything; it works out, looks up and reads the web. /help, /exit'));
  const rl = readline.createInterface({input: process.stdin, output: process.stdout, prompt: cyan('› ')});
  rl.prompt();
  for await (const line of rl){
    const q = line.trim();
    if(!q){ rl.prompt(); continue; }
    if(q === '/exit' || q === '/quit') break;
    if(q === '/help'){ console.log(dim('  Ask a question. /file <path> to add a file · /clear to start over · /status · /exit')); rl.prompt(); continue; }
    if(q === '/status'){ await status(); rl.prompt(); continue; }
    if(q === '/clear'){ o.history = []; o.files = []; console.log(dim('  Started over.')); rl.prompt(); continue; }
    if(q.startsWith('/file ')){ o.files.push(q.slice(6).trim()); console.log(dim('  Added ' + q.slice(6).trim())); rl.prompt(); continue; }
    try{
      const out = await answer(q, o);
      show(out, o);
      o.history = o.history.concat([{role: 'user', content: q}, {role: 'assistant', content: String(out.text).slice(0, 1500)}]).slice(-6);
    }catch(e){ console.error(red('✗ ' + e.message)); }
    rl.prompt();
  }
  rl.close();
}
main();
