# `window.electronAPI` — 플랫폼 계약 명세

세 데스크탑 셸(Electron·macOS Swift·Windows Tauri)이 공유 프론트엔드(`src/`)에 제공해야 하는
단일 계약이다. 프론트엔드는 셸을 구분하지 않고 이 표면만 호출한다 (`src/api.js`가 웹 폴백 포함 추상화).

## 주입 방식

| 셸 | 구현 위치 | 주입 방법 |
|----|-----------|-----------|
| Electron | `electron/preload.js` + `electron/main.js` | contextBridge → ipcRenderer.invoke |
| macOS Swift | `native/mac/Sources/HiMDPower/main.swift` | WKUserScript가 JS 객체 주입 → 네이티브 메시지 핸들러 |
| Windows Tauri | `src/tauri-bridge.js` + `native/windows/src-tauri/src/lib.rs` | `__TAURI_INTERNALS__` 감지 시 JS에서 합성 → `invoke()` 커맨드 |

규칙:
- `src/tauri-bridge.js`는 `src/main.jsx` **최상단**에서 import된다 (api.js가 `window.electronAPI`를 읽기 전).
- Tauri 외 환경에서 tauri-bridge는 no-op이다. Swift 셸은 `window.electronAPI`가 이미 있으면 주입하지 않는다.
- 이미지 URL 프리픽스는 셸마다 다르다 → 프론트엔드는 반드시 `src/api.js`의 `IMG_BASE`를 사용한다
  (Electron/웹: `local-image://img/`, Tauri: `http://local-image.localhost/img/`).

## 메서드 표면 (21개)

| 메서드 | 시그니처 | Electron | Tauri | mac Swift |
|--------|----------|:---:|:---:|:---:|
| listFiles | `(dir) → Promise<items>` | ✅ | ✅ | ✅ |
| readFile | `(path) → Promise<{content,...}>` | ✅ | ✅ | ✅ |
| writeFile | `(path, content) → Promise` | ✅ | ✅ | ✅ |
| checkExists | `(path) → Promise<boolean>` | ✅ | ✅ | ✅ |
| createFolder | `(dirPath) → Promise` | ✅ | ✅ | ✅ |
| renameFile | `(oldPath, newPath) → Promise` | ✅ | ✅ | ✅ |
| saveImage | `(dir, fileName, base64) → Promise` | ✅ | ✅ | ✅ |
| cleanupImages | `(assetsDir, referencedImages[]) → Promise` | ✅ | ✅ | ✅ |
| copyAssets | `(src, dest) → Promise` | ✅ | ✅ | ✅ |
| readImageBase64 | `(filePath) → Promise<string\|null>` | ✅ | ✅ | ✅ |
| openFolder | `() → Promise<string\|null>` (폴더 선택 다이얼로그) | ✅ | ✅ | ✅ |
| saveDialog | `(defaultPath) → Promise<string\|null>` | ✅ | ✅ | ✅ |
| revealInExplorer | `(filePath) → Promise` | ✅ | ✅ | ✅ |
| openPath | `(target) → Promise` (파일/폴더/URL 열기) | ✅ | ✅ | ✅ |
| openNewWindow | `() → Promise` | ✅ | ✅ | ✅ |
| openScheduleWindow | `(content, fileName) → Promise` | ✅ | ✅ | ✅ |
| openSpecWindow | `(content, fileName) → Promise` | ✅ | ✅ | ✅ |
| getOpenFilePath | `() → Promise<string\|null>` (파일 연결로 실행된 경우) | ✅ | ✅ | ✅ |
| onOpenFile | `(cb) → unsubscribe` (실행 중 파일 연결 수신, **동기 해제 함수 반환**) | ✅ | ✅ | ✅ |
| captureFullHtml | `({html, viewWidth, scale}) → Promise` (이미지로 복사) | ✅ | ⚠️ 구현 있음·실기 검증 필요 | ❌ 미구현 |
| captureAndCopy | `(rect) → Promise` | ✅ | ❌ reject 스텁 | ❌ 미구현 |

- `captureAndCopy`는 현재 UI에서 사용되지 않는다 — 계약에서 제거 검토 대상 (plan 11장).
- 미구현 메서드에 의존하는 프론트엔드 기능은 feature-detect(`typeof fn === 'function'` 및 reject 처리)로
  우아하게 비활성화되어야 한다.

## 계약 변경 절차

`electronAPI`에 메서드를 추가/변경/제거할 때는 **하나의 PR**에서 다음을 함께 갱신한다:

1. `electron/preload.js` + `electron/main.js` (IPC 핸들러)
2. `src/tauri-bridge.js` + `native/windows/src-tauri/src/lib.rs` (커맨드 등록 포함)
3. `native/mac/Sources/HiMDPower/main.swift` (주입 스크립트 + 채널 핸들러)
4. 이 문서의 메서드 표

셸이 즉시 구현할 수 없으면 표에 ❌/⚠️로 기록하고, 프론트엔드에 graceful fallback을 넣는다.
