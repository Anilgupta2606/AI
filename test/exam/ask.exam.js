/* THE ASK EXAM — questions about your own money and trips, answered from a known set of data; each answer must contain
   the right figure (worked out by hand below). Run: node test/exam/ask.exam.js  [fresh] */
const Ask = require('../../engine/ask.js');
const T = (date, amount, kind, category, merchantName, direction) => ({date, amount, kind, category, merchantName, direction: direction || (kind === 'income' ? 'credit' : 'debit')});
// Jul-Sep 2026: salary 1,50,000 each month; spending by category; investments; a refund
const txns = [
  T('2026-07-01', 150000, 'income', 'Salary', 'Acme Technologies'),
  T('2026-07-05', 1200, 'spend', 'Food & Dining', 'Swiggy'), T('2026-07-12', 800, 'spend', 'Food & Dining', 'Zomato'),
  T('2026-07-08', 4500, 'spend', 'Groceries', 'Blinkit'), T('2026-07-15', 25000, 'spend', 'Rent & Housing', 'NoBroker'),
  T('2026-07-20', 10000, 'investment', 'Mutual Funds', 'PPFAS MF'),
  T('2026-08-01', 150000, 'income', 'Salary', 'Acme Technologies'),
  T('2026-08-03', 2400, 'spend', 'Food & Dining', 'Swiggy'), T('2026-08-09', 1600, 'spend', 'Food & Dining', 'Zomato'),
  T('2026-08-10', 5200, 'spend', 'Groceries', 'Blinkit'), T('2026-08-15', 25000, 'spend', 'Rent & Housing', 'NoBroker'),
  T('2026-08-18', 3000, 'spend', 'Fuel', 'Indian Oil'), T('2026-08-22', 12000, 'spend', 'Shopping', 'Amazon'),
  T('2026-08-23', 2000, 'spend', 'Shopping', 'Amazon', 'credit'),                 // a refund
  T('2026-08-20', 10000, 'investment', 'Mutual Funds', 'PPFAS MF'), T('2026-08-25', 5000, 'investment', 'Stocks', 'Zerodha'),
  T('2026-09-01', 150000, 'income', 'Salary', 'Acme Technologies'),
  T('2026-09-02', 3000, 'spend', 'Food & Dining', 'Swiggy'), T('2026-09-06', 900, 'spend', 'Transport', 'Uber'),
  T('2026-09-10', 6100, 'spend', 'Groceries', 'Blinkit'), T('2026-09-15', 25000, 'spend', 'Rent & Housing', 'NoBroker'),
  T('2026-09-18', 1499, 'spend', 'Subscriptions', 'Netflix'), T('2026-09-20', 10000, 'investment', 'Mutual Funds', 'PPFAS MF'),
  T('2026-09-24', 8000, 'spend', 'Travel', 'MakeMyTrip'),
  T('2026-10-12', 3500, 'spend', 'Food & Dining', 'Fisherman Wharf'), T('2026-10-13', 1500, 'spend', 'Transport', 'Goa Taxi'),   // on the Goa trip
];
const data = {today: '2026-10-20', txns,
  ledger: {netWorth: 4.2e6, corpus: 3.8e6, targetLow: 3, targetHigh: 4, retire: 55, yearsLeft: 23.2, sip: 10000},
  trips: [{name: 'Goa with friends', city: 'Goa', start: '2026-10-12', end: '2026-10-16'}, {name: 'Dubai with family', city: 'Dubai', start: '2026-12-23', end: '2026-12-28'}],
  docs: [{label: 'Passport', person: 'Anil Gupta', validUntil: '2027-01-15'}, {label: 'Driving licence', person: 'Anil Gupta', validUntil: '2035-03-13'}]};
