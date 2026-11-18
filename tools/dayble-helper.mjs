#!/usr/bin/env node
// Dayble 로컬 도우미 — 앱의 필기·PDF 학습·번역 요청을 받아 Claude로 처리한다.
// 엔진: ~/Dayble/.dayble-key 가 있으면 Claude API(Max에 포함된 API 크레딧) 직접 호출, 없거나 API가 실패하면 Claude Code(구독)로 자동 대체.
// 키는 파일에서 매 요청마다 읽으므로 키를 넣거나 바꿔도 재시작 불필요. 키를 환경변수(ANTHROPIC_API_KEY)로 두지 말 것 — Claude Code까지 API 과금으로 바뀜.
// 실행: node dayble-helper.mjs   (수업 전에 켜두고, 끝나면 Ctrl+C)
import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

// 필기법.md — 사용자의 필기 지침. 있으면 매 요청마다 읽어 시스템 프롬프트 뒤에 붙인다 (수정 즉시 반영, 재시작 불필요)
const STYLE_FILE = path.join(path.dirname(new URL(import.meta.url).pathname), '필기법.md');
function styleText() { try { return fs.readFileSync(STYLE_FILE, 'utf8').trim(); } catch { return ''; } }

const PORT = 7377;
const ALLOW = new Set(['https://fodepu.github.io', 'http://localhost', 'http://127.0.0.1']);
const MODEL = process.env.DAYBLE_MODEL || 'sonnet';   // Claude Code 대체용: sonnet | haiku | opus
const API_MODEL = process.env.DAYBLE_API_MODEL || 'claude-sonnet-5-5';
const PRICE = { in: 2, out: 10, cacheRead: 0.2, cacheWrite: 2.5 };   // Sonnet 5.5, $/MTok (캐시 읽기 0.1×, 쓰기 1.25×)
const HERE = path.dirname(new URL(import.meta.url).pathname);
const KEY_FILE = path.join(HERE, '.dayble-key');
const USAGE_FILE = path.join(HERE, 'usage.json');
function apiKey() { try { const k = fs.readFileSync(KEY_FILE, 'utf8').trim(); return /^sk-ant-/.test(k) ? k : ''; } catch { return ''; } }
function month() { return new Date().toISOString().slice(0, 7); }
function loadUsage() { try { const u = JSON.parse(fs.readFileSync(USAGE_FILE, 'utf8')); return u && u.month === month() ? u : { month: month(), calls: 0, cost: 0, inTok: 0, outTok: 0, cacheRead: 0 }; } catch { return { month: month(), calls: 0, cost: 0, inTok: 0, outTok: 0, cacheRead: 0 }; } }
let usage = loadUsage(), lastEngine = '', apiErr = '';
function addUsage(u) { if (usage.month !== month()) usage = loadUsage(); const i = u.input_tokens || 0, o = u.output_tokens || 0, cr = u.cache_read_input_tokens || 0, cw = u.cache_creation_input_tokens || 0;
  usage.calls++; usage.inTok += i + cr + cw; usage.outTok += o; usage.cacheRead += cr; usage.cost += (i * PRICE.in + o * PRICE.out + cr * PRICE.cacheRead + cw * PRICE.cacheWrite) / 1e6;
  try { fs.writeFileSync(USAGE_FILE, JSON.stringify(usage, null, 1)); } catch {} }
async function runAPI(system, user, key) {
  const ac = new AbortController(); const timer = setTimeout(() => ac.abort(), 150000);
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', signal: ac.signal,
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: API_MODEL, max_tokens: 8000, system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }], messages: [{ role: 'user', content: user }] }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error('API ' + r.status + ': ' + ((j.error && j.error.message) || '').slice(0, 200)); e.status = r.status; throw e; }
    if (j.usage) addUsage(j.usage);
    return (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('').trim();
  } finally { clearTimeout(timer); }
}
// 엔진 선택: 키 있으면 API, 실패하면 Claude Code로 대체(크레딧 소진·키 오류·네트워크 문제에도 필기가 멈추지 않게)
async function runLLM(system, user) {
  const key = apiKey();
  if (key) {
    try { const t = await runAPI(system, user, key); lastEngine = 'api'; apiErr = ''; return t; }
    catch (e) { apiErr = e.message; console.log(new Date().toLocaleTimeString('ko-KR'), '⚠ API 실패 → Claude Code로 대체:', e.message); }
  }
  lastEngine = 'claude-code'; return runClaude(system, user);
}
let busy = 0, done = 0, failed = 0;

