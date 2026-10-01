#!/usr/bin/env node
/* The model's own exam, end to end through the `ai` command (search, reading, calculator, rules, memory):
     node test/exam/model.exam.mjs [out.json]
   Fixed facts and sums are marked automatically; "live" questions have keys checked by hand on the day they were
   set (the date is kept with them) — after that, read the answers and their sources instead. */
import {execFile} from 'child_process';
import fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
const daysTo = d => Math.round((new Date(d + 'T00:00:00Z') - today) / 86400000);
const Q = [
  {kind: 'fact', q: 'What is the capital of Australia?', key: /Canberra/},
  {kind: 'fact', q: 'Who wrote the Hindi novel Godan?', key: /Premchand/i},
  {kind: 'fact', q: 'How tall is Mount Everest in metres?', key: /8,?84[89]/},
  {kind: 'fact', q: 'In which year did Chandrayaan-3 land on the Moon?', key: /2023/},
  {kind: 'sum', q: 'EMI for a 50 lakh loan at 8.5% for 20 years', key: /43,?39[01]/},
  {kind: 'sum', q: 'I bought 3 shirts at 1,299 each and 2 jeans at 2,450 each. What is the total?', key: /8,?797/},
  {kind: 'date', q: 'How many days from today to 31 December 2026?', key: new RegExp('\\b' + daysTo('2026-12-31') + '\\b')},
  {kind: 'file', q: 'Which category did I spend the most on in September, and how much?', file: 'expenses.sample.csv', key: /Groceries[\s\S]*6,?285|6,?285[\s\S]*Groceries/i},
  {kind: 'file', q: 'How much did I spend on food in total?', file: 'expenses.sample.csv', key: /1,?950/},
  {kind: 'live', q: 'What is the RBI repo rate right now?', key: /5\.25/, set: '2026-10-01'},
  {kind: 'live', q: 'When is Diwali in 2026, and how many days from today is it?', key: new RegExp('^(?=[\\s\\S]*(8 November|November 8))(?![\\s\\S]*\\b' + (daysTo('2026-11-08') + 1) + ' days)[\\s\\S]*\\b' + daysTo('2026-11-08') + ' days'), set: '2026-10-01'},
  {kind: 'trap', q: 'Did the RBI cut the repo rate at its October 2026 meeting?', key: /not yet|has not|hasn't|yet to|scheduled|will (be held|meet|announce)|upcoming|October 7|7 October|no (decision|announcement)/i, set: '2026-10-01'},
  {kind: 'live', q: 'Who is the Prime Minister of the United Kingdom now?', key: null, set: '2026-10-01'},
  {kind: 'live', q: 'What is the price of 24 carat gold per 10 grams in India today?', key: null, set: '2026-10-01'},
];
const run = (q, file) => new Promise(res=>{
  const t = Date.now();
  execFile('ai', (file ? ['-f', path.join(HERE, file)] : []).concat(['--json', q]), {cwd: HERE, timeout: 600000, maxBuffer: 1 << 24}, (err, out, errOut)=>{
    let j = null; try{ j = JSON.parse(out); }catch(e){}
    res({q, secs: Math.round((Date.now() - t) / 1000), text: j ? j.text : '', by: j ? j.by : '', sources: j ? (j.sources || []).map(s=>s.url) : [], issues: j ? j.issues || [] : [], error: j ? '' : String(errOut || err || '').slice(0, 300)});
  });
});
const results = [];
for(const x of Q){
  const r = await run(x.q, x.file);
  r.kind = x.kind; r.pass = x.key ? x.key.test(r.text) : null;
  results.push(r);
  console.log((r.pass === null ? '?' : r.pass ? '✓' : '✗') + ' [' + x.kind + '] ' + r.secs + 's ' + x.q + '\n    ' + String(r.text).replace(/\s+/g, ' ').slice(0, 260) + '\n    ' + (r.by || r.error));
}
const marked = results.filter(r=>r.pass !== null);
console.log('\nMarked: ' + marked.filter(r=>r.pass).length + ' / ' + marked.length + ' · by hand: ' + (results.length - marked.length) + ' · average ' + Math.round(results.reduce((t, r)=>t + r.secs, 0) / results.length) + 's');
if(process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify(results, null, 2));
