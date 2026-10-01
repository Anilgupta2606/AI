#!/usr/bin/env node
/* =========================================================
   COMPLEX TASKS EXAM — 35 multi-step tasks: programs (run against hidden tests), bug fixing, SQL, data analysis of
   a file, answers from a long document, chained research, multi-step money and date sums, plans with constraints,
   and several instructions at once.
     node test/exam/complex.exam.mjs                       all of them, with the model chosen here (ai model)
     node test/exam/complex.exam.mjs --model qwen3.5:4b    the same with another model (for comparing)
     --only code,data · --ids 3,7 · --resume
   Results: ~/.money-ai/complex-results[-model].json. Keys checked 2026-10-02.
   ========================================================= */
import {execFile} from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {fileURLToPath} from 'url';
const HERE = path.dirname(fileURLToPath(import.meta.url)), DATA = path.join(HERE, 'data');
const Runner = await import(path.join(HERE, '../../cli/runner.mjs'));

const numIn = (t, re) => { const m = re.exec(String(t).replace(/,/g, '')); return m ? +m[1] : NaN; };
const near = (t, x, tol) => (String(t).replace(/,/g, '').match(/\d+(?:\.\d+)?/g) || []).some(n=>Math.abs(+n - x) <= tol);
const Q = [
  // ---------------------------------------------------------------- programs (run against hidden tests)
  {g: 'code', q: 'Write a Python function parse_log(lines) that takes log lines like "2026-09-01 12:00:01 ERROR db timeout" and returns a dict counting each level (the third word), e.g. {"ERROR": 2, "INFO": 5}.', code: {lang: 'python', tests: 'r = parse_log(["2026-09-01 12:00:01 ERROR db timeout", "2026-09-01 12:00:02 INFO ok", "2026-09-01 12:00:03 INFO ok", "2026-09-01 12:00:04 WARN slow"])\nassert r == {"ERROR": 1, "INFO": 2, "WARN": 1}, r\nassert parse_log([]) == {}'}},
  {g: 'code', q: 'This Python function has bugs:\n\ndef average(nums):\n    total = 0\n    for i in range(1, len(nums)):\n        total += nums[i]\n    return total / len(nums)\n\nFix it so that average([]) returns 0 and average([1, 2, 3]) returns 2.0. Give the corrected function.', code: {lang: 'python', tests: 'assert average([]) == 0\nassert average([1, 2, 3]) == 2.0 and average([5]) == 5'}},
  {g: 'code', q: 'Write a Python class Stack with methods push(x), pop(), peek(), is_empty() and size(). pop() and peek() on an empty stack must raise IndexError.', code: {lang: 'python', tests: 's = Stack()\nassert s.is_empty() and s.size() == 0\ns.push(1); s.push(2)\nassert s.peek() == 2 and s.size() == 2 and s.pop() == 2 and s.pop() == 1\ntry:\n    s.pop(); raise SystemExit(1)\nexcept IndexError:\n    pass'}},
  {g: 'code', q: 'Using Python\'s sqlite3 module, write a function top_customers(conn, n) that returns a list of the n customer names with the highest total order amount, highest first, from tables customers(id, name) and orders(id, customer_id, amount).', code: {lang: 'python', tests: 'import sqlite3\nc = sqlite3.connect(":memory:")\nc.executescript("create table customers(id integer, name text); create table orders(id integer, customer_id integer, amount real); insert into customers values (1,\'Asha\'),(2,\'Ravi\'),(3,\'Meera\'); insert into orders values (1,1,100),(2,2,300),(3,1,250),(4,3,50),(5,3,40);")\nr = top_customers(c, 2)\nr = [x[0] if isinstance(x, (tuple, list)) else x for x in r]\nassert r == ["Asha", "Ravi"], r'}},
  {g: 'code', q: 'Write a Python function extract_emails(text) that returns all email addresses in the text, in the order they appear.', code: {lang: 'python', tests: 'assert extract_emails("Mail asha@example.com or ravi.k@mail.co.in, not me@") == ["asha@example.com", "ravi.k@mail.co.in"]\nassert extract_emails("none here") == []'}},
  {g: 'code', q: 'Write a Python function is_valid_pan(s) that checks an Indian PAN: 5 uppercase letters, then 4 digits, then 1 uppercase letter.', code: {lang: 'python', tests: 'assert is_valid_pan("ABCDE1234F") and not is_valid_pan("ABCD1234F") and not is_valid_pan("abcde1234f") and not is_valid_pan("ABCDE12345")'}},
  {g: 'code', q: 'Write two Python functions: rle_encode(s) that turns "aaabcc" into "a3b1c2", and rle_decode(s) that turns it back.', code: {lang: 'python', tests: 'assert rle_encode("aaabcc") == "a3b1c2" and rle_encode("") == ""\nassert rle_decode("a3b1c2") == "aaabcc" and rle_decode(rle_encode("zzzzzzzzzzzy")) == "zzzzzzzzzzzy"'}},
  {g: 'code', q: 'Write a Python function group_anagrams(words) that groups words that are anagrams of each other. Return a list of groups, each group a sorted list.', code: {lang: 'python', tests: 'r = sorted(group_anagrams(["eat", "tea", "tan", "ate", "nat", "bat"]))\nassert r == [["ate", "eat", "tea"], ["bat"], ["nat", "tan"]], r'}},
  {g: 'code', q: 'Write a Python class LRUCache with __init__(capacity), get(key) returning -1 if missing, and put(key, value) that evicts the least recently used key when full.', code: {lang: 'python', tests: 'c = LRUCache(2)\nc.put(1, 1); c.put(2, 2)\nassert c.get(1) == 1\nc.put(3, 3)\nassert c.get(2) == -1 and c.get(3) == 3 and c.get(1) == 1'}},
  {g: 'code', q: 'Write a Python function emi(principal, annual_rate, years) that returns the monthly EMI of a loan, rounded to 2 decimals.', code: {lang: 'python', tests: 'assert abs(emi(1000000, 9, 5) - 20758.36) < 0.02, emi(1000000, 9, 5)\nassert abs(emi(2000000, 8.5, 20) - 17356.46) < 0.02'}},
  {g: 'code', q: 'Write a JavaScript function groupBy(arr, key) that returns an object mapping each value of that key to the array of items with it.', code: {lang: 'javascript', tests: 'const r = groupBy([{t: "a", v: 1}, {t: "b", v: 2}, {t: "a", v: 3}], "t");\nif(JSON.stringify(r) !== JSON.stringify({a: [{t: "a", v: 1}, {t: "a", v: 3}], b: [{t: "b", v: 2}]})) process.exit(1);'}},
  {g: 'code', q: 'Write a Python function column_total(csv_text, column) that adds up a numeric column of CSV text with a header row. Values may be quoted and contain commas, like "1,200".', code: {lang: 'python', tests: 'assert column_total(\'item,amount\\nA,"1,200"\\nB,300\\n\', "amount") == 1500\nassert column_total("x,y\\n1,2\\n3,4\\n", "y") == 6'}},
  // ---------------------------------------------------------------- a data file (expenses_q3.csv)
  {g: 'data', file: 'expenses_q3.csv', q: 'From this file: which category had the highest total spending, and what share of all spending was it?', key: /Fuel/, check: t => near(t, 21249, 1) || near(t, 29.1, 0.1)},
  {g: 'data', file: 'expenses_q3.csv', q: 'From this file: which month had the highest total spending, and how much more was it than the lowest month?', key: /July|2026-07|Jul\b/i, check: t => near(t, 2942, 1)},
  {g: 'data', file: 'expenses_q3.csv', q: 'From this file: what is the average amount of a Food transaction?', check: t => near(t, 1642.83, 0.6)},
  // ---------------------------------------------------------------- a long document (handbook.txt)
  {g: 'document', file: 'handbook.txt', q: 'According to this handbook, what notice period must a manager give before resigning?', key: /90 days|ninety days/i},
  {g: 'document', file: 'handbook.txt', q: 'According to this handbook, how many unused earned leave days can be carried forward?', key: /\b12\b|twelve/i},
  {g: 'document', file: 'handbook.txt', q: 'According to this handbook, what daily allowance is paid on business travel in metro cities, and how many days a week can I work from home?', check: t => near(t, 2500, 0) && /\b(two|2) days\b/i.test(t)},
  // ---------------------------------------------------------------- chained research (several steps)
  {g: 'research', q: 'Who was the Prime Minister of India when Chandrayaan-3 landed on the Moon, and in which year was that?', key: /Modi[\s\S]*2023|2023[\s\S]*Modi/},
  {g: 'research', q: 'What is the capital of the country that won the 2026 FIFA World Cup?', key: /Madrid/},
  {g: 'research', q: 'How many years passed between the fall of the Berlin Wall and the Chandrayaan-3 Moon landing?', key: /\b34\b/},
  {g: 'research', q: 'Who founded the company that makes the Android operating system?', key: /Page[\s\S]*Brin|Brin[\s\S]*Page/},
  {g: 'research', q: "Who won the Wimbledon 2026 men's singles title, and how many Wimbledon titles does he have now?", key: /Sinner/, check: t => /\b(2|two|second)\b/i.test(t)},
  // ---------------------------------------------------------------- multi-step sums
  {g: 'money', q: 'A home loan of 20 lakh at 8.5% for 20 years: what is the monthly EMI and the total interest paid over the loan?', check: t => near(t, 17356, 2) && (near(t, 2165552, 300) || /21\.6\d?\s*(lakh|L)/i.test(t))},
  {g: 'money', q: 'With 6% inflation a year, what will 1 lakh rupees today be worth in today\'s money after 10 years?', check: t => near(t, 55839.5, 60)},
  {g: 'money', q: 'I earn 1,20,000 a month, spend 45% on needs and 20% on wants, and invest the rest. How much do I invest in a year?', check: t => near(t, 504000, 1)},
  {g: 'money', q: 'A car worth 8 lakh loses 15% of its value every year. What is it worth after 3 years?', check: t => near(t, 491300, 5)},
  {g: 'money', q: 'For 1 lakh over 5 years, which pays more: an FD at 7% compounded quarterly, or one at 7.2% compounded yearly? By how much?', key: /7\.2/, check: t => near(t, 93, 2) && near(t, 141571, 2)},
  {g: 'dates', q: 'A 90-day project starts on 15 October 2026 (that day is day 1). On what date and weekday does it end?', key: /12 January 2027|January 12,? 2027|2027-01-12/i, check: t => /Tuesday/i.test(t)},
  {g: 'dates', q: 'How many weekdays (Monday to Friday) are there in November 2026?', key: /\b21\b/},
  // ---------------------------------------------------------------- plans with constraints
  {g: 'plan', q: 'Plan a 3-day trip to Jaipur for 2 people with a total budget of 30,000 rupees. Give each day with its cost, and the total.', check: t => (t.match(/\bday\s*[123]\b/gi) || []).length >= 3 && (()=>{ const m = /total[^\d\n]{0,40}([\d,]{4,})/i.exec(t); return m && +m[1].replace(/,/g, '') <= 30000 && +m[1].replace(/,/g, '') >= 10000; })()},
  {g: 'plan', q: 'Make a weekly study plan of exactly 10 hours across Python, SQL and statistics. Give the hours for each subject.', check: t => { let sum = 0, n = 0; for(const s of ['python', 'sql', 'statistic']){ const line = t.split('\n').find(l=>l.toLowerCase().includes(s) && /\d/.test(l)); if(line){ const m = /(\d+(?:\.\d+)?)\s*(hours?|hrs?|h\b)/i.exec(line); if(m){ sum += +m[1]; n++; } } } return n === 3 && Math.abs(sum - 10) < 0.01; }},
  // ---------------------------------------------------------------- several instructions at once
  {g: 'format', q: 'Write a haiku about the monsoon: exactly 3 lines, no title, nothing else.', check: t => t.trim().split('\n').filter(l=>l.trim()).length === 3},
  {g: 'format', q: 'Explain recursion in exactly two sentences.', check: t => (t.replace(/\[\d+\]/g, '').trim().match(/[^.!?]+[.!?]/g) || []).length === 2},
  {g: 'format', q: 'Give 5 tips for saving money as a numbered list, each tip under 12 words, nothing else.', check: t => { const items = t.split('\n').filter(l=>/^\s*\d+[.)]\s+\S/.test(l)); return items.length === 5 && items.every(l=>l.replace(/^\s*\d+[.)]\s+/, '').replace(/\*\*/g, '').split(/\s+/).length <= 12); }},
  {g: 'format', q: 'Translate "Where is the railway station?" into Hindi. Use Hindi script only.', check: t => /[ऀ-ॿ]{4}/.test(t) && !/[a-z]{4}/i.test(t.replace(/\[\d+\]/g, ''))},
].map((x, i)=>Object.assign({id: i + 1}, x));

