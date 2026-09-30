/* Money Brain: learning, opening hours, travel, the day planner, understanding requests. Run: node --test test/ */
const test = require('node:test');
const assert = require('node:assert');
const store = {};
global.localStorage = {getItem: k=>k in store ? store[k] : null, setItem: (k, v)=>{ store[k] = String(v); }, removeItem: k=>{ delete store[k]; }};
const B = require('../engine/brain.js');

test('learning: repeats make it sure, a mixed record does not, pins and forgetting stick', ()=>{
  B._reset();
  assert.equal(B.recall('trip', 'like', 'museum'), null);
  B.learn('trip', 'like', 'museum', 'like');
  assert.equal(B.recall('trip', 'like', 'museum'), null, 'once is not enough');
  B.learn('trip', 'like', 'museum', 'like'); B.learn('trip', 'like', 'museum', 'like');
  const r = B.recall('trip', 'like', 'museum');
  assert.equal(r.value, 'like');
  assert.ok(r.confidence > 0.9);
  B.learn('trip', 'like', 'mall', 'like'); B.learn('trip', 'like', 'mall', 'dislike'); B.learn('trip', 'like', 'mall', 'like'); B.learn('trip', 'like', 'mall', 'dislike');
  assert.equal(B.recall('trip', 'like', 'mall'), null, 'half and half: no lesson');
  // numbers: lunch time
  [13 * 60 + 30, 13 * 60 + 15, 13 * 60 + 45, 13 * 60 + 30].forEach(m=>B.learn('trip', 'time', 'lunch', m));
  assert.equal(Math.round(B.recall('trip', 'time', 'lunch').value), 13 * 60 + 30);
  const id = B.recall('trip', 'like', 'museum').lesson.id;
  B.pin(id, 'dislike');
  B.learn('trip', 'like', 'museum', 'like');
  assert.equal(B.recall('trip', 'like', 'museum').value, 'dislike', 'your own answer is kept');
  B.forget(id);
  assert.equal(B.recall('trip', 'like', 'museum'), null);
});

test('sync: two devices merge; the newer lesson wins; forgetting spreads', ()=>{
  B._reset();
  B.learn('money', 'category', 'swiggy', 'Food'); B.learn('money', 'category', 'swiggy', 'Food'); B.learn('money', 'category', 'swiggy', 'Food');
  const other = B.exportAll();
  B._reset();
  B.learn('trip', 'like', 'market', 'like');
  assert.ok(B.merge(other));
  assert.equal(B.recall('money', 'category', 'swiggy').value, 'Food');
  const id = B.lessons({app: 'trip'})[0].id;
  const forgotten = {lessons: {}, forgotten: {[id]: Date.now() + 1000}};
  B.merge(forgotten);
  assert.equal(B.lessons({app: 'trip'}).length, 0);
});

test('opening hours in the ways guides write them', ()=>{
  const sat = '2026-12-26', fri = '2026-12-25', mon = '2026-12-28';
  const h1 = B.parseHours('Sa-Th 8:30AM-8:30PM, Fr 2:30PM-8:30PM');
  assert.equal(B.openDuring(h1, sat, 9 * 60, 11 * 60), true);
  assert.equal(B.openDuring(h1, fri, 9 * 60, 11 * 60), false);
  assert.equal(B.openDuring(h1, fri, 15 * 60, 16 * 60), true);
  const h2 = B.parseHours('Sun–Wed 10AM–10PM, Thu–Sat 10–midnight');
  assert.equal(B.openDuring(h2, sat, 22 * 60, 23 * 60 + 30), true);
  assert.equal(B.openDuring(h2, mon, 22 * 60, 23 * 60), false);
  const h3 = B.parseHours('9AM-5PM, closed Mondays');
  assert.equal(B.openDuring(h3, mon, 10 * 60, 11 * 60), false);
  assert.equal(B.openDuring(h3, sat, 10 * 60, 11 * 60), true);
  assert.equal(B.openDuring(B.parseHours('10:00-22:00'), sat, 21 * 60, 22 * 60), true);
  assert.equal(B.openDuring(B.parseHours('Open 24 hours'), sat, 2 * 60, 3 * 60), true);
  assert.equal(B.parseHours('check website'), null);
  assert.equal(B.openDuring(B.parseHours('2-8pm'), sat, 14 * 60, 15 * 60), true);
});

