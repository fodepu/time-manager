# Dayble 로컬 도우미 (실시간 필기, 추가 비용 0)

앱이 20초마다 보내는 "대본 + 슬라이드 텍스트"를 **내 맥에 설치된 Claude Code(MAX 구독)**로 처리해 돌려줍니다.
API 키·요금 없음. 구독의 5시간 사용량만 씁니다.

## 처음 한 번
1. 터미널에서 Claude Code 설치 (이미 있으면 건너뜀)
   npm install -g @anthropic-ai/claude-code
2. 터미널에서 `claude` 실행 → 브라우저로 로그인(MAX 계정) → 종료
3. 이 폴더(dayble-helper)를 원하는 곳에 두기 (예: ~/Dayble)

## 수업 때마다
- `Dayble 도우미 시작.command` 더블클릭 (또는 터미널에서 `node dayble-helper.mjs`)
  · 처음엔 "확인되지 않은 개발자" 경고가 뜰 수 있음 → 우클릭 → 열기
- Dayble 녹음 화면의 버튼이 **"✦ Claude 필기 (내 맥·무료)"** 로 바뀌면 연결됨
- Chrome이 "로컬 네트워크 접근 허용?"을 물으면 허용
- 수업 끝나면 터미널 창 닫기 (Ctrl+C)

## 모델 바꾸기
기본 sonnet. 더 빠르게: `DAYBLE_MODEL=haiku node dayble-helper.mjs`
