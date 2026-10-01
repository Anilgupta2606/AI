/* =========================================================
   MONEY RELAY — the one small server of the Money Home apps (a Cloudflare Worker, free plan).
   The browser cannot call search engines or read other websites directly (their keys must stay secret, and most
   sites do not allow a web page to read them), so this does it for the apps, and only for them:
     GET /search?q=…&n=8        web results: Tavily (keys rotated; with the pages' text) -> SerpApi (Google) -> Google
                                Programmable Search — whichever answers first, so one running out is not a problem
     GET /read?url=…&links=1    a page as clean text (Jina Reader; else a plain fetch), with the links inside it
     GET /health                which services are set up (no secrets shown)
   Every call needs the header X-Relay-Token (your own secret). Keys live as Worker secrets, never in the apps or GitHub:
     RELAY_TOKEN, TAVILY_KEYS (comma-separated), SERPAPI_KEY, GOOGLE_API_KEY, GOOGLE_CX, JINA_KEY (optional)
   Results are cached for an hour to save the free quotas.
   ========================================================= */
const ALLOWED = [/^https:\/\/anilgupta2606\.github\.io$/, /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/];
const json = (data, status, origin) => new Response(JSON.stringify(data), {status: status || 200, headers: Object.assign({'content-type': 'application/json; charset=utf-8'}, cors(origin))});
const cors = origin => origin && ALLOWED.some(r=>r.test(origin)) ? {'access-control-allow-origin': origin, 'access-control-allow-headers': 'x-relay-token, content-type', 'access-control-allow-methods': 'GET, OPTIONS', 'access-control-max-age': '86400', vary: 'Origin'} : {};
const keys = env => String(env.TAVILY_KEYS || '').split(',').map(s=>s.trim()).filter(Boolean);
const clip = (s, n) => String(s || '').slice(0, n);

/* ---------------------------------------------------------------- search, by provider */
async function tavily(env, q, n){
  const list = keys(env);
  if(!list.length) return null;
  // start with a different key each time (spreads the free allowances), move on when one is out
  const start = Math.floor(Date.now() / 60000) % list.length;
  for(let i = 0; i < list.length; i++){
    const key = list[(start + i) % list.length];
    const r = await fetch('https://api.tavily.com/search', {method: 'POST', headers: {'content-type': 'application/json', authorization: 'Bearer ' + key},
      body: JSON.stringify({query: q, max_results: n, search_depth: 'basic', include_answer: false, include_raw_content: 'text'})});
    if(r.status === 401 || r.status === 429 || r.status === 432 || r.status === 433) continue;           // this key is out (or wrong): the next one
    if(!r.ok) continue;
    const d = await r.json();
    return {provider: 'Tavily', results: (d.results || []).map(x=>({title: x.title, url: x.url, snippet: clip(x.content, 600), content: clip(x.raw_content, 20000)}))};
  }
  return null;
}
async function serpapi(env, q, n){
  if(!env.SERPAPI_KEY) return null;
  const r = await fetch('https://serpapi.com/search.json?engine=google&hl=en&gl=in&num=' + n + '&q=' + encodeURIComponent(q) + '&api_key=' + env.SERPAPI_KEY);
  if(!r.ok) return null;
  const d = await r.json();
  if(d.error) return null;
  const extra = [];
  if(d.answer_box) extra.push({title: 'Google answer: ' + (d.answer_box.title || q), url: d.answer_box.link || '', snippet: clip(d.answer_box.answer || d.answer_box.snippet || (d.answer_box.list || []).join('; '), 800)});
  if(d.knowledge_graph && d.knowledge_graph.description) extra.push({title: 'Google knowledge panel: ' + (d.knowledge_graph.title || ''), url: (d.knowledge_graph.source || {}).link || '', snippet: clip(d.knowledge_graph.description, 800)});
  return {provider: 'SerpApi (Google)', results: extra.concat((d.organic_results || []).slice(0, n).map(x=>({title: x.title, url: x.link, snippet: clip(x.snippet, 600)})))};
}
async function google(env, q, n){
  if(!env.GOOGLE_API_KEY || !env.GOOGLE_CX) return null;
  const r = await fetch('https://www.googleapis.com/customsearch/v1?num=' + Math.min(10, n) + '&key=' + env.GOOGLE_API_KEY + '&cx=' + env.GOOGLE_CX + '&q=' + encodeURIComponent(q));
  if(!r.ok) return null;
  const d = await r.json();
  return {provider: 'Google Programmable Search', results: (d.items || []).map(x=>({title: x.title, url: x.link, snippet: clip(x.snippet, 600)}))};
}
const PROVIDERS = {tavily, serpapi, google};

/* Search with whichever service answers first (Tavily keys in turn, then SerpApi, then Google). Also used by the
   command-line tool (cli.mjs), which passes its own keys as `env`. -> {provider, results} */
