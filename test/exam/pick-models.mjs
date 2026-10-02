#!/usr/bin/env node
/* =========================================================
   PICK MODELS — from the model race (complex-results-*.json), the best model for each kind of question:
     code      the "code" tasks
     analysis  data file, money and date sums
     general   research, long documents, plans, instructions
   The most right wins; a tie goes to the faster. Prints the table; with --apply, saves it (ai models shows it).
   "complex-results.json" is the router's own run (qwen3 for general and analysis, the coder for code).
   ========================================================= */
import fs from 'fs';
import os from 'os';
import path from 'path';
import {fileURLToPath} from 'url';
const HERE = path.dirname(fileURLToPath(import.meta.url)), DIR = path.join(os.homedir(), '.money-ai');
const KIND = {code: 'code', data: 'analysis', money: 'analysis', dates: 'analysis', research: 'general', document: 'general', plan: 'general', format: 'general'};

const runs = fs.readdirSync(DIR).filter(f=>/^complex-results.*\.json$/.test(f)).map(f=>{
  const list = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
  const name = f === 'complex-results.json' ? 'router' : f.replace(/^complex-results-|\.json$/g, '');
  return {name, list};
});
if(!runs.length){ console.log('No race results yet (node test/exam/complex.exam.mjs --model <name>).'); process.exit(0); }

// per model and kind: right, total, seconds — the router's run counts for the models it used
const score = {};
for(const r of runs) for(const d of r.list){
  const kind = KIND[d.g] || 'general';
  const model = r.name === 'router' ? String(d.model || '').replace(/ · .*$/, '').replace(/ \(.*$/, '') || 'router' : r.name.replace(/_/g, ':').replace(/:(\d)/, ':$1');
  const k = model + '|' + kind;
  score[k] = score[k] || {model, kind, ok: 0, n: 0, secs: 0};
  score[k].ok += d.pass ? 1 : 0; score[k].n++; score[k].secs += d.secs || 0;
}
const rows = Object.values(score);
const models = [...new Set(rows.map(r=>r.model))];
console.log('\n' + 'model'.padEnd(22) + ['general', 'analysis', 'code'].map(k=>k.padStart(14)).join('') + '   overall');
for(const m of models){
  const cell = k => { const r = score[m + '|' + k]; return r ? (r.ok + '/' + r.n + ' ' + Math.round(r.secs / r.n) + 's').padStart(14) : '—'.padStart(14); };
  const all = rows.filter(r=>r.model === m), ok = all.reduce((t, r)=>t + r.ok, 0), n = all.reduce((t, r)=>t + r.n, 0), secs = all.reduce((t, r)=>t + r.secs, 0);
  console.log(m.padEnd(22) + cell('general') + cell('analysis') + cell('code') + '   ' + ok + '/' + n + ' (' + Math.round(ok / n * 100) + '%), ' + Math.round(secs / n) + 's a task');
}
const pick = {};
for(const k of ['general', 'analysis', 'code']){
  const c = rows.filter(r=>r.kind === k && r.n >= 2).sort((a, b)=>(b.ok / b.n - a.ok / a.n) || (a.secs / a.n - b.secs / b.n))[0];
  if(c) pick[k] = c.model;
}
console.log('\nBest for each kind: ' + Object.entries(pick).map(([k, m])=>k + ' → ' + m).join(' · '));
if(process.argv.includes('--apply')){
  const ai = await import(path.join(HERE, '../../cli/ai.mjs'));
  console.log('Saved: ' + JSON.stringify(ai.setRoutes(pick)) + '  (ai models)');
}
