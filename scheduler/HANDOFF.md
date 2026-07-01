# 개발 일정표 — 인수인계 (VS Code / Copilot)

간트 차트 형식의 **개발 일정표**. 빌드 도구·프레임워크 없는 **단일 HTML 파일**이며,
일정 데이터는 파일 안에 내장된 **마크다운 DSL**로 작성합니다. 표준 디자인 시스템의
다크/라이트 테마를 따릅니다.

---

## 1. 파일 구조

```
개발 일정.html            ← 최종 산출물 (한글·공백 파일명)
schedule.html            ← 위 파일과 100% 동일한 ASCII 복사본 (편집/깃 관리에 편함)
fonts/
  NeuroSansKR-Regular.ttf   (400)
  NeuroSansKR-Medium.ttf    (500)
  NeuroSansKR-Bold.ttf      (700)
uploads/
  schedule-legacy.html      ← 재디자인 이전 원본 백업 (참고용, 사용 안 함)
HANDOFF.md                  ← 이 문서
```

> **권장:** 둘은 동일 파일입니다. VS Code/Git에서는 `schedule.html` 하나만 유지하고
> 한글 파일명은 삭제하거나, 반대로 한글본만 유지하세요. 하나를 고쳤으면 **반드시 다른 하나에도
> 같은 내용을 복사**해야 합니다 (지금은 수동 동기화 상태).

실행: 빌드 불필요. 브라우저로 HTML을 열면 됩니다. 단, **로컬 폰트를 상대경로로
참조**하므로 `file://` 직접 열기보다 간단한 정적 서버 권장
(`npx serve` 또는 VS Code "Live Server" 확장).

---

## 2. 데이터 입력 방식 (마크다운 DSL)

화면 상단 **"일정 편집 · Markdown"** 패널을 열어 텍스트로 편집하면 실시간 렌더됩니다.
초기 데이터는 `<script>` 안 상수 **`DEFAULT_MD`** 에 들어 있습니다 (여기를 고치면 기본 일정이 바뀜).

문법:
```
# 제품명 [태그]                         제품 그룹 (태그 → 뱃지). 제품마다 색 자동 배정
## 섹션명                                섹션 그룹
- 이름 | 2026-06-01 ~ 2026-07-13         일반 바
- 이름 | ... ~ ... | tbd                 미정 바 (끝부분 fade)
- 이름 | ... ~ ... | cert                인허가 심사 바 (점선)
- 이름 | ... ~ ... | ◆ 완료              완료 마일스톤 (끝점, 초록 다이아)
- 이름 | ... ~ ... | cert | ◇ 제출        접수 마일스톤 (시작점, 주황 다이아)
```
- 날짜는 `YYYY-MM-DD`. 바/캘린더에서 클릭하면 미니 캘린더로 날짜 수정 가능.
- 캘린더 퀵버튼: 시작일은 월요일, 종료일은 금요일로 자동 스냅.

---

## 3. 코드 아키텍처 (`<script>` 1개, 의존성 없음)

렌더 파이프라인:
```
DEFAULT_MD (또는 편집 textarea)
  → parseMD()      DSL → data[] (product/section/row 객체) + colorMap
  → calcRange()    데이터 전체 날짜 범위
  → applyRange()   현재 범위 토글(반기/올해/1년/2년/전체) 적용
  → render(mode)   주/월 격자 계산 → tree 구조화 → HTML 문자열 생성 → #chartInner에 주입
```

주요 함수:
| 함수 | 역할 |
|---|---|
| `parseMD(md)` | 마크다운 → 데이터 배열. `getColor()`로 제품별 팔레트 배정 |
| `render(mode)` | 핵심 렌더러. `'fit'`(화면맞춤) / `'scroll'`(고정 간격) |
| `applyRange()` | 범위 토글 → 차트 시작/끝 날짜 산출 |
| `renderRow()` / `summaryRow()` | 개별 행 / 접힌 그룹 요약 바 |
| `setMode` `setRange` `setTheme` | 툴바 토글 핸들러 |
| `applyPalette()` | **테마에 맞는 바 팔레트 선택** (render 시작 시 호출) |
| 캘린더: `showCal` `openCal` `positionCal` `handleEditorCursor` `replaceChartDate` | 미니 캘린더 + 날짜 인라인 편집 |

