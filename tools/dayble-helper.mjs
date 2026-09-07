#!/usr/bin/env node
// Dayble 로컬 도우미 — 앱의 실시간 필기 요청을 받아 내 맥의 Claude Code(구독)로 처리한다. API 비용 없음.
// 실행: node dayble-helper.mjs   (수업 전에 켜두고, 끝나면 Ctrl+C)
import http from 'node:http';
import { spawn } from 'node:child_process';

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

function runClaude(system, user) {
  return new Promise((resolve, reject) => {
    const args = ['-p', '--output-format', 'text', '--model', MODEL, '--max-turns', '1', '--system-prompt', system];
    const p = spawn('claude', args, { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, PATH: (process.env.HOME + '/.local/bin:' + process.env.HOME + '/.claude/local:' + (process.env.PATH || '')), CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' } });
    let out = '', err = '';
    const timer = setTimeout(() => { p.kill('SIGKILL'); reject(new Error('timeout (60s)')); }, 60000);
    p.stdout.on('data', d => out += d);
    p.stderr.on('data', d => err += d);
    p.on('error', e => { clearTimeout(timer); reject(e); });
    p.on('close', code => { clearTimeout(timer); if (code === 0) resolve(out.trim()); else reject(new Error('claude exit ' + code + ': ' + err.slice(0, 300))); });
    p.stdin.end(user);
  });
}

const server = http.createServer(async (req, res) => {
  cors(req, res);
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  if (req.url === '/ping') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ ok: true, engine: 'claude-code', model: MODEL, busy, done, failed })); }
  if (req.method === 'POST' && req.url === '/notes') {
    let body = ''; req.on('data', d => body += d);
    req.on('end', async () => {
      try {
        const { system, user } = JSON.parse(body || '{}');
        if (!system || !user) throw new Error('system/user 필요');
        busy++; const t0 = Date.now();
        const text = await runClaude(system, user);
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
  console.log('Dayble 녹음 화면의 AI 필기 버튼이 "✦ Claude 필기 (내 맥)"로 바뀌면 연결된 거예요. 끝나면 Ctrl+C\n');
  // 시작 시 Claude Code 로그인 확인
  runClaude('Reply with exactly: ok', 'ping').then(t => console.log('Claude Code 확인:', t.slice(0, 40))).catch(e => console.log('⚠ Claude Code 호출 실패 —', e.message, '\n  터미널에서 `claude` 를 한 번 실행해 로그인(구독 계정)돼 있는지 확인하세요.'));
});
