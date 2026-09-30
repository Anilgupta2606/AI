/* The shared AI engine (/ai/ai.js): order, fallback, free-limit rests, strict JSON. Run: node --test test/ */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), vm = require('vm');

function load(){
  const store = {};
  const ctx = {
    window: {addEventListener(){}, dispatchEvent(){}}, document: {addEventListener(){}, querySelectorAll: ()=>[]},
    localStorage: {getItem: k=>k in store ? store[k] : null, setItem: (k, v)=>{ store[k] = String(v); }, removeItem: k=>{ delete store[k]; }},
    location: {origin: 'https://anilgupta2606.github.io', hostname: 'anilgupta2606.github.io'}, navigator: {userAgent: 'node'},
    console, AbortController, Response, setTimeout, clearTimeout, setInterval: ()=>0, JSON, Date, Math, Intl, CustomEvent: class{ constructor(t){ this.type = t; } },
  };
  ctx.window.CustomEvent = ctx.CustomEvent;
  vm.runInNewContext(fs.readFileSync(__dirname + '/../engine/ai.js', 'utf8') + '\nthis.MoneyAI = MoneyAI;', ctx);
  return {AI: ctx.MoneyAI, ctx, store, keys: k=>{ store['money-ai'] = JSON.stringify({keys: k}); }};
}
const json = (obj, status, headers) => new Response(JSON.stringify(obj), {status: status || 200, headers: headers || {}});
const oai = text => json({choices: [{message: {content: text}}]});
const gem = text => json({candidates: [{content: {parts: [{text}]}}]});
const rests = store => { const r = JSON.parse(store['money-ai-rest'] || '{}'), o = {}; Object.entries(r).forEach(([k, v])=>{ o[k] = Math.round((v.until - Date.now()) / 60000); }); return o; };

test('Groq out of its daily tokens: every model rests for the time Groq says, then Groq itself', async ()=>{
  const {AI, ctx, store, keys} = load();
  keys({groq: 'q'});
  ctx.fetch = async (url, init) => {
    if(!init) return json({data: [{id: 'llama-3.3-70b-versatile'}, {id: 'openai/gpt-oss-20b'}]});
    return json({error: {message: 'Rate limit reached on tokens per day (TPD). Please try again in 7m12.5s.'}}, 429);
  };
  await assert.rejects(AI.chat('s', [{role: 'user', content: 'hi'}], {}), /daily limit/);
  const r = rests(store);
  assert.ok(r.groq >= 6 && r.groq <= 8, JSON.stringify(r));
  assert.ok(Object.keys(r).filter(k=>k.startsWith('groq|')).length >= 2, 'each model rests');
  assert.ok(AI.resting('groq'), 'the switch shows Groq amber straight away');
});

