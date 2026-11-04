#!/usr/bin/env python3
# Dayble Parakeet STT 서버 — 내 맥에서 영어 강의 음성을 글로 바꾼다. 무료·오프라인. (NVIDIA Parakeet-TDT 0.6B v3, MLX)
# 실행: ~/Dayble/parakeet/venv/bin/python parakeet_server.py   (launchd com.dayble.parakeet 가 자동 실행)
# 엔드포인트: GET /ping → {ok,ready,model,done,failed}   POST /stt (body: WAV 16-bit PCM) → {text, ms}
import json, os, struct, sys, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = 7378
MODEL = os.environ.get('PARAKEET_MODEL', 'mlx-community/parakeet-tdt-0.6b-v3')
ALLOW = ('https://fodepu.github.io', 'http://localhost', 'http://127.0.0.1')

model = None
ready = False
load_err = ''
lock = threading.Lock()
stats = {'done': 0, 'failed': 0}


def log(*a):
    print(time.strftime('%H:%M:%S'), *a, flush=True)


def load_model():
    global model, ready, load_err
    try:
        import mlx.core as mx
        from parakeet_mlx import from_pretrained
        from parakeet_mlx.audio import get_logmel
        t = time.time()
        model = from_pretrained(MODEL)
        sr = model.preprocessor_config.sample_rate
        model.generate(get_logmel(mx.zeros((sr,)), model.preprocessor_config))  # 워밍업
        ready = True
        log(f'모델 준비됨 {MODEL} ({time.time() - t:.1f}s, {sr}Hz)')
    except Exception as e:
        load_err = str(e)
        log('모델 로드 실패:', e)


def parse_wav(b):
    """WAV(16-bit PCM 또는 32-bit float) → (float32 mono, rate). ffmpeg 불필요."""
    import numpy as np
    if b[:4] != b'RIFF' or b[8:12] != b'WAVE':
        raise ValueError('WAV 아님')
    pos, fmt, data = 12, None, None
    while pos + 8 <= len(b):
        cid = b[pos:pos + 4]
        sz = struct.unpack('<I', b[pos + 4:pos + 8])[0]
        body = b[pos + 8:pos + 8 + sz]
        if cid == b'fmt ':
            fmt = struct.unpack('<HHIIHH', body[:16])
        elif cid == b'data':
            data = body
        pos += 8 + sz + (sz & 1)
    if not fmt or data is None:
        raise ValueError('WAV 형식 오류')
    tag, ch, rate, _, _, bits = fmt
    if bits == 16:
        x = np.frombuffer(data, dtype='<i2').astype(np.float32) / 32768.0
    elif bits == 32 and tag == 3:
        x = np.frombuffer(data, dtype='<f4').astype(np.float32)
    else:
        raise ValueError(f'지원 안 함: {bits}bit tag={tag}')
    if ch > 1:
        x = x[: len(x) // ch * ch].reshape(-1, ch).mean(axis=1)
    return x, rate


def resample(x, r0, r1):
    import numpy as np
    if r0 == r1 or len(x) == 0:
        return x
    n = int(len(x) * r1 / r0)
    return np.interp(np.linspace(0, len(x) - 1, n), np.arange(len(x)), x).astype(np.float32)


def transcribe(x, rate):
    import mlx.core as mx
    from parakeet_mlx.audio import get_logmel
    sr = model.preprocessor_config.sample_rate
    x = resample(x, rate, sr)
    if len(x) < sr * 0.3:
        return ''
    mel = get_logmel(mx.array(x).astype(mx.bfloat16), model.preprocessor_config)
    return model.generate(mel)[0].text.strip()


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def cors(self):
        o = self.headers.get('Origin', '')
        ok = any(o.startswith(a) for a in ALLOW)
        self.send_header('Access-Control-Allow-Origin', o if ok else ALLOW[0])
        self.send_header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'content-type')
        self.send_header('Access-Control-Allow-Private-Network', 'true')
        self.send_header('Access-Control-Max-Age', '600')

    def reply(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.cors()
        self.send_header('content-type', 'application/json; charset=utf-8')
        self.send_header('content-length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.cors()
        self.end_headers()

    def do_GET(self):
        if self.path.startswith('/ping'):
            return self.reply(200, {'ok': True, 'ready': ready, 'model': MODEL.split('/')[-1], 'error': load_err or None, **stats})
        self.reply(404, {'error': 'not found'})

    def do_POST(self):
        if not self.path.startswith('/stt'):
            return self.reply(404, {'error': 'not found'})
        if not ready:
            return self.reply(503, {'error': '모델 로딩 중' if not load_err else load_err})
        n = int(self.headers.get('content-length') or 0)
        raw = self.rfile.read(n) if n else b''
        t0 = time.time()
        try:
            x, rate = parse_wav(raw)
            with lock:
                text = transcribe(x, rate)
            ms = int((time.time() - t0) * 1000)
            stats['done'] += 1
            log(f'stt {len(x) / rate:.1f}s→{ms}ms', text[:70])
            self.reply(200, {'text': text, 'ms': ms})
        except Exception as e:
            stats['failed'] += 1
            log('stt ✗', e)
            self.reply(500, {'error': str(e)})


if __name__ == '__main__':
    threading.Thread(target=load_model, daemon=True).start()
    srv = ThreadingHTTPServer(('127.0.0.1', PORT), H)
    log(f'Dayble Parakeet 서버 — http://localhost:{PORT} (모델 로딩 중…)')
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