function cors(req, res) {
  const o = req.headers.origin || '';
  const ok = [...ALLOW].some(a => o.startsWith(a));
  res.setHeader('Access-Control-Allow-Origin', ok ? o : 'https://fodepu.github.io');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  res.setHeader('Access-Control-Max-Age', '600');
}

let noToolsFlag = true;   // --tools "" 로 도구 설명을 빼서 프롬프트를 줄임 (미지원 CLI면 자동 해제)
function runClaude(system, user, noSys) {
  return new Promise((resolve, reject) => {
    const args = ['-p', '--output-format', 'text', '--model', MODEL, '--max-turns', '1'];
    if (noToolsFlag) args.push('--tools', '');
    if (!noSys) args.push('--system-prompt', system);
    const p = spawn('claude', args, { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, PATH: (process.env.HOME + '/.local/bin:' + process.env.HOME + '/.claude/local:' + (process.env.PATH || '')), CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' } });
    let out = '', err = '';
    const timer = setTimeout(() => { p.kill('SIGKILL'); reject(new Error('timeout (150s)')); }, 150000);
    p.stdout.on('data', d => out += d);
    p.stderr.on('data', d => err += d);
    p.on('error', e => { clearTimeout(timer); reject(e); });
    p.on('close', code => { clearTimeout(timer);
      if (code === 0) return resolve(out.trim());
      const msg = (err + ' ' + out).trim();
      if (noToolsFlag && /unknown option|unrecognized|--tools/i.test(msg)) { noToolsFlag = false; return resolve(runClaude(system, user, noSys)); }
      if (!noSys && /unknown option|unrecognized|--system-prompt/i.test(msg)) return resolve(runClaude(system, user, true));
      reject(new Error('claude exit ' + code + ': ' + msg.replace(/\s+/g, ' ').slice(0, 300))); });
    p.stdin.end(noSys ? (system + '\n\n---\n\n' + user) : user);
  });
}

// 한 번에 하나만 실행. 실행 중에 새 요청이 오면 대기, 대기 중인 게 이미 있으면 그건 버림(최신만 유지)
let running = false, waiting = null;
function runQueued(system, user) {
  return new Promise((resolve, reject) => {
    if (waiting) { waiting.reject(new Error('superseded')); waiting = null; }
    const job = { system, user, resolve, reject };
    if (running) { waiting = job; return; }
    exec(job);
  });
  function exec(job) {
    running = true;
    runLLM(job.system, job.user).then(job.resolve, job.reject).finally(() => {
      running = false;
      if (waiting) { const w = waiting; waiting = null; exec(w); }
    });
  }
}

// whisper.cpp 탐색: 실행 파일(whisper-cli / whisper-cpp / main) + 모델(~/Dayble/models/*.bin 또는 WHISPER_MODEL)
let _wh = null;
function whisperInfo() {
  if (_wh) return _wh;
  const cands = ['whisper-cli', 'whisper-cpp', 'whisper'];
  let bin = null;
  for (const c of cands) { try { bin = execFileSync('sh', ['-c', 'command -v ' + c], { env: { ...process.env, PATH: process.env.PATH + ':/opt/homebrew/bin:/usr/local/bin' } }).toString().trim(); if (bin) break; } catch {} }
  const modelDir = path.join(path.dirname(new URL(import.meta.url).pathname), 'models');
  let model = process.env.WHISPER_MODEL || null;
  if (!model) { try { const fs2 = fs.readdirSync(modelDir).filter(f => f.endsWith('.bin')).sort((a, b) => fs.statSync(path.join(modelDir, b)).size - fs.statSync(path.join(modelDir, a)).size); if (fs2.length) model = path.join(modelDir, fs2[0]); } catch {} }
  if (!bin) return { ok: false, error: 'whisper-cpp 미설치 (brew install whisper-cpp)' };
  if (!model) return { ok: false, error: '모델 파일 없음 (~/Dayble/models/ggml-large-v3-turbo.bin)' };
  _wh = { ok: true, bin, model: path.basename(model), modelPath: model };
  return _wh;
}
function runWhisper(w, wav, lang, prompt) {
  return new Promise((resolve, reject) => {
    const args = ['-m', w.modelPath, '-l', lang, '-f', wav, '-nt', '-np', '-t', String(Math.max(2, Math.min(8, os.cpus().length - 2))), '--no-timestamps'];
    if (prompt) args.push('--prompt', prompt);
    const p = spawn(w.bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = ''; const timer = setTimeout(() => { p.kill('SIGKILL'); reject(new Error('whisper timeout')); }, 30000);
    p.stdout.on('data', d => out += d); p.stderr.on('data', d => err += d);
    p.on('error', e => { clearTimeout(timer); reject(e); });
    p.on('close', code => { clearTimeout(timer); if (code !== 0 && !out.trim()) return reject(new Error('whisper exit ' + code + ': ' + err.slice(-200))); resolve(out.replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim()); });
  });
}

const server = http.createServer(async (req, res) => {
  cors(req, res);
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  // ---- Whisper (whisper.cpp) — 한국어 인식, 무료·오프라인. brew install whisper-cpp + 모델 파일 필요 ----
  if (req.url === '/stt/ping') { const w = whisperInfo(); res.writeHead(w.ok ? 200 : 501, { 'content-type': 'application/json' }); return res.end(JSON.stringify(w)); }
  if (req.method === 'POST' && req.url.startsWith('/stt')) {
    const chunks = []; req.on('data', d => chunks.push(d));
    req.on('end', async () => {
      const w = whisperInfo(); if (!w.ok) { res.writeHead(501, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: w.error })); }
      const u = new URL(req.url, 'http://x'); const lang = u.searchParams.get('lang') || 'ko'; const prompt = (u.searchParams.get('prompt') || '').slice(0, 300);
      const tmp = path.join(os.tmpdir(), 'dayble-stt-' + Date.now() + '.wav');
      try {
        fs.writeFileSync(tmp, Buffer.concat(chunks)); const t0 = Date.now();
        const text = await runWhisper(w, tmp, lang, prompt);
        console.log(new Date().toLocaleTimeString('ko-KR'), `stt ${Math.round((Date.now() - t0) / 1000)}s`, text.slice(0, 60));
        res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ text }));
      } catch (e) { console.log(new Date().toLocaleTimeString('ko-KR'), 'stt ✗', e.message); res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: e.message })); }
      finally { try { fs.unlinkSync(tmp); } catch {} }
    });
    return;
  }
  if (req.url === '/ping') { res.writeHead(200, { 'content-type': 'application/json' }); const key = !!apiKey(); if (usage.month !== month()) usage = loadUsage(); return res.end(JSON.stringify({ ok: true, engine: key ? 'api' : 'claude-code', model: key ? API_MODEL : MODEL, lastEngine, apiErr: apiErr || undefined, month: usage.month, calls: usage.calls, cost: Math.round(usage.cost * 100) / 100, busy, done, failed })); }
  if (req.method === 'POST' && req.url === '/notes') {
    let body = ''; req.on('data', d => body += d);
    req.on('end', async () => {
      try {
        const { system, user } = JSON.parse(body || '{}');
        if (!system || !user) throw new Error('system/user 필요');
        busy++; const t0 = Date.now();
        const st = styleText();
        const sys = st ? system + '\n\n# 사용자의 필기법 (반드시 따를 것)\n' + st : system;
        let text = await runQueued(sys, user);
        text = String(text).replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
        busy--; done++;
        console.log(new Date().toLocaleTimeString('ko-KR'), `✓ ${Math.round((Date.now() - t0) / 1000)}s`, text.replace(/\s+/g, ' ').slice(0, 90));
        res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ text }));
      } catch (e) {
        busy = Math.max(0, busy - 1); failed++;
        console.log(new Date().toLocaleTimeString('ko-KR'), '✗', e.message);
        res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }
  res.writeHead(404); res.end();
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\nDayble 도우미 실행 중 — http://localhost:${PORT}  (엔진: ${apiKey() ? 'Claude API ' + API_MODEL : 'Claude Code ' + MODEL})  이번 달 API $${usage.cost.toFixed(2)} / ${usage.calls}회`);
  { const w = whisperInfo(); console.log(w.ok ? 'Whisper 준비됨: ' + w.model : 'Whisper 없음 — ' + w.error + ' (한국어 인식을 내 맥에서 하려면 설치)'); }
  console.log(styleText() ? '필기법.md 적용 중 (' + styleText().length + '자)' : '필기법.md 없음 — 기본 지침으로 동작');
  console.log('Dayble 녹음 화면의 AI 필기 버튼이 "✱ Claude 필기 (내 맥)"로 바뀌면 연결된 거예요. 끝나면 Ctrl+C\n');
  // 시작 시 Claude Code 로그인 확인
  runClaude('Reply with exactly: ok', 'ping').then(t => console.log('Claude Code 확인:', t.slice(0, 40))).catch(e => console.log('⚠ Claude Code 호출 실패 —', e.message, '\n  터미널에서 `claude` 를 한 번 실행해 로그인(구독 계정)돼 있는지 확인하세요.'));
});
