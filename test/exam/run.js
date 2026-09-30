/* Runs an exam and prints the score and every failure.  node test/exam/run.js understand [--quiet]
   Exits non-zero when the score is under the pass mark, so it can guard every change. */
const store = {};
global.localStorage = {getItem: k=>k in store ? store[k] : null, setItem: (k, v)=>{ store[k] = String(v); }, removeItem: k=>{ delete store[k]; }};
const B = require('../../engine/brain.js');
const which = process.argv[2] || 'understand', quiet = process.argv.includes('--quiet');
const PASS = {understand: 0.95};

const hm = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
/* The actions Money Brain found, as exam codes */
function codes(acts){
  const out = new Set();
  acts.forEach(a=>{
    if(a.do === 'pace') out.add('pace:' + a.value);
    if(a.do === 'food') out.add('food:' + a.value);
    if(a.do === 'like' || a.do === 'dislike') out.add(a.do + ':' + a.category);
    if(a.do === 'fixed') out.add('fixed@' + hm(a.min));
    if(a.do === 'free') out.add('free:' + a.part);
    if(a.do === 'dayStart') out.add('dayStart:' + (a.min != null ? hm(a.min) : a.shift > 0 ? 'later' : 'earlier'));
    if(a.do === 'dayEnd') out.add('dayEnd:' + (a.min != null ? hm(a.min) : a.shift > 0 ? 'later' : 'earlier'));
    if(a.do === 'walking') out.add('walking:' + a.value);
    if(a.do === 'travellers') out.add('kids');
    if(a.day && a.day.day) out.add('day:' + a.day.day);
    if(a.day && a.day.date) out.add('date:' + a.day.date);
  });
  return out;
}

if(which === 'understand' || which === 'holdout' || which === 'fresh'){
  const cases = require(which === 'holdout' ? './understand.holdout.js' : which === 'fresh' ? './understand.fresh.js' : './understand.exam.js');
  let ok = 0;
  const fails = [];
  cases.forEach(([text, must, mustNot])=>{
    const got = codes(B.understand(text));
    const missing = must.filter(c=>!got.has(c));
    const wrong = (mustNot || []).filter(c=>got.has(c));
    // nothing expected: nothing may be found (no invented actions)
    const invented = !must.length ? Array.from(got) : Array.from(got).filter(c=>/^(like|dislike):/.test(c) && must.every(m=>!/^(like|dislike):/.test(m)) && !must.includes(c));
    if(!missing.length && !wrong.length && !invented.length) ok++;
    else fails.push({text, missing, wrong: wrong.concat(invented), got: Array.from(got)});
  });
  const score = ok / cases.length;
  console.log(`${which === 'holdout' ? 'HELD-OUT set 1' : which === 'fresh' ? 'FRESH set (never tuned on)' : 'UNDERSTANDING EXAM'}: ${ok} / ${cases.length} = ${Math.round(score * 100)}%`);
  if(!quiet) fails.forEach(f=>console.log(`  ✗ "${f.text}"${f.missing.length ? '  missing ' + f.missing.join(', ') : ''}${f.wrong.length ? '  wrong ' + f.wrong.join(', ') : ''}   (found: ${f.got.join(', ') || 'nothing'})`));
  process.exit(which !== 'understand' || score >= PASS.understand ? 0 : 1);
}
