/* =========================================================
   RUNNER — the model's code, run so it can see what happens and fix it (write → run → read the error → fix),
   inside a macOS sandbox: no internet, no writing anywhere but its own scratch folder, a time limit, output capped.
     run({language, code, stdin}) -> {ok, exit, output, ms, language}
   Languages: python, javascript (node), c, c++ — whatever is installed here. Java needs an Apple-chip JDK.
   ========================================================= */
import {spawn, execFileSync} from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const ROOT = path.join(os.homedir(), '.money-ai', 'workspace');
const has = cmd => { try{ execFileSync('/bin/sh', ['-c', 'command -v ' + cmd], {stdio: 'ignore'}); return true; }catch(e){ return false; } };
const javaWorks = () => { try{ execFileSync('java', ['-version'], {stdio: 'ignore'}); return true; }catch(e){ return false; } };

const LANGS = {
  python: {file: 'main.py', run: f=>[['python3', ['-I', f]]], ok: ()=>has('python3')},
  javascript: {file: 'main.mjs', run: f=>[['node', [f]]], ok: ()=>has('node')},
  c: {file: 'main.c', run: f=>[['cc', ['-O1', '-o', 'main', f, '-lm']], ['./main', []]], ok: ()=>has('cc')},
  cpp: {file: 'main.cpp', run: f=>[['c++', ['-std=c++17', '-O1', '-o', 'main', f]], ['./main', []]], ok: ()=>has('c++')},
  java: {file: 'Main.java', run: f=>[['javac', [f]], ['java', ['-cp', '.', path.basename(f, '.java')]]], ok: javaWorks},
};
const ALIAS = {py: 'python', python3: 'python', js: 'javascript', node: 'javascript', nodejs: 'javascript', 'c++': 'cpp', cxx: 'cpp'};
export const languages = () => Object.keys(LANGS).filter(l=>LANGS[l].ok());

// the sandbox: everything allowed except the network and writing outside this run's folder (and Apple's own tool cache)
const profile = dir => `(version 1)
(allow default)
(deny network*)
(deny file-write*)
(allow file-write* (subpath "${dir}") (literal "/dev/null") (literal "/dev/stdout") (literal "/dev/stderr") (literal "/dev/tty") (regex #"^/dev/fd/"))
(allow file-write* (regex #"^/private/var/folders/[^/]+/[^/]+/T/xcrun_db"))
`;

function step(cmd, args, dir, stdin, ms){
  return new Promise(res=>{
    const t0 = Date.now();
    const p = spawn('/usr/bin/sandbox-exec', ['-f', path.join(dir, '.sandbox.sb'), cmd, ...args], {cwd: dir, env: {PATH: process.env.PATH, HOME: dir, TMPDIR: dir + '/', LANG: 'en_US.UTF-8'}});
    let out = '', killed = false;
    const add = d => { if(out.length < 12000) out += d; };
    p.stdout.on('data', add); p.stderr.on('data', add);
    const timer = setTimeout(()=>{ killed = true; p.kill('SIGKILL'); }, ms);
    p.on('close', code=>{ clearTimeout(timer); res({exit: killed ? 'timeout' : code, output: out, ms: Date.now() - t0}); });
    p.on('error', e=>{ clearTimeout(timer); res({exit: 'error', output: String(e.message), ms: Date.now() - t0}); });
    if(stdin) p.stdin.write(String(stdin));
    p.stdin.end();
  });
}

// a file name that is safe in the sandbox folder ("Sales Q3 — Sheet1.csv" -> "Sales_Q3_Sheet1.csv")
export const safeName = n => String(n || 'file').replace(/\.[^.]+$/, m=>m.toLowerCase()).replace(/[^\w.\-]+/g, '_').replace(/_+/g, '_').replace(/^[_.]+/, '').slice(-80) || 'file';
export async function run({language, code, stdin, files}){
  const lang = ALIAS[String(language || '').toLowerCase()] || String(language || '').toLowerCase();
  const L = LANGS[lang];
  if(!L) return {ok: false, output: 'I can run: ' + languages().join(', ') + '.', language: lang};
  if(!L.ok()) return {ok: false, output: lang === 'java' ? 'Java is not runnable on this Mac (the installed JDK is for Intel chips). Install one for Apple chips: brew install openjdk.' : lang + ' is not installed here.', language: lang};
  code = String(code || '');
  if(code.length > 60000) return {ok: false, output: 'The program is too long to run here.', language: lang};
  const dir = fs.mkdtempSync(path.join((fs.mkdirSync(ROOT, {recursive: true, mode: 0o700}), ROOT), 'run-'));
  fs.writeFileSync(path.join(dir, '.sandbox.sb'), profile(fs.realpathSync(dir)));
  // Java: the file is named after its public class
  let file = L.file;
  if(lang === 'java'){ const m = /public\s+(?:final\s+)?class\s+(\w+)/.exec(code); if(m) file = m[1] + '.java'; }
  fs.writeFileSync(path.join(dir, file), code);
  // the user's attached files, there to be opened by name (open('sales.csv'))
  for(const f of (files || []).slice(0, 40)) if(f && f.text != null) fs.writeFileSync(path.join(dir, safeName(f.name)), String(f.text).slice(0, 5e6));
  let output = '', exit = 0, ms = 0;
  for(const [cmd, args] of L.run(file)){
    const r = await step(cmd, args, fs.realpathSync(dir), stdin, 20000);
    output += r.output; ms += r.ms; exit = r.exit;
    if(r.exit !== 0) break;                                     // a compile error stops before running
  }
  // keep the last 20 runs only
  try{ fs.readdirSync(ROOT).filter(d=>d.startsWith('run-')).map(d=>({d, t: fs.statSync(path.join(ROOT, d)).mtimeMs})).sort((a, b)=>b.t - a.t).slice(20).forEach(x=>fs.rmSync(path.join(ROOT, x.d), {recursive: true, force: true})); }catch(e){}
  return {ok: exit === 0, exit, output: output.trim().slice(0, 6000) || '(no output)', ms, language: lang};
}
