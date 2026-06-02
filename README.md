# Hi MD Editor

마크다운 파일을 편집하고 미리보기할 수 있는 데스크탑 + 웹 에디터입니다.

**웹 버전**: https://haeinkangcau-png.github.io/hello-md-editor/

---

## 주요 기능

### 에디터
- **WYSIWYG 편집** — TipTap 기반 리치 에디터 (볼드, 이탤릭, 표, 코드블록 등)
- **Raw 편집** — 마크다운 원문을 직접 수정하는 텍스트 모드
- **미리보기 분할** — View 버튼으로 에디터와 미리보기를 나란히 표시
- **스니펫** — `/날짜` → 오늘 날짜 삽입, `/회의` → 회의록 템플릿
- **검색 & 치환** — Ctrl+F로 문서 내 검색, 정규식 지원
- **자동 저장** — 2초 debounce auto-save (토글 가능)

### 파일 관리
- **파일 탐색기** — 폴더 단위로 `.md`/`.html` 파일 목록 탐색
- **노트북** — 폴더/파일을 노트북으로 그룹 관리
- **최근 문서** — 최근 열었던 파일 20개 목록
- **드래그 & 드롭** — `.md` 파일을 앱에 드래그하여 바로 열기

### 스케줄
- **Gantt 차트** — 마크다운 내 날짜 정보를 기반으로 스케줄 시각화
- **새 창 / 스플릿 뷰** — 스케줄 버튼 클릭 시 새 창, 화살표 클릭 시 에디터 옆 분할 뷰
- **실시간 동기화** — BroadcastChannel로 에디터 ↔ 스케줄 콘텐츠 자동 연동

### 기타
- **목차(TOC)** — 문서 내 제목을 자동 추출, depth 필터 조절 가능
- **HTML 편집** — `.html` 파일 직접 편집 지원
- **다크 모드 지원** (스케줄 뷰어)

---

## 기술 스택

| 영역 | 라이브러리 |
|------|-----------|
| UI | React 18 + Vite |
| 에디터 | TipTap 2 + tiptap-markdown |
| 데스크탑 | Electron 26 |
| 빌드/패키징 | electron-builder |
| 웹 배포 | GitHub Pages (자동) |

---

## 개발 환경 설정

**필요 사항**: Node.js 20 이상

```bash
git clone https://github.com/haeinkangcau-png/hello-md-editor.git
cd hello-md-editor
npm install
```

### Electron 데스크탑 앱 실행

```bash
npm run dev
```

Vite 개발 서버(`http://localhost:5174`) + Electron이 동시에 실행됩니다.

### 웹 개발 서버 (브라우저만)

```bash
npx vite
```

---

## 빌드

### Windows 설치 파일

```bash
npm run build:win
# → release/ 폴더에 .exe 생성
```

### macOS DMG

```bash
npm run build:mac
# → release/ 폴더에 .dmg 생성 (x64 + arm64)
```

> macOS에서 "개발자를 확인할 수 없음" 경고 시:  
> **우클릭 → 열기** 또는 시스템 설정 → 개인 정보 보호 및 보안 → "확인 없이 열기"

---

## 웹 배포

`main` 브랜치에 push하면 GitHub Actions가 자동으로 GitHub Pages에 배포합니다.

```bash
git push origin main
```

> 처음 배포 시: **Settings → Pages → Source → GitHub Actions** 설정 필요

---

## 릴리즈

버전 태그를 push하면 자동으로 빌드 후 Release에 첨부됩니다.

```bash
git tag v1.4.1
git push origin v1.4.1
```

→ [Releases](https://github.com/haeinkangcau-png/hello-md-editor/releases)에서 다운로드

---

## 프로젝트 구조

```
md-viewer/
├── electron/              # Electron main process (IPC, 파일 시스템)
├── public/
│   └── schedule.html      # Gantt 차트 스케줄 뷰어 (독립 페이지)
├── src/
│   ├── api.js             # Electron IPC / File System Access API 추상화
│   ├── App.jsx            # 루트 컴포넌트 (레이아웃, 상태 관리)
│   ├── components/
│   │   ├── Editor.jsx         # TipTap 에디터 (WYSIWYG + Raw)
│   │   ├── FileTree.jsx       # 파일 탐색기 + 노트북 + 최근 문서
│   │   ├── HtmlEditor.jsx     # HTML 파일 에디터
│   │   ├── MarkdownPreview.jsx # 미리보기 패널
│   │   ├── SearchBar.jsx      # 검색 & 치환 바
│   │   ├── TocPanel.jsx       # 목차 패널
│   │   ├── Toolbar.jsx        # 에디터 툴바
│   │   └── StatusBar.jsx      # 하단 상태바
│   └── utils/
│       ├── mdRenderer.js      # 마크다운 → HTML 렌더러
│       ├── htmlExport.js      # HTML 내보내기
│       └── searchExtension.js # TipTap 검색 확장
├── .github/workflows/
│   ├── build.yml          # 태그 push → exe/dmg 빌드 및 릴리즈
│   └── deploy.yml         # main push → GitHub Pages 배포
└── package.json
```

---

## 브라우저 호환성 (웹 버전)

| 기능 | Chrome/Edge | Firefox | Safari |
|------|:-----------:|:-------:|:------:|
| 파일 열기 (단건) | ✅ | ✅ | ✅ |
| 폴더 열기 | ✅ | ❌ | ❌ |
| 파일 저장 | ✅ | ❌ | ❌ |
| 스케줄 뷰 | ✅ | ✅ | ✅ |

> 폴더 열기/저장은 [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_Access_API) 기반으로 Chrome/Edge에서만 완전 지원됩니다.
