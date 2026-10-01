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
