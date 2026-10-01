#!/usr/bin/env node
/* =========================================================
   LOCAL HELPER — the relay's job done on this Mac, for the website: the apps' Ask asks here first
   (your SearXNG to search, pages read here), and the Cloudflare relay (with keys) only when this is not
   reachable — on a phone, or when this Mac is off. No keys; it answers only your site, only from this Mac.
     GET /health   GET /search?q=…&n=8   GET /read?url=…&links=1      (the same as the Cloudflare relay)
   Started at login by ~/Library/LaunchAgents/com.moneyai.local.plist (ai serve runs it by hand).
   ========================================================= */
import http from 'http';
import * as Local from './local.mjs';

const PORT = +process.env.MONEY_AI_PORT || 8899;
const ALLOWED = [/^https:\/\/anilgupta2606\.github\.io$/, /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/];
const headers = origin => Object.assign({'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'},
  origin && ALLOWED.some(r=>r.test(origin)) ? {'access-control-allow-origin': origin, 'access-control-allow-methods': 'GET, OPTIONS', 'access-control-allow-headers': 'x-relay-token, content-type',
    'access-control-allow-private-network': 'true', 'access-control-max-age': '600', vary: 'Origin'} : {});

export function serve(port){
  const server = http.createServer(async (req, res)=>{
    const origin = req.headers.origin || '';
    const send = (status, data) => { res.writeHead(status, headers(origin)); res.end(JSON.stringify(data)); };
    if(req.method === 'OPTIONS'){ res.writeHead(204, headers(origin)); return res.end(); }
    // only your site (or this Mac itself) may use it
    if(origin && !ALLOWED.some(r=>r.test(origin))) return send(403, {error: 'Not allowed.'});
    const u = new URL(req.url, 'http://local');
    try{
      if(u.pathname === '/health') return send(200, {ok: true, local: true, search: {searxng: await Local.searxngUp()}, reader: 'this Mac'});
      if(u.pathname === '/search'){
        const q = String(u.searchParams.get('q') || '').slice(0, 400).trim();
        if(!q) return send(400, {error: 'No question.'});
        return send(200, await Local.search(q, Math.min(10, +u.searchParams.get('n') || 8)));
      }
      if(u.pathname === '/read'){
        const url = u.searchParams.get('url') || '';
        if(!/^https?:\/\//.test(url)) return send(400, {error: 'Give a full web address.'});
        return send(200, await Local.read(url, u.searchParams.get('links') === '1'));
      }
      return send(404, {error: 'Use /search, /read or /health.'});
    }catch(e){ return send(502, {error: String(e.message || e)}); }
  });
  server.listen(port || PORT, '127.0.0.1', ()=>console.log('Money AI local helper on http://127.0.0.1:' + (port || PORT)));
  return server;
}
if(process.argv[1] && process.argv[1].endsWith('serve.mjs')) serve();