export async function search(env, q, n, want){
  const order = want && PROVIDERS[want] ? [want] : ['tavily', 'serpapi', 'google'];
  const tried = [];
  for(const p of order){ let out = null; try{ out = await PROVIDERS[p](env, q, n || 8); }catch(e){} if(out && out.results.length) return out; tried.push(p); }
  const e = new Error('No search service answered (' + tried.join(', ') + ' tried). Check the keys, or a free allowance may be used up for now.');
  e.status = 503; throw e;
}

/* ---------------------------------------------------------------- reading a page */
export async function read(env, url, withLinks){
  // Jina Reader, two ways (the article alone; the whole page's text): the first that gives real text wins
  const tidy = t => String(t || '').replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/^#+\s*/gm, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  const words = t => (String(t).match(/[A-Za-z]{3,}/g) || []).length;
  for(const mode of ['markdown', 'text']){
    try{
      const h = {accept: 'application/json', 'x-return-format': mode};
      if(env.JINA_KEY) h.authorization = 'Bearer ' + env.JINA_KEY;
      if(withLinks) h['x-with-links-summary'] = 'true';
      const r = await fetch('https://r.jina.ai/' + url, {headers: h});
      if(!r.ok) continue;
      const d = (await r.json()).data || {};
      const body = tidy(d.content || d.text);
      if(words(body) < 120 || /^https?:/.test(d.title || '')) continue;          // a tracker, a cookie wall or a menu: not the page
      const links = Object.entries(d.links || {}).slice(0, 60).map(([text, href])=>({text: clip(text, 80), url: href}));
      return {via: 'Jina Reader', title: d.title || '', url: d.url || url, published: d.publishedTime || '', content: clip(body, 30000), links};
    }catch(e){}
  }
  // else: the page itself, tags removed
  const r = await fetch(url, {headers: {'user-agent': 'Mozilla/5.0 (compatible; MoneyHomeRelay/1.0)', accept: 'text/html'}, redirect: 'follow'});
  if(!r.ok) throw new Error('The page answered ' + r.status);
  const html = await r.text();
  const title = (/<title[^>]*>([^<]*)/i.exec(html) || [])[1] || '';
  const links = [];
  if(withLinks){ const re = /<a\s[^>]*href="(https?:[^"#]+)"[^>]*>([\s\S]*?)<\/a>/gi; let m; while((m = re.exec(html)) && links.length < 60){ const t = m[2].replace(/<[^>]+>/g, '').trim(); if(t) links.push({text: clip(t, 80), url: m[1]}); } }
  const text = html.replace(/<(script|style|nav|header|footer|noscript|svg)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
  return {via: 'direct', title: title.trim(), url, content: clip(text, 30000), links};
}

/* ---------------------------------------------------------------- the worker */
export default {
  async fetch(req, env, ctx){
    const origin = req.headers.get('origin') || '';
    if(req.method === 'OPTIONS') return new Response(null, {status: 204, headers: cors(origin)});
    const u = new URL(req.url);
    if(u.pathname === '/health') return json({ok: true, search: {tavily: keys(env).length, serpapi: !!env.SERPAPI_KEY, google: !!(env.GOOGLE_API_KEY && env.GOOGLE_CX)}, reader: env.JINA_KEY ? 'Jina (with key)' : 'Jina (free)', token: !!env.RELAY_TOKEN}, 200, origin);
    if(!env.RELAY_TOKEN || req.headers.get('x-relay-token') !== env.RELAY_TOKEN) return json({error: 'Not allowed (the relay token is missing or wrong).'}, 401, origin);
    // an hour's cache: the same question or page does not spend the free quota twice
    const cache = caches.default, key = new Request(u.toString(), {method: 'GET'});
    const hit = await cache.match(key);
    if(hit){ const res = new Response(hit.body, hit); ['access-control-allow-origin', 'access-control-allow-headers', 'access-control-allow-methods', 'access-control-max-age'].forEach(h=>res.headers.delete(h)); Object.entries(cors(origin)).forEach(([k, v])=>res.headers.set(k, v)); res.headers.set('x-cache', 'hit'); return res; }
    let out;
    try{
      if(u.pathname === '/search'){
        const q = clip(u.searchParams.get('q'), 400).trim(), n = Math.max(1, Math.min(10, +u.searchParams.get('n') || 8));
        if(!q) return json({error: 'No question.'}, 400, origin);
        out = await search(env, q, n, u.searchParams.get('provider'));
      } else if(u.pathname === '/read'){
        const url = u.searchParams.get('url') || '';
        if(!/^https?:\/\//.test(url)) return json({error: 'Give a full web address.'}, 400, origin);
        out = await read(env, url, u.searchParams.get('links') === '1');
      } else return json({error: 'Unknown path. Use /search, /read or /health.'}, 404, origin);
    }catch(e){ return json({error: String(e.message || e)}, e.status || 502, origin); }
    const res = json(out, 200, origin);
    res.headers.set('cache-control', 'public, max-age=3600');
    ctx.waitUntil(cache.put(key, res.clone()));
    return res;
  },
};
