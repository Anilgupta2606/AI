#!/usr/bin/env node
/* =========================================================
   LOCAL HELPER — the relay's job done on this Mac, for the website: the apps' Ask asks here first
   (your SearXNG to search, pages read here), and the Cloudflare relay (with keys) only when this is not
   reachable — on a phone, or when this Mac is off. No keys; it answers only your site's pages (they send their Origin),
   only on this Mac, and never opens addresses on this Mac or your home network.
     GET /health   GET /search?q=…&n=8   GET /read?url=…&links=1      (the same as the Cloudflare relay)
   and the page for the AI itself (ai ui):
     GET /   the page      POST /ask {question, history} -> its steps, then the answer (one JSON per line)
     GET /learned   POST /teach {question, lesson}   POST /forget {id}   GET|POST /brain (the AI's lessons, swapped with the published page)
   The AI's own calls answer only this page and your published site.
   Started at login by ~/Library/LaunchAgents/com.moneyai.local.plist (ai serve runs it by hand).
   ========================================================= */
import http from 'http';
import fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';
import * as Local from './local.mjs';
const UI = path.join(path.dirname(fileURLToPath(import.meta.url)), 'ui.html');
const brain = () => import('./ai.mjs');                         // the terminal's own answer, loaded when first asked
const body = req => new Promise((res, rej)=>{ let b = ''; req.on('data', c=>{ b += c; if(b.length > 3e7){ rej(new Error('Too long')); req.destroy(); } }); req.on('end', ()=>{ try{ res(JSON.parse(b || '{}')); }catch(e){ rej(new Error('Not JSON')); } }); });

const PORT = +process.env.MONEY_AI_PORT || 8899;
const ALLOWED = [/^https:\/\/anilgupta2606\.github\.io$/, /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/];
const headers = origin => Object.assign({'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'},
  origin && ALLOWED.some(r=>r.test(origin)) ? {'access-control-allow-origin': origin, 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'x-relay-token, content-type',
    'access-control-allow-private-network': 'true', 'access-control-max-age': '600', vary: 'Origin'} : {});