test('travel: walking when close, a cab otherwise', ()=>{
  const a = {lat: 25.2637, lng: 55.2972}, near = {lat: 25.2660, lng: 55.2990}, far = {lat: 25.1972, lng: 55.2744};   // Al Fahidi, a street away, Burj Khalifa
  assert.ok(B.km(a, far) > 7 && B.km(a, far) < 8.5);
  assert.ok(B.travelMin(a, near) <= 10);
  assert.ok(B.travelMin(a, far) >= 25 && B.travelMin(a, far) <= 40);
});

test('the day planner: open places, near each other, around lunch, best value first', ()=>{
  const hotel = {lat: 25.2530, lng: 55.2920};
  const c = (id, lat, lng, minutes, value, hours) => ({id, name: id, lat, lng, minutes, value, hours: hours ? B.parseHours(hours) : null});
  const candidates = [
    c('Dubai Museum', 25.2632, 55.2972, 90, 1.0, 'Sa-Th 8:30AM-8:30PM, Fr 2:30PM-8:30PM'),
    c('Al Fahidi', 25.2637, 55.2995, 60, 0.9),
    c('Textile Souk', 25.2640, 55.2960, 60, 0.7, '10AM-10PM'),
    c('Far Theme Park', 24.9, 55.0, 240, 0.8),
    c('Closed Friday museum', 25.2620, 55.2980, 60, 1.2, 'Sa-Th 9AM-5PM'),
  ];
  const lunch = {s: 13 * 60, e: 14 * 60, title: 'Lunch'};
  const day = B.planDay({date: '2026-12-25', window: {from: 9 * 60, until: 21 * 60}, start: hotel, busy: [lunch], candidates, max: 3});
  const names = day.stops.map(x=>x.c.id);
  assert.equal(names.length, 3, names.join());
  assert.ok(!names.includes('Closed Friday museum'), 'closed on Fridays');
  assert.ok(!names.includes('Far Theme Park'), 'too far for a day of short hops');
  day.stops.forEach(x=>{ assert.ok(x.e <= lunch.s - 20 || x.s >= lunch.e + 20, x.c.id + ' clashes with lunch'); });
  const museum = day.stops.find(x=>x.c.id === 'Dubai Museum');
  if(museum) assert.ok(museum.s >= 14 * 60 + 30, 'the museum opens at 14:30 on Fridays');
  for(let i = 1; i < day.stops.length; i++) assert.ok(day.stops[i].s >= day.stops[i - 1].e + 20);
});

test('understanding: the things people ask of a plan', ()=>{
  const u = t => B.understand(t);
  assert.deepEqual(u('Day 2 is too packed').map(a=>a.do + ':' + a.value), ['pace:relaxed']);
  assert.equal(u('Day 2 is too packed')[0].day.day, 2);
  assert.ok(u('we are vegetarian').some(a=>a.do === 'food' && a.value === 'vegetarian'));
  assert.ok(u('no temples, more food places').some(a=>a.do === 'dislike' && a.category === 'temple'));
  assert.ok(u('no temples, more food places').some(a=>a.do === 'like' && a.category === 'food'));
  assert.ok(u('I love museums and souks').filter(a=>a.do === 'like').length >= 2);
  const m = u('I have a meeting on the 14th at 3 pm').find(a=>a.do === 'fixed');
  assert.equal(m.min, 15 * 60); assert.equal(m.day.date, 14);
  assert.ok(u('keep the evening free on day 3').some(a=>a.do === 'free' && a.part === 'evening'));
  assert.ok(u('start the day at 10').some(a=>a.do === 'dayStart' && a.min === 600));
  assert.ok(u('my parents are with us, less walking please').some(a=>a.do === 'walking'));
  assert.deepEqual(u('hello there'), []);
});

test('what a place is', ()=>{
  assert.equal(B.categoryOf('Gold Souk'), 'market');
  assert.equal(B.categoryOf('Jumeirah Mosque'), 'mosque');
  assert.equal(B.categoryOf('Burj Khalifa'), 'view');
  assert.equal(B.categoryOf('Dubai Museum'), 'museum');
  assert.equal(B.categoryOf('The Dubai Mall'), 'mall');
  assert.equal(B.categoryOf('Zabeel Park'), 'park');
});
