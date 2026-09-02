# Time Manager

단일 파일 PWA(`index.html`) · GitHub Pages 배포 · https://fodepu.github.io/time-manager/

## 구조 (v19)
- **시간표(메인)** — 에브리타임 스타일 그리드. 기본은 **오늘 하루**, 우측 `시간표 전체보기`로 일~토 7일. 헤더의 `‹ 8/30 ~ 9/5 ›`로 주 이동. 블록 **탭 = 완료 토글**, **길게 누르기 또는 ⋯ = 편집/메뉴**. 완료 데이터는 기존 저장 구조(`values.check`, 날짜별 스냅샷) 그대로라 동기화·14일 통계와 호환.
- 장기 목표·요약·통계는 시간표 아래.
- `📤 기록 보내기`(owner 전용) → `inbox/`에 커밋 → 예약 작업이 정리해 `processed/`로 반환.
- **과제·공지 카드**(owner 전용) — 아래 LMS 연동으로 `data/lms.json`을 30분마다 갱신, 앱은 이 JSON만 읽음.

## LMS(경희대 e-campus / 러닝X) 연동 설정

앱은 정적 페이지라 브라우저에서 LMS를 직접 호출하지 않습니다. **GitHub Actions**(`.github/workflows/lms.yml`)가 30분마다 `scripts/lms-fetch.mjs`를 실행해 `data/lms.json`을 커밋합니다. 토큰은 **repo Secrets에만** 저장됩니다.

### 1) Canvas 여부 확인
러닝X는 Canvas 기반입니다. 로그인한 브라우저에서 `https://khcanvas.khu.ac.kr/api/v1/users/self` 를 열어 JSON(이름·id)이 보이면 Canvas API 사용 가능.

### 2) 액세스 토큰 발급
e-campus → **계정(Account) → 설정(Settings) → "승인된 통합(Approved Integrations)" → + 새 액세스 토큰**
- 용도: `time-manager`, 만료: 비워두거나 학기 말
- 생성된 토큰은 한 번만 표시됩니다. 복사해두세요.
- 메뉴가 없으면 학교가 토큰 발급을 막은 것 → 아래 3-b(.ics 폴백)로.

### 3) GitHub Secrets 등록
저장소 → **Settings → Secrets and variables → Actions → New repository secret**

| Secret | 값 | 필수 |
|---|---|---|
| `LMS_BASE_URL` | `https://khcanvas.khu.ac.kr` | Canvas API 사용 시 |
| `LMS_TOKEN` | 위에서 발급한 토큰 | Canvas API 사용 시 |
| `LMS_ICS_URL` | 캘린더 피드 URL (3-b) | 폴백(선택) |

**3-b) 폴백 — 캘린더 .ics 피드**
e-campus **캘린더 → 캘린더 피드(Calendar Feed)** 버튼 → `https://khcanvas.khu.ac.kr/feeds/calendars/user_….ics` 복사 → `LMS_ICS_URL`에 등록. Canvas API가 막혀도 **과제 마감**은 표시됩니다(공지·제출여부는 불가).

### 4) 실행
- Actions 탭 → **LMS sync** → **Run workflow**로 즉시 1회 실행 후, 이후 30분마다 자동.
- 결과: `data/lms.json` (`assignments[]: course,title,due,submitted,url` / `notices[]: course,title,date,summary,url`).
- 앱: 시간표 아래 **과제·공지** 카드. 마감 임박순, **D-3 이내 빨간 배지**, 제출 완료는 회색 취소선, 새 공지 `NEW`(탭하면 본문 요약 펼침), `＋블록`으로 마감 1시간 전~마감 블록을 그날 시간표에 추가.

### 문제 해결
- 카드에 "LMS 데이터가 없어요" → Secrets 미등록 또는 워크플로 미실행. Actions 로그 확인.
- `HTTP 401` → 토큰 만료/오타. 재발급 후 Secret 갱신.
- 학교 방화벽이 GitHub Actions IP를 막으면 API가 실패할 수 있음 → .ics 폴백 사용.

## 배포
`main`에 push → GitHub Pages 자동 반영(~1분). 캐시 갱신은 앱 헤더 ↻ 또는 주소 뒤 `?v=19`.
