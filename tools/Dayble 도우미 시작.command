#!/bin/bash
# 더블클릭하면 터미널이 열리고 Dayble 로컬 도우미가 켜집니다. 창을 닫으면 꺼져요.
cd "$(dirname "$0")"
export PATH="$HOME/.local/bin:$HOME/.claude/local:$PATH:/usr/local/bin:/opt/homebrew/bin:$HOME/.npm-global/bin"
if ! command -v claude >/dev/null 2>&1; then
  echo "Claude Code가 없어요. 먼저 설치: npm install -g @anthropic-ai/claude-code  →  터미널에서 claude 실행해 로그인"
  read -n 1 -s -r -p "아무 키나 누르면 닫힘"; exit 1
fi
node dayble-helper.mjs