test('Gemini daily quota: rests until midnight Pacific, not for its "retry in 20s"', async ()=>{
  const {AI, ctx, store, keys} = load();
  keys({gemini: 'g'});
  ctx.fetch = async (url, init) => {
    if(!init) return json({models: [{name: 'models/gemini-2.5-flash'}]});
    return json({error: {code: 429, message: 'quota', details: [{violations: [{quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier'}]}, {retryDelay: '20s'}]}}, 429);
  };
  await assert.rejects(AI.chat('s', [{role: 'user', content: 'hi'}], {}));
  const r = rests(store);
  assert.ok(r.gemini > 1 && r.gemini <= 24 * 60 + 1, JSON.stringify(r));
});

test('a limit on one model: the next model of the same service answers, the service stays green', async ()=>{
  const {AI, ctx, store, keys} = load();
  keys({groq: 'q'});
  ctx.fetch = async (url, init) => {
    if(!init) return json({data: [{id: 'openai/gpt-oss-120b'}, {id: 'llama-3.3-70b-versatile'}]});
    const model = JSON.parse(init.body).model;
    return model === 'openai/gpt-oss-120b' ? json({error: {message: 'Rate limit reached for requests per minute. Please try again in 40s.'}}, 429) : oai('hello');
  };
  const r = await AI.chat('s', [{role: 'user', content: 'hi'}], {});
  assert.equal(r.text, 'hello');
  assert.equal(r.id, 'groq');
  assert.equal(r.model, 'llama-3.3-70b-versatile');
  assert.ok(!AI.resting('groq'));
  assert.ok(rests(store)['groq|openai/gpt-oss-120b'] <= 1);
});

test('only / skip choose which AIs may answer', async ()=>{
  const {AI, ctx, keys} = load();
  keys({gemini: 'g', groq: 'q'});
  const seen = [];
  ctx.fetch = async (url, init) => { if(!init) return json({}, 500); seen.push(url); return /generativelanguage/.test(url) ? gem('from gemini') : oai('from groq'); };
  assert.equal((await AI.chat('s', [{role: 'user', content: 'x'}], {skip: ['gemini']})).text, 'from groq');
  assert.equal((await AI.chat('s', [{role: 'user', content: 'x'}], {only: ['gemini']})).text, 'from gemini');
  await assert.rejects(AI.chat('s', [{role: 'user', content: 'x'}], {only: ['webllm']}));
});

test('generate: strict JSON - Gemini gets the schema, the others the JSON switch', async ()=>{
  const {AI, ctx, keys} = load();
  const SCHEMA = {type: 'OBJECT', properties: {rows: {type: 'ARRAY', items: {type: 'INTEGER'}}}, required: ['rows']};
  let body = null;
  keys({gemini: 'g'});
  ctx.fetch = async (url, init) => { if(!init) return json({}, 500); body = JSON.parse(init.body); return gem('{"rows":[1,2]}'); };
  const g = await AI.generate('rows please', SCHEMA);
  assert.deepEqual(JSON.parse(JSON.stringify(g.data)), {rows: [1, 2]});
  assert.equal(g.id, 'gemini');
  assert.equal(body.generationConfig.responseMimeType, 'application/json');
  assert.equal(body.generationConfig.temperature, 0);
  keys({groq: 'q'});
  let calls = 0;
  ctx.fetch = async (url, init) => {
    if(!init) return json({}, 500);
    body = JSON.parse(init.body); calls++;
    // a model that refuses the JSON switch: asked again without it
    if(body.response_format) return json({error: {message: 'response_format json_object is not supported by this model'}}, 400);
    return oai('Sure: {"rows":[3]}');
  };
  const q = await AI.generate('rows please', SCHEMA);
  assert.deepEqual(JSON.parse(JSON.stringify(q.data)), {rows: [3]});
  assert.equal(calls, 2);
  assert.match(body.messages[0].content, /"type":"object"/);          // the schema in plain JSON-schema words
});

test('OpenRouter: giant and "ultra" reasoning free models go last', ()=>{
  const {AI} = load();
  const r = AI.rankModels('openrouter', ['nvidia/nemotron-3-ultra-550b-a55b:free', 'meta-llama/llama-3.3-70b-instruct:free', 'openai/gpt-oss-120b:free', 'nousresearch/hermes-3-405b:free', 'google/gemma-3-27b-it:free'], 'smart');
  assert.equal(r[0], 'openai/gpt-oss-120b:free');
  assert.ok(r.indexOf('nvidia/nemotron-3-ultra-550b-a55b:free') > r.indexOf('google/gemma-3-27b-it:free'));
});

test('an answer that never finishes is dropped after the time limit', async ()=>{
  const {AI, ctx, keys} = load();
  keys({groq: 'q'});
  // headers arrive at once, the body never: the limit still applies (OpenRouter does this)
  ctx.fetch = async (url, init) => {
    if(!init) return json({}, 500);
    return {ok: true, status: 200, statusText: 'OK', headers: new Headers(), text: ()=>new Promise((res, rej)=>init.signal.addEventListener('abort', ()=>rej(Object.assign(new Error('aborted'), {name: 'AbortError'}))))};
  };
  ctx.setTimeout = (fn)=>setTimeout(fn, 20);          // the 90 s limit, fast
  await assert.rejects(AI.chat('s', [{role: 'user', content: 'x'}], {}), /in time|could answer/);
});

test('json: almost-right answers are repaired', ()=>{
  const {AI} = load();
  const J = t => JSON.parse(JSON.stringify(AI.json(t)));
  assert.deepEqual(J('{"a": 1, "b": [1, 2,],}'), {a: 1, b: [1, 2]});                          // trailing commas
  assert.deepEqual(J("{'type': 'pan', 'number': 'ABCPG1234K'}"), {type: 'pan', number: 'ABCPG1234K'});   // single quotes
  assert.deepEqual(J('{type: "pan", ok: True, x: None}'), {type: 'pan', ok: true, x: null});     // keys without quotes, Python words
  assert.deepEqual(J('Sure! Here it is:\n```json\n{"items": [{"title": "Lunch"}, {"title": "Din'), {items: [{title: 'Lunch'}, {title: 'Din'}]});   // cut off
  assert.deepEqual(J('{"a": "x", // a comment\n "b": 2}'), {a: 'x', b: 2});
  assert.deepEqual(J('<think>let me see { not this }</think>{"ok": 1}'), {ok: 1});
  assert.deepEqual(J('{“name”: “Anil”}'), {name: 'Anil'});
});
