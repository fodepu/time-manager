#!/usr/bin/env node
// Dayble 로컬 도우미 — 앱의 실시간 필기 요청을 받아 내 맥의 Claude Code(구독)로 처리한다. API 비용 없음.
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
const MODEL = process.env.DAYBLE_MODEL || 'sonnet';   // sonnet | haiku | opus
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
    const timer = setTimeout(() => { p.kill('SIGKILL'); reject(new Error('timeout (60s)')); }, 60000);
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
    runClaude(job.system, job.user).then(job.resolve, job.reject).finally(() => {
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
  if (req.url === '/ping') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ ok: true, engine: 'claude-code', model: MODEL, busy, done, failed })); }
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
  console.log(`\nDayble 도우미 실행 중 — http://localhost:${PORT}  (모델: ${MODEL})`);
  { const w = whisperInfo(); console.log(w.ok ? 'Whisper 준비됨: ' + w.model : 'Whisper 없음 — ' + w.error + ' (한국어 인식을 내 맥에서 하려면 설치)'); }
  console.log(styleText() ? '필기법.md 적용 중 (' + styleText().length + '자)' : '필기법.md 없음 — 기본 지침으로 동작');
  console.log('Dayble 녹음 화면의 AI 필기 버튼이 "✦ Claude 필기 (내 맥)"로 바뀌면 연결된 거예요. 끝나면 Ctrl+C\n');
  // 시작 시 Claude Code 로그인 확인
  runClaude('Reply with exactly: ok', 'ping').then(t => console.log('Claude Code 확인:', t.slice(0, 40))).catch(e => console.log('⚠ Claude Code 호출 실패 —', e.message, '\n  터미널에서 `claude` 를 한 번 실행해 로그인(구독 계정)돼 있는지 확인하세요.'));
});