상태:
- `currentMode` / `currentRange` / `currentTheme` — 전역 `let`
- `foldState` — 제품/섹션 접힘 상태 (`{ 'p-0': true, ... }`). 과거 제품은 기본 접힘.
- 테마 선택은 `localStorage('aqua_theme')`에 저장.

---

## 4. 디자인 시스템 매핑

**색은 두 군데에 있습니다 — 둘 다 고쳐야 일관됩니다:**

1. **CSS 커스텀 프로퍼티** (`<style>` 안)
   - `:root{ ... }` = 다크 테마 (기본)
   - `[data-theme="light"]{ ... }` = 라이트 테마 오버라이드
   - 토큰 예: `--bg --surface --elevation --border --text-primary --accent(#1077fe)
     --confirm --error --today --milestone` 등
2. **JS 바 팔레트** (`<script>` 상단 상수)
   - `PALETTE_DARK[]` / `PALETTE_LIGHT[]` — 제품 바 색 (각 `{bg, bd, tx}`)
   - `CERT_DARK/LIGHT` (인허가), `TBD_DARK/LIGHT` (미정)
   - `applyPalette()`가 `currentTheme`에 따라 활성 팔레트(`PALETTE`/`CERT_STYLE`/`TBD_STYLE`)를 교체

디자인 규칙(준수 중): 다크 우선 · 1px 헤어라인 · 4px 그리드 · 액센트 블루는 절제(오늘 라인)
· 숫자 tabular(`tnum`) · 라운드 ≤ 8px.

---

## 5. 확장 포인트 (Copilot에게 시킬 만한 작업)

- **진행률 표시**: `renderRow()`에서 바 내부에 진행도 오버레이 추가 (DSL에 `| 60%` 같은 토큰 신설 → `parseMD` 파싱부 확장).
- **지연 경고**: 종료일 < 오늘 인데 미완료면 바 테두리/아이콘 강조. `render()`에서 `TODAY`와 `item.end` 비교.
- **의존성 연결선**: row 간 화살표 SVG 오버레이 (DSL에 `after: <이름>` 추가 → 좌표 계산 후 `#chartInner`에 절대배치).
- **CSV/JSON 내보내기**: `parsedData` 사용해 다운로드 버튼 추가.
- **인쇄/PDF**: `@media print` 규칙 + 라이트 테마 강제.
- **반응형/모바일**: 현재 데스크탑 밀도 기준. 좁은 화면 라벨열 축소 필요.

---

## 6. 주의사항 / 함정

- **색을 한 곳만 바꾸지 말 것** — CSS 변수(테마)와 JS 팔레트(바)는 별개입니다 (§4).
- **`schedule.html` ↔ 한글 파일명** 수동 동기화 상태. 하나만 정본으로 정하길 권장.
- **폰트 상대경로** — `fonts/` 폴더를 HTML과 함께 옮겨야 깨지지 않음.
- 파서는 단순 정규식 기반 — 한 줄 안 `|` 구분과 날짜 형식(`YYYY-MM-DD`)을 엄격히 따름.
- 외부 라이브러리·CDN 없음. 인터넷 없이 동작 (폰트 로컬).
- `render()`는 매번 `innerHTML` 전체 재생성 → 대량 데이터면 성능 고려 필요(현 규모는 무관).

---

## 7. Copilot 시작용 프롬프트 예시

> "이 단일 HTML 간트 차트에서 각 바에 진행률(%)을 표시하고 싶어. 마크다운 DSL에
> `| 60%` 토큰을 추가하고, parseMD가 파싱한 뒤 renderRow에서 바 안에 채움 오버레이로
> 그려줘. 다크/라이트 두 테마 모두에서 보이게 CSS 변수를 써."