// October: 3,500 + 1,500 = 5,000 spent. September: 3,000+900+6,100+25,000+1,499+8,000 = 44,499. August: 2,400+1,600+5,200+25,000+3,000+12,000-2,000 = 47,200.
const EXAM = [
  ['How much did I spend last month?', ['₹44,499']],
  ['How much did I spend in August?', ['₹47,200']],
  ['How much did I spend on food last month?', ['₹3,000']],
  ['how much on food in august', ['₹4,000']],
  ['What did I spend on groceries in July?', ['₹4,500']],
  ['How much did I spend on Swiggy this year?', ['₹6,600']],
  ['How much went to Amazon in August?', ['₹12,000']],
  ['Where did my money go last month?', ['₹44,499', 'Rent & Housing ₹25,000']],
  ['What did I spend the most on in August?', ['Rent & Housing ₹25,000']],
  ['Did I spend more than last month in September?', ['₹44,499', '₹47,200', 'less']],
  ['How much did I earn in September?', ['₹1,50,000']],
  ['What was my income last month?', ['₹1,50,000']],
  ['How much did I invest in August?', ['₹15,000']],
  ['How much did I save last month?', ['₹1,05,501']],
  ['how much did I spend on rent in the last 3 months', ['₹75,000']],
  ['How much did I spend on food and groceries in September?', ['₹9,100']],
  ['What did the Goa trip cost?', ['₹5,000']],
  ['How much did we spend on the Goa trip?', ['₹5,000']],
  ['When is my next trip?', ['Dubai', '64 days']],
  ['How many days until our trip?', ['64 days']],
  ['Which documents expire soon?', ['Passport', '15 Jan 2027']],
  ['Do any of my documents need renewing?', ['Passport']],
  ['What is my net worth?', ['₹42.00 L']],
  ['What is my SIP?', ['₹10,000']],
  ['Am I on track for my retirement target?', ['₹38.00 L', '9.5%']],
  ['How much did I spend on petrol in August?', ['₹3,000']],
  ['how much did I spend on netflix', ['₹1,499']],
  ['hello', null],
  ['What is the capital of France?', null],
];
const FRESH = [
  ['What did I spend in total in September?', ['₹44,499']],
  ['how much money did i spend on eating out in july', ['₹2,000']],
  ['spending on cabs last month?', ['₹900']],
  ['my salary in august', ['₹1,50,000']],
  ['how much have I invested this year', ['₹35,000']],          // key corrected: 10,000 + 15,000 + 10,000
  ['total spent on blinkit in the last 3 months', ['₹15,800']],  // key corrected: Jul-Sep 4,500 + 5,200 + 6,100
  ['what is my savings rate for september', ['₹1,05,501']],
  ['compare this month vs last month spending', ['₹5,000', '₹44,499']],
  ['what did the dubai trip cost', ['₹0']],
  ['when do we fly next', ['Dubai']],
  ['is my passport expiring', ['Passport']],
  ['how far am I from my retirement goal', ['₹38.00 L']],
  ['how much is my monthly SIP', ['₹10,000']],
  ['kharcha last month kitna hua', ['₹44,499']],
  ['tell me a joke', null],
];
const which = process.argv[2] === 'fresh' ? FRESH : EXAM;
let ok = 0;
which.forEach(([q, want])=>{
  const r = Ask.answer(q, data);
  const good = want === null ? r === null : r && want.every(w=>r.text.includes(w));
  if(good) ok++; else console.log(`  ✗ "${q}"\n      ${r ? r.text : 'no answer'}${want ? '\n      should contain: ' + want.join(' | ') : '\n      should be left to the AI'}`);
});
console.log(`${process.argv[2] === 'fresh' ? 'FRESH ASK SET' : 'ASK EXAM'}: ${ok} / ${which.length} = ${Math.round(ok / which.length * 100)}%`);
// the AI's answers checked: an invented figure is flagged
const known = 'Spent ₹44,499 in September; rent ₹25,000; SIP ₹10,000; corpus ₹38.00 L';
const flagged = Ask.checkFigures('You spent ₹44,499 in September, mostly rent (₹25,000), and your SIP of ₹12,500 is on track.', known);
console.log('invented figures flagged:', JSON.stringify(flagged));
process.exit(ok === which.length ? 0 : 1);
