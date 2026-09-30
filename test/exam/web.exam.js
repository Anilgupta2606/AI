/* THE WEB EXAM — questions beyond the apps. Calculators are checked to the rupee (worked by hand below); live answers
   (Wikidata, Wikipedia, rates, weather, time) must contain the right fact. Needs the internet.
   Run: node test/exam/web.exam.js [fresh] */
// Wikimedia asks programs to say who they are (a browser does this by itself)
const _fetch = global.fetch;
global.fetch = (url, o) => _fetch(url, Object.assign({}, o, {headers: Object.assign({'User-Agent': 'MoneyHome-exam/1.0 (personal app test; https://anilgupta2606.github.io)'}, (o || {}).headers)}));
const W = require('../../engine/web.js');
// EMI 50 L, 8.5%, 20 y = 43,391; SIP 10,000 x 15 y @ 12% = 50.46 L; 1 L -> 2.5 L in 6 y = 16.50%; 5 L @ 7% x 10 y = 9.84 L
const EXAM = [
  ['EMI for 50 lakh at 8.5% for 20 years', ['₹43,391']],
  ['SIP of 10000 for 15 years at 12%', ['₹50.46 L']],
  ['CAGR from 1 lakh to 2.5 lakh in 6 years', ['16.50%']],    // key corrected: 2.5^(1/6) - 1 = 16.499%
  ['what will 5 lakh become at 7% for 10 years', ['₹9.84 L']],
  ['18% GST on 2500', ['₹450', '₹2,950']],
  ['what is 15% of 1200', ['180']],
  ['what is 23*47+12', ['1,093']],
  ['100 km to miles', ['62.14']],
  ['37 c to f', ['98.6']],
  ['how much is 2.5 crores in millions', ['25']],
  ['convert 100 usd to inr', ['₹', 'USD']],
  ['500 dirham to rupees', ['₹', 'AED']],
  ['capital of Australia', ['Canberra']],
  ['population of Japan', ['million']],
  ['currency of Thailand', ['baht']],
  ['who wrote Gitanjali', ['Tagore']],
  ['who directed Sholay', ['Ramesh Sippy']],
  ['when was ISRO founded', ['1969']],
  ['who founded Infosys', ['Murthy']],
  ['how tall is Mount Everest', ['8,8']],
  ['define inflation', ['increase']],
  ['what time is it in Dubai', ['Asia/Dubai', 'behind India']],
  ['weather in Jaipur tomorrow', ['Jaipur', '°C']],
  ['why is the sky blue', ['scatter']],
  ['what is photosynthesis', ['light']],
  ['what is the Sensex', ['BSE']],
  ['what is a mutual fund', ['invest']],
];
const FRESH = [
  ['EMI for 10 lakh at 10% for 5 years', ['₹21,247']],
  ['12% gst on 10000', ['₹1,200', '₹11,200']],
  ['what is (1250+750)/8', ['250']],
  ['capital of Canada', ['Ottawa']],
  ['who wrote Godan', ['Premchand']],
  ['currency of Japan', ['yen']],
  ['what is the meaning of frugal', ['expenditure']],       // key corrected: Wiktionary says "careful or wise in expenditure"
  ['what is GDP', ['goods and services']],
  ['1000 euro to inr', ['₹', 'EUR']],
  ['what time is it in London', ['Europe/London']],
];
(async ()=>{
  const set = process.argv[2] === 'fresh' ? FRESH : EXAM;
  let ok = 0;
  for(const [q, want] of set){
    let r = null;
    try{ r = await W.answer(q); }catch(e){ r = {text: 'ERROR ' + e.message}; }
    await new Promise(res=>setTimeout(res, 1200));            // a polite pace for the free services
    const good = r && want.every(w=>r.text.toLowerCase().includes(w.toLowerCase()));
    if(good) ok++; else console.log(`  ✗ "${q}"\n      ${r ? r.text.slice(0, 300) : 'no answer'}\n      should contain: ${want.join(' | ')}`);
  }
  console.log(`${process.argv[2] === 'fresh' ? 'FRESH WEB SET' : 'WEB EXAM'}: ${ok} / ${set.length} = ${Math.round(ok / set.length * 100)}%`);
  process.exit(ok === set.length ? 0 : 1);
})();