const args = process.argv.slice(2), arg = n => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : (args.find(a=>a.startsWith('--' + n + '=')) || '').split('=')[1]; };
const MODEL = arg('model') || '', only = (arg('only') || '').split(',').filter(Boolean), IDS = (arg('ids') || '').split(',').filter(Boolean).map(Number);
const OUT = path.join(os.homedir(), '.money-ai', 'complex-results' + (MODEL ? '-' + MODEL.replace(/[^\w.-]/g, '_') : '') + '.json');
let done = args.includes('--resume') || IDS.length ? (()=>{ try{ return JSON.parse(fs.readFileSync(OUT, 'utf8')); }catch(e){ return []; } })() : [];
const todo = Q.filter(x=>IDS.length ? IDS.includes(x.id) : (!only.length || only.includes(x.g)) && !done.some(d=>d.id === x.id));

const ask = x => new Promise(res=>{
  const t = Date.now(), a = ['--json', '--fresh'].concat(MODEL ? ['--model', MODEL] : [], x.file ? ['-f', path.join(DATA, x.file)] : [], [x.q]);
  execFile('ai', a, {cwd: os.tmpdir(), timeout: 900000, maxBuffer: 1 << 24}, (err, out, errOut)=>{
    let j = null; try{ j = JSON.parse(out); }catch(e){}
    res({secs: Math.round((Date.now() - t) / 1000), text: j ? String(j.text || '') : '', model: j ? j.model : '', error: j ? '' : String(errOut || err || '').slice(0, 200)});
  });
});
async function gradeCode(text, c){
  const blocks = Array.from(text.matchAll(/```[ \t]*([\w+#-]*)\s*\n([\s\S]*?)```/g)).filter(m=>c.lang === 'python' ? /^(py|python3?)?$/i.test(m[1]) : /^(js|javascript|node)$/i.test(m[1]));
  if(!blocks.length) return {pass: false, why: 'no ' + c.lang + ' code in the answer'};
  // all the answer's code of that language, in order (helpers may be in separate blocks); prints and input() made harmless
  const code = blocks.map(b=>b[2]).join('\n\n');
  const clean = c.lang === 'python' ? code.replace(/^(\s*)(print|input)\(.*$/gm, '$1pass').replace(/^if __name__ == .__main__.:[\s\S]*$/m, '') : code.replace(/^\s*console\.log\(.*$/gm, '');
  const r = await Runner.run({language: c.lang, code: clean + '\n\n' + c.tests + '\n' + (c.lang === 'python' ? 'print("ALL TESTS PASSED")' : 'console.log("ALL TESTS PASSED")')});
  return {pass: r.ok && /ALL TESTS PASSED/.test(r.output), why: r.ok ? '' : r.output.split('\n').slice(-3).join(' ').slice(0, 200)};
}

console.log('Complex tasks' + (MODEL ? ' with ' + MODEL : '') + ': ' + todo.length + '\n');
for(const x of todo){
  const a = await ask(x);
  let pass = false, why = '';
  if(a.error) why = 'error: ' + a.error;
  else if(x.code){ const g = await gradeCode(a.text, x.code); pass = g.pass; why = g.why; }
  else pass = (!x.key || x.key.test(a.text)) && (!x.check || !!x.check(a.text));
  done = done.filter(d=>d.id !== x.id).concat([{id: x.id, g: x.g, q: x.q, pass, why, secs: a.secs, model: a.model, text: a.text.slice(0, 2500)}]);
  fs.writeFileSync(OUT, JSON.stringify(done, null, 1), {mode: 0o600});
  console.log((pass ? '✓' : '✗') + ' ' + String(x.id).padStart(2) + ' [' + x.g + '] ' + a.secs + 's  ' + x.q.split('\n')[0].slice(0, 70) + (pass ? '' : '\n      → ' + (why || a.text.replace(/\s+/g, ' ').slice(0, 160))));
}
const groups = {};
done.forEach(d=>{ groups[d.g] = groups[d.g] || {n: 0, ok: 0, secs: 0}; groups[d.g].n++; groups[d.g].ok += d.pass ? 1 : 0; groups[d.g].secs += d.secs; });
console.log('\nScore by group' + (MODEL ? ' (' + MODEL + ')' : '') + ':');
Object.entries(groups).forEach(([g, v])=>console.log('  ' + g.padEnd(9) + String(v.ok).padStart(3) + ' / ' + String(v.n).padEnd(3) + ' ' + '█'.repeat(Math.round(v.ok / v.n * 20)).padEnd(20, '·') + '  avg ' + Math.round(v.secs / v.n) + 's'));
const ok = done.filter(d=>d.pass).length, secs = done.reduce((t, d)=>t + d.secs, 0);
console.log('\nTotal: ' + ok + ' / ' + done.length + ' (' + Math.round(ok / done.length * 100) + '%) · ' + Math.round(secs / 60) + ' min, ' + Math.round(secs / done.length) + ' s a task');
