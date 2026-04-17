# MD Viewer

Markdown 파일을 편집하고 미리보기할 수 있는 데스크탑 앱 + 웹 앱입니다.

**웹 버전**: https://haeinkangcau-png.github.io/hello-md-editor/

---

## 주요 기능

- **WYSIWYG 편집** — TipTap 기반 리치 에디터 (볼드, 이탤릭, 표, 코드블록 등)
- **Raw 편집** — 마크다운 원문을 직접 수정하는 텍스트 모드
- **미리보기 분할** — View 버튼으로 에디터와 미리보기를 나란히 표시
- **파일 탐색기** — 폴더 단위로 `.md` 파일 목록 탐색
- **최근 문서** — 최근 열었던 파일 20개 목록 관리
- **목차(TOC)** — 문서 내 제목을 자동 추출, depth 필터 조절 가능
- **자동 저장** — 2초 debounce auto-save (토글 가능)
- **HTML → MD 변환** — TipTap이 생성한 HTML 표를 마크다운 표로 일괄 변환
- **드래그 & 드롭** — `.md` 파일을 앱에 드래그하여 바로 열기

---

## 기술 스택

| 영역 | 라이브러리 |
|------|-----------|
| UI | React 18 + Vite |
| 에디터 | TipTap 2 + tiptap-markdown |
| 데스크탑 | Electron 26 |
| 빌드/패키징 | electron-builder |
| 웹 배포 | GitHub Pages |

---

## 개발 환경 설정

**필요 사항**: Node.js 20 이상

```bash
git clone https://github.com/haeinkangcau-png/hello-md-editor.git
cd hello-md-editor
npm install
```

### 웹 개발 서버 (브라우저)

```bash
npm run dev -- --mode web
# 또는
npx vite
```

`http://localhost:5174` 에서 실행됩니다.

### Electron 데스크탑 앱 실행

```bash
npm run dev
```

Vite 개발 서버 + Electron이 동시에 실행됩니다.

---

## 빌드

### Windows 포터블 exe

```bash
npm run build:win
# → release/ 폴더에 .exe 생성
```

### macOS DMG

```bash
npm run build:mac
# → release/ 폴더에 .dmg 생성 (x64 + arm64)
```

> macOS에서 "개발자를 확인할 수 없음" 경고가 뜨면:  
> **우클릭 → 열기** 로 실행하거나, 시스템 환경설정 → 개인 정보 보호 및 보안 → "확인 없이 열기"

---

## 웹 배포

`main` 브랜치에 push하면 GitHub Actions가 자동으로 GitHub Pages에 배포합니다.

```bash
git push origin main
```

처음 배포 전에 레포지토리에서 한 번만 설정 필요:  
**Settings → Pages → Source → GitHub Actions**

---

## 프로젝트 구조

```
md-viewer/
├── electron/          # Electron main process (IPC, 파일 시스템)
├── src/
│   ├── api.js         # Electron IPC / File System Access API 추상화
│   ├── App.jsx        # 루트 컴포넌트
│   ├── components/
│   │   ├── Editor.jsx         # TipTap 에디터 (WYSIWYG + Raw 모드)
│   │   ├── FileTree.jsx       # 파일 탐색기 + 최근 문서 탭
│   │   ├── MarkdownPreview.jsx # 미리보기 패널
│   │   ├── TocPanel.jsx       # 목차 패널
│   │   ├── Toolbar.jsx        # 에디터 툴바
│   │   ├── StatusBar.jsx      # 하단 상태바
│   │   └── SelectionInfo.jsx  # 선택 영역 정보
│   └── utils/
│       └── mdRenderer.js      # 마크다운 → HTML 렌더러
├── .github/workflows/
│   ├── build.yml      # 태그 push 시 exe/dmg 빌드 및 릴리즈
│   └── deploy.yml     # main push 시 GitHub Pages 배포
└── package.json
```

---

## 릴리즈 (설치 파일 배포)

GitHub에 버전 태그를 push하면 자동으로 빌드 후 Release에 첨부됩니다.

```bash
git tag v1.0.3
git push origin v1.0.3
```

Actions 완료 후 [Releases](https://github.com/haeinkangcau-png/hello-md-editor/releases) 페이지에서 다운로드 가능합니다.

---

## 브라우저 호환성 (웹 버전)

| 기능 | Chrome/Edge | Firefox | Safari |
|------|:-----------:|:-------:|:------:|
| 파일 열기 (단건) | ✅ | ✅ | ✅ |
| 폴더 열기 | ✅ | ❌ | ❌ |
| 파일 저장 | ✅ | ❌ | ❌ |

폴더 열기 / 저장은 [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_Access_API)를 사용하므로 Chrome/Edge에서만 완전히 동작합니다.
