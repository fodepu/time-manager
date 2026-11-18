#!/bin/bash
# Dayble 도우미가 Claude API(Max에 포함된 API 크레딧)를 쓰도록 키를 저장한다. 키는 화면에 표시되지 않고 이 맥의 ~/Dayble/.dayble-key 에만 저장됨.
# 키를 빼고 Claude Code(구독)로 돌아가려면: 이 파일을 다시 실행해서 빈 칸으로 엔터.
D="$HOME/Dayble"; F="$D/.dayble-key"; mkdir -p "$D"
echo "== Dayble API 키 넣기"
echo "console.anthropic.com → API Keys 에서 만든 키(sk-ant-로 시작)를 붙여넣고 엔터 (입력 내용은 보이지 않아요)."
echo "빈 칸으로 엔터하면 키를 지우고 Claude Code(구독)로 돌아가요."
read -r -s -p "키: " KEY; echo
KEY="$(printf '%s' "$KEY" | tr -d '[:space:]')"
if [ -z "$KEY" ]; then
  rm -f "$F"; echo "키를 지웠어요 — 이제 Claude Code(구독)로 동작합니다."
else
  case "$KEY" in sk-ant-*) ;; *) echo "⚠ sk-ant- 로 시작하는 키가 아니에요. 저장하지 않았어요."; read -r -p "엔터로 닫기"; exit 1;; esac
  ( umask 077; printf '%s' "$KEY" > "$F" ); chmod 600 "$F"
  CODE=$(curl -s -o /dev/null -w '%{http_code}' https://api.anthropic.com/v1/models -H "x-api-key: $KEY" -H "anthropic-version: 2023-06-01")
  unset KEY
  if [ "$CODE" = "200" ]; then echo "✓ 키 확인됨 (저장: $F)"; else echo "⚠ 키 확인 실패 (HTTP $CODE) — 저장은 했지만 키가 맞는지, 크레딧이 연결됐는지 확인하세요. 실패하면 도우미가 자동으로 Claude Code를 써요."; fi
fi
# 도우미 최신판 받기 + 재시작
curl -fsSL -o "$D/dayble-helper.mjs" https://raw.githubusercontent.com/fodepu/time-manager/main/tools/dayble-helper.mjs && echo "도우미 최신판 받음"
launchctl kickstart -k "gui/$(id -u)/com.dayble.helper" 2>/dev/null && echo "도우미 재시작됨"
sleep 3; curl -s localhost:7377/ping; echo
read -r -p "엔터로 닫기"
