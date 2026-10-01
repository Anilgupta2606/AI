#!/usr/bin/env node
/* The model's own exam, end to end through the `ai` command (search, reading, calculator, rules, memory):
     node test/exam/model.exam.mjs [first|general|retest|all] [out.json]
   Fixed facts and sums are marked automatically; "live" questions have keys checked by hand on the day they were
   set (the date is kept with them) — after that, read the answers and their sources instead. */
import {execFile} from 'child_process';
import fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
const daysTo = d => Math.round((new Date(d + 'T00:00:00Z') - today) / 86400000);
const FIRST = [
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
// everyday questions on anything (set 2026-10-01)
const GENERAL = [
  {kind: 'fact', q: 'What is the boiling point of water at sea level in Fahrenheit?', key: /212/},
  {kind: 'fact', q: 'Who painted the Mona Lisa?', key: /Leonardo|da Vinci/i},
  {kind: 'fact', q: 'What is the chemical symbol for gold?', key: /\bAu\b/},
  {kind: 'fact', q: 'How many bones are in the adult human body?', key: /\b206\b/},
  {kind: 'fact', q: 'Which planet has the most moons?', key: /Saturn/},
  {kind: 'fact', q: 'What is the longest river in Africa?', key: /Nile/},
  {kind: 'fact', q: 'In which year did the Berlin Wall fall?', key: /1989/},
  {kind: 'fact', q: 'Who discovered penicillin?', key: /Fleming/},
  {kind: 'fact', q: 'What is the speed of light in kilometres per second?', key: /299,?79\d/},
  {kind: 'fact', q: 'What is the largest ocean on Earth?', key: /Pacific/},
  {kind: 'hindi', q: 'Bharat ki rajdhani kya hai?', key: /New Delhi|नई दिल्ली|न्यू दिल्ली|Nai Dilli/i},
  {kind: 'sum', q: 'Convert 100 km to miles', key: /62\.1/},
  {kind: 'sum', q: 'What is a 15% tip on a bill of 2,340?', key: /\b351\b/},
  {kind: 'sum', q: 'A train travels 420 km in 3.5 hours. What is its average speed?', key: /\b120\b/},
  {kind: 'sum', q: 'What is 1,00,000 after 5 years at 7% interest compounded yearly?', key: /1,?40,?25[45]/},
  {kind: 'date', q: 'What day of the week was 15 August 1947?', key: /Friday/},
  {kind: 'date', q: 'How many days are there from 1 January 2026 to 1 March 2026?', key: /\b59\b/},
  {kind: 'explain', q: 'Explain in two sentences why the sky is blue.', key: /scatter/i},
  {kind: 'explain', q: 'What is the difference between a virus and a bacterium?', key: /cell/i},
  {kind: 'live', q: 'Who won the most recent FIFA Club World Cup?', key: /Chelsea/, set: '2026-10-01'},
  {kind: 'live', q: 'Who won the Nobel Prize in Physics in 2025?', key: /Clarke|Devoret|Martinis/, set: '2026-10-01'},
  {kind: 'live', q: 'Who is the CEO of OpenAI now?', key: /Altman/, set: '2026-10-01'},
  {kind: 'live', q: 'Which country won the 2026 FIFA World Cup?', key: null, set: '2026-10-01'},
  {kind: 'live', q: 'What is the latest version of iOS?', key: null, set: '2026-10-01'},
  {kind: 'live', q: 'Who is the Chief Minister of Delhi?', key: null, set: '2026-10-01'},
  {kind: 'trap', q: 'Who won the 2026 Nobel Peace Prize?', key: /not (yet|been)|has not|hasn't|yet to|will be announced|to be announced|October 9|9 October/i, set: '2026-10-01'},
  {kind: 'trap', q: 'Who won the 2028 US presidential election?', key: /not (yet|been)|has not|hasn't|yet to|will (be held|take place)|scheduled|November 7, 2028|7 November 2028/i, set: '2026-10-01'},
];
// after teaching (2026-10-01): the misses again, the same asked differently, and new questions of the same kinds
const RETEST = [
  {kind: 'missed', q: 'What is 1,00,000 after 5 years at 7% interest compounded yearly?', key: /1,?40,?255/},
  {kind: 'missed', q: 'Who won the Nobel Prize in Physics in 2025?', key: /Clarke|Devoret|Martinis/},
  {kind: 'missed', q: 'Who won the most recent FIFA Club World Cup?', key: /^(?![\s\S]*Manchester City won)[\s\S]*Chelsea/},
  {kind: 'missed', q: 'Which planet has the most moons?', key: /^(?![\s\S]*Jupiter has the (most|largest))[\s\S]*Saturn/},
  {kind: 'missed', q: 'Which country won the 2026 FIFA World Cup?', key: /Spain/},
  {kind: 'missed', q: 'Who discovered penicillin?', key: /1928/},
  {kind: 'reworded', q: 'Which planet in our solar system has the largest number of moons?', key: /^(?![\s\S]*Jupiter has the (most|largest))[\s\S]*Saturn/},
  {kind: 'reworded', q: 'Who were the winners of the 2025 physics Nobel?', key: /Clarke|Devoret|Martinis/},
  {kind: 'new', q: 'What does 50,000 become after 10 years at 8% compounded annually?', key: /1,?07,?946/},
  {kind: 'new', q: 'A car covers 300 km in 4 hours. What is its average speed?', key: /\b75\b/},
  {kind: 'new', q: 'Who won the Nobel Prize in Chemistry in 2025?', key: /Kitagawa|Robson|Yaghi/},
  {kind: 'new', q: 'Who won the Wimbledon 2026 men\'s singles title?', key: null, set: '2026-10-01'},
  {kind: 'new', q: 'Have the 2026 Commonwealth Games taken place yet?', key: null, set: '2026-10-01'},
  {kind: 'new', q: 'What is the latest version of Android?', key: null, set: '2026-10-01'},
];
const SETS = {first: FIRST, general: GENERAL, retest: RETEST, all: FIRST.concat(GENERAL)};
const setName = SETS[process.argv[2]] ? process.argv[2] : 'first';
const outFile = SETS[process.argv[2]] ? process.argv[3] : process.argv[2];
const Q = SETS[setName];
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
if(outFile) fs.writeFileSync(outFile, JSON.stringify(results, null, 2));