export function serve(port){
  const server = http.createServer(async (req, res)=>{
    const origin = req.headers.origin || '';
    const send = (status, data) => { res.writeHead(status, headers(origin)); res.end(JSON.stringify(data)); };
    if(req.method === 'OPTIONS'){ res.writeHead(204, headers(origin)); return res.end(); }
    // only your site (or this Mac itself) may use it
    const u = new URL(req.url, 'http://local');
    // only this Mac's own address (a site cannot reach it by pointing its own name at this Mac)
    if(!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host || '')) return send(403, {error: 'Not allowed.'});
    // the page: anyone at this Mac may open it
    if(req.method === 'GET' && (u.pathname === '/' || u.pathname === '/index.html')){
      res.writeHead(200, {'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'unsafe-inline' https://cdnjs.cloudflare.com; worker-src blob: https://cdnjs.cloudflare.com; connect-src 'self' https://cdnjs.cloudflare.com; img-src 'self' data:", 'x-frame-options': 'DENY'});
      return res.end(fs.readFileSync(UI));
    }
    const samePage = req.headers['sec-fetch-site'] === 'same-origin';
    if(u.pathname !== '/health' && !samePage && !ALLOWED.some(r=>r.test(origin))) return send(403, {error: 'Not allowed.'});
    // the AI itself: only from the page above (not other sites)
    if(['/ask', '/teach', '/forget', '/learned', '/brain', '/warm', '/feedback', '/connectors', '/rule', '/remember', '/keys', '/sessions', '/session'].includes(u.pathname)){
      try{
        const B = await brain();
        if(u.pathname === '/learned') return send(200, B.learned());
        if(u.pathname === '/warm') return send(200, {ok: await B.warm()});
        if(u.pathname === '/sessions') return send(200, {list: B.listSessions()});
        if(u.pathname === '/session' && req.method === 'GET'){ const x = B.loadSession(u.searchParams.get('id')); return x ? send(200, x) : send(404, {error: 'No such chat.'}); }
        if(u.pathname === '/keys' && req.method === 'GET') return send(200, {cloud: B.cloudNames()});
        if(u.pathname === '/connectors' && req.method === 'GET') return send(200, {list: B.getConnectors(), presets: B.PRESETS});
        if(u.pathname === '/brain' && req.method === 'GET') return send(200, B.brainExport());
        if(u.pathname === '/brain') return send(200, {ok: true, changed: B.brainMerge(await body(req))});
        if(req.method !== 'POST') return send(405, {error: 'Use POST.'});
        const d = await body(req);
        if(u.pathname === '/teach') return send(200, {ok: !!(await B.teach(String(d.lesson || ''), String(d.question || '')))});
        if(u.pathname === '/forget') return send(200, {ok: B.forgetId(String(d.id || ''))});
        if(u.pathname === '/feedback') return send(200, B.feedback(d));
        if(u.pathname === '/connectors') return send(200, {list: B.saveConnectors(d.list)});
        if(u.pathname === '/rule') return send(200, {ok: B.addRule(d.text)});
        if(u.pathname === '/session') return send(200, d.delete ? {ok: B.deleteSession(d.id)} : {id: B.saveSession(d)});
        if(u.pathname === '/keys' && req.method === 'POST') return send(200, {saved: B.saveKeys(d.keys)});
        if(u.pathname === '/remember') return send(200, {ok: B.remember(d.text)});
        // /ask: steps as they happen, then the answer — one JSON object per line
        const q = String(d.question || '').trim().slice(0, 2000);
        if(!q) return send(400, {error: 'No question.'});
        res.writeHead(200, Object.assign(headers(origin), {'content-type': 'application/x-ndjson; charset=utf-8', 'x-content-type-options': 'nosniff'}));
        const line = x => { try{ res.write(JSON.stringify(x) + '\n'); }catch(e){} };
        const history = (Array.isArray(d.history) ? d.history : []).slice(-6).map(h=>({role: h.role === 'assistant' ? 'assistant' : 'user', content: String(h.content || '').slice(0, 1500)}));
        const t = Date.now();
        // Stop on the page closes this request: the work stops too (the model, the searches)
        const stop = new AbortController();
        res.on('close', ()=>{ if(!res.writableEnded) stop.abort(); });
        try{ const out = await B.answer(q, {signal: stop.signal, history, files: [], fresh: !!d.fresh, goal: String(d.goal || '').slice(0, 400),
          disabled: (Array.isArray(d.disabled) ? d.disabled : []).filter(x=>/^(web|read|calc|market|code|connectors)$/.test(x)),
          attachments: (Array.isArray(d.attachments) ? d.attachments : []).slice(0, 40).map(a=>({name: String(a && a.name || 'file').slice(0, 160), text: String(a && a.text || '').slice(0, 300000),
            image: a && typeof a.image === 'string' && /^[A-Za-z0-9+/=]+$/.test(a.image.slice(0, 200)) ? a.image.slice(0, 12e6) : undefined})).filter(a=>a.text.trim() || a.image), cloudKeys: d.cloud && d.cloud.keys && typeof d.cloud.keys === 'object' && Object.keys(d.cloud.keys).length ? d.cloud.keys : null, cloud: !!d.cloud, onStep: s=>line({step: s}), onTrace: t=>line({trace: t}), onDraft: (()=>{ let at = 0; return t=>{ if(Date.now() - at > 150){ at = Date.now(); line({draft: String(t).slice(-6000)}); } }; })()}); line({answer: Object.assign({}, out, {q, secs: Math.round((Date.now() - t) / 1000)})}); }
        catch(e){ if(!stop.signal.aborted) line({error: String(e.message || e)}); }
        return res.end();
      }catch(e){ return send(500, {error: String(e.message || e)}); }
    }
    try{
      if(u.pathname === '/health') return send(200, {ok: true, local: true, search: {searxng: await Local.searxngUp()}, reader: 'this Mac', model: await (await brain()).localModel().catch(()=>'')});
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
  server.listen(port || PORT, '127.0.0.1', ()=>console.log('AI local helper on http://127.0.0.1:' + (port || PORT)));
  return server;
}
if(process.argv[1] && process.argv[1].endsWith('serve.mjs')) serve();
