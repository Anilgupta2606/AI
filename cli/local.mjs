/* =========================================================
   LOCAL — searching and reading the web from this Mac alone: no keys, no accounts, no relay.
     search(q, n)  your own SearXNG (http://127.0.0.1:8888), which asks Google, Bing and others itself
     read(url)     the page fetched here and its main text found by Mozilla's Readability (as Firefox Reader View)
   ========================================================= */
import {parseHTML} from 'linkedom';
import {Readability} from '@mozilla/readability';

export const SEARXNG = process.env.SEARXNG_URL || 'http://127.0.0.1:8888';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej)=>setTimeout(()=>rej(new Error(what + ' took too long')), ms))]);

export async function searxngUp(){
  try{ const r = await withTimeout(fetch(SEARXNG + '/healthz'), 2500, 'search'); return r.ok; }catch(e){ return false; }
}
export async function search(q, n){
  const r = await withTimeout(fetch(SEARXNG + '/search?format=json&language=en&safesearch=0&q=' + encodeURIComponent(q)), 25000, 'Search');
  if(!r.ok) throw new Error('Your search engine (SearXNG) answered ' + r.status);
  const d = await r.json();
  const seen = new Set();
  const results = (d.results || []).filter(x=>x.url && !seen.has(x.url) && seen.add(x.url)).slice(0, n || 8)
    .map(x=>({title: x.title || x.url, url: x.url, snippet: String(x.content || '').slice(0, 400), date: x.publishedDate || ''}));
  if(!results.length) throw new Error('No results' + ((d.unresponsive_engines || []).length ? ' (the search engines asked to slow down: ' + d.unresponsive_engines.map(e=>e[0]).join(', ') + ')' : ''));
  return {provider: 'your SearXNG', results};
}
export async function read(url, withLinks){
  const r = await withTimeout(fetch(url, {headers: {'user-agent': UA, accept: 'text/html,application/xhtml+xml', 'accept-language': 'en-IN,en;q=0.9'}, redirect: 'follow'}), 20000, 'Opening the page');
  if(!r.ok) throw new Error('The page answered ' + r.status);
  const type = r.headers.get('content-type') || '';
  if(/pdf/.test(type)) throw new Error('It is a PDF (not read here yet)');
  const html = await r.text();
  const {document} = parseHTML(html);
  const links = [];
  if(withLinks) document.querySelectorAll('a[href]').forEach(a=>{
    if(links.length >= 60) return;
    try{ const href = new URL(a.getAttribute('href'), r.url).href; const text = (a.textContent || '').replace(/\s+/g, ' ').trim(); if(/^https?:/.test(href) && text.length > 3) links.push({text: text.slice(0, 80), url: href}); }catch(e){}
  });
  let article = null;
  try{ article = new Readability(document).parse(); }catch(e){}
  const text = String((article && article.textContent) || (document.body && document.body.textContent) || '').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim();
  if(text.length < 200) throw new Error('No readable text (a login, a cookie wall or a page built by scripts)');
  return {via: 'this Mac', title: (article && article.title) || (document.title || url), url: r.url || url, published: (article && article.publishedTime) || '', content: text.slice(0, 40000), links};
}
