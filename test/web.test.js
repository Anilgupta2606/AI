// The rules every answer is held to (MoneyWeb.review): each one catches a mistake a model really made
const test = require('node:test');
const assert = require('node:assert');
global.localStorage = {s: {}, getItem(k){ return this.s[k] ?? null; }, setItem(k, v){ this.s[k] = String(v); }, removeItem(k){ delete this.s[k]; }};
global.MoneyBrain = require('../engine/brain.js');
const W = require('../engine/web.js');
const rbi = [{n: 1, title: 'RBI MPC', text: 'Economists expect the RBI may raise the repo rate to 5.50% in October. In August the MPC kept the repo rate unchanged at 5.25%.'}];
const rules = (a, c) => W.review(a, Object.assign({question: 'What did the RBI decide?', sources: rbi, searched: true}, c)).map(i=>i.rule);

test('rules: a right, sourced answer passes', ()=>{
  assert.deepStrictEqual(rules('The RBI kept the repo rate unchanged at 5.25% in August [1], and economists expect 5.50% in October [1].'), []);
});
test('rules: each mistake is caught', ()=>{
  assert.deepStrictEqual(rules('The RBI raised the repo rate to 5.50% [1].'), ['R7']);                         // a forecast told as a decision
  assert.ok(rules('The RBI kept the rate at 5.38% [1].').includes('R4'));                                      // a number never read
  assert.ok(rules('The RBI kept the rate at 5.25% [4].').includes('R3'));                                      // a source never read
  assert.ok(rules('The RBI kept the repo rate at 5.25%.').includes('R2'));                                     // no source mark
  assert.ok(rules('There are 47 days left [1].', {extra: '38 days from 2026-10-01 to 2026-11-08'}).includes('R6'));
  assert.ok(rules('Australia beat England [1].', {question: 'who won'}).includes('R8'));                        // a name never read
  assert.ok(rules('2 × 3 = 7 [1]').includes('R5'));
  assert.ok(rules('It is 5.25% [1]. Final answer: 5.25% [1].').includes('R9'));
  assert.ok(rules('Not sure.', {timely: true, searched: false, sources: []}).includes('R1'));
});
test('rules: decimals stay whole and right sums count as read', ()=>{
  assert.deepStrictEqual(rules('The repo rate is 5.25% [1]; 5.50 - 5.25 = 0.25 [1].'), []);
});
test('rules: mistakes are remembered for next time', ()=>{
  W.remember([{rule: 'R7'}, {rule: 'R7'}, {rule: 'R4'}]);
  W.remember([{rule: 'R7'}]);
  const m = W.pastMistakes();
  assert.match(m[0], /forecast/); assert.match(m[0], /2 times/);
  assert.strictEqual(m.length, 2);
});
test('rules: what is dated after today has not happened yet', ()=>{
  const c = {sources: [{n: 2, title: 'x', text: 'MPC meeting October 5 to 7, 2026. kept unchanged at 5.25%'}], today: '2026-10-01'};
  assert.deepStrictEqual(W.review('The decision was made at the meeting held from October 5 to 7, 2026 [2].', c).map(i=>i.rule), ['R10']);
  assert.deepStrictEqual(W.review('The next meeting will be held from October 5 to 7, 2026 [2].', c), []);
});
test('cases: a lesson comes back for a question like it, not for others, and ends when the event comes', ()=>{
  W.remember([{rule: 'R10', text: '2026-10-05 is after today (2026-10-01), so ...'}], 'Did the RBI cut the repo rate at its October 2026 meeting?');
  assert.strictEqual(W.casesFor('Has the RBI cut the repo rate in its October 2026 policy meeting?', 3, {today: '2026-10-02'}).length, 1);
  assert.strictEqual(W.casesFor('What is the RBI repo rate right now?', 3, {today: '2026-10-02'}).length, 0);
  assert.strictEqual(W.casesFor('Did the RBI cut the repo rate at its October 2026 meeting?', 3, {today: '2026-10-08'}).length, 0);
  assert.match(W.timingNote('Did the RBI cut the repo rate at its October 2026 meeting?', '2026-10-01'), /may not have happened yet/);
  assert.strictEqual(W.timingNote('Did the RBI cut rates in August 2026?', '2026-10-01'), '');
});
test('rules: "scheduled for" does not hide a claim that it happened', ()=>{
  const c = {sources: [{n: 7, title: 'x', text: 'MPC October 5 to 7, 2026'}], today: '2026-10-01'};
  assert.deepStrictEqual(W.review('This decision was made during the MPC meeting scheduled from October 5 to 7, 2026 [7].', c).map(i=>i.rule), ['R10']);
  assert.deepStrictEqual(W.review('The next meeting is scheduled for October 5 to 7, 2026 [7].', c), []);
  assert.deepStrictEqual(W.review('It has not happened yet: the MPC meets from October 5 to 7, 2026 [7].', c), []);
});
test('cases: the same mistake again makes one lesson surer, not two lessons', ()=>{
  const n = () => MoneyBrain.lessons({app: 'ai', topic: 'case'}).length;
  const before = n();
  W.remember([{rule: 'R10', text: '2026-10-05 is after today'}], 'Has the RBI cut the repo rate in its October 2026 policy meeting?');
  assert.strictEqual(n(), before);
});
test('what changes must be searched: winners, latest, office holders, counts that grow — not settled facts', ()=>{
  const t = q => W.isTimely(q, '2026-10-01');
  ['Which country won the 2026 FIFA World Cup?', 'Who won the most recent FIFA Club World Cup?', 'What is the latest version of iOS?',
   'Which planet has the most moons?', 'Who is the CEO of OpenAI?', 'How many days until Diwali?'].forEach(q=>assert.ok(t(q), q));
  ['Who painted the Mona Lisa?', 'What is the chemical symbol for gold?', 'Explain why the sky is blue', 'In which year did the Berlin Wall fall?'].forEach(q=>assert.ok(!t(q), q));
});
test('rules: a longer sum written out is worked out again', ()=>{
  assert.deepStrictEqual(W.review('(100000 * (1 + 0.07)^5) = 131079.61', {sources: []}).map(i=>i.rule), ['R5']);
  assert.deepStrictEqual(W.review('100000 * (1 + 0.07)^5 = 140255.17', {sources: []}), []);
  assert.match(W.calc('What is 1,00,000 after 5 years at 7% interest compounded yearly?').text, /1,40,255/);
});
test('cases: lessons for different questions stay apart (a different year is a different question)', ()=>{
  W.learnCase('Who won the most recent FIFA Club World Cup?', [{rule: 'you'}], {text: 'Chelsea won the 2025 Club World Cup.'});
  W.learnCase('Which country won the 2026 FIFA World Cup?', [{rule: 'you'}], {text: 'Spain won the 2026 World Cup.'});
  assert.deepStrictEqual(W.casesFor('Who won the most recent FIFA Club World Cup?', 3), ['Chelsea won the 2025 Club World Cup.']);
  assert.deepStrictEqual(W.casesFor('Who won the 2026 FIFA World Cup?', 3), ['Spain won the 2026 World Cup.']);
});
test('rules: what is dated before today has already happened', ()=>{
  const c = {sources: [{n: 3, title: 'x', text: 'Glasgow 2026, 23 July to 2 August 2026'}], today: '2026-10-01'};
  assert.deepStrictEqual(W.review('The Games have not taken place yet; they are scheduled from 23 July to 2 August 2026 [3].', c).map(i=>i.rule), ['R11']);
  assert.deepStrictEqual(W.review('The Games were held in Glasgow from 23 July to 2 August 2026 [3].', c), []);
  assert.ok(W.isTimely('Which planet in our solar system has the largest number of moons?', '2026-10-01'));
});
test('rules: a capitalised word opening a sentence is not taken for a name', ()=>{
  const c = {question: 'Which planet has the most moons?', sources: [{n: 1, title: 'NASA', text: 'Saturn has 274 moons.'}]};
  assert.deepStrictEqual(W.review('Updated counts vary. Saturn has 274 moons [1].', c), []);
  assert.deepStrictEqual(W.review('Saturn has 274 moons, more than Neptune [1].', c).map(i=>i.rule), ['R8']);
});
