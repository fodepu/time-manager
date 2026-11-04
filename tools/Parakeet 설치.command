#!/bin/bash
# Dayble Parakeet STT 설치 — 더블클릭 한 번. (영어 강의 음성인식을 내 맥에서, 무료·오프라인)
# 하는 일: uv 설치 확인 → ~/Dayble/parakeet/venv(Python 3.12) → parakeet-mlx 설치 → 모델(0.6B, 약 1.2GB) 다운로드
#          → launchd(com.dayble.parakeet) 등록해 항상 켜 둠 (포트 7378). 다시 실행하면 서버 파일·패키지 갱신.
set -e
D="$HOME/Dayble/parakeet"; mkdir -p "$D"
echo "== Dayble Parakeet 설치 ($D)"

# 1) 서버 파일 (GitHub 최신)
curl -fsSL -o "$D/parakeet_server.py" https://raw.githubusercontent.com/fodepu/time-manager/main/tools/parakeet_server.py
echo "서버 파일 받음"

# 2) uv (파이썬 패키지 관리자)
export PATH="$HOME/.local/bin:$HOME/.cargo/bin:/opt/homebrew/bin:$PATH"
if ! command -v uv >/dev/null 2>&1; then echo "uv 설치 중…"; curl -LsSf https://astral.sh/uv/install.sh | sh; export PATH="$HOME/.local/bin:$PATH"; fi
uv --version

# 3) 가상환경 + parakeet-mlx
[ -x "$D/venv/bin/python" ] || uv venv "$D/venv" --python 3.12
uv pip install --python "$D/venv/bin/python" -U parakeet-mlx
echo "parakeet-mlx 설치됨"

# 4) 모델 다운로드(처음 한 번, 약 1.2GB) + 동작 확인
echo "모델 다운로드/확인 중… (처음엔 몇 분 걸려요)"
"$D/venv/bin/python" - <<'PY'
from parakeet_mlx import from_pretrained
m = from_pretrained('mlx-community/parakeet-tdt-0.6b-v3')
print('모델 OK —', m.preprocessor_config.sample_rate, 'Hz')
PY

# 5) launchd 등록 (로그인 시 자동 실행, 죽으면 재시작)
PL="$HOME/Library/LaunchAgents/com.dayble.parakeet.plist"; mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PL" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.dayble.parakeet</string>
  <key>ProgramArguments</key><array><string>$D/venv/bin/python</string><string>$D/parakeet_server.py</string></array>
  <key>WorkingDirectory</key><string>$D</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$D/server.log</string>
  <key>StandardErrorPath</key><string>$D/server.log</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string><key>HOME</key><string>$HOME</string></dict>
</dict></plist>
EOF
launchctl bootout "gui/$(id -u)/com.dayble.parakeet" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PL"
echo "launchd 등록됨 — 서버 시작 대기…"
for i in $(seq 1 30); do sleep 2; if curl -fs localhost:7378/ping 2>/dev/null | grep -q '"ready": true'; then break; fi; done
echo; curl -s localhost:7378/ping; echo
echo
echo "완료. Dayble 강의노트 화면의 'STT' 버튼을 'Parakeet'로 바꾸면 영어 강의에서 내 맥이 음성인식을 해요."
echo "로그: $D/server.log   재설치/갱신: 이 파일을 다시 더블클릭"
