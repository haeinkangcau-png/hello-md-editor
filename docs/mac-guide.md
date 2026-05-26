# Hi MD Editor — Mac 설치 가이드

## 다운로드

[GitHub Releases](https://github.com/haeinkangcau-png/hello-md-editor/releases/latest) 페이지에서  
`Hi.MD.Editor-x.x.x.dmg` 파일을 다운로드합니다.

---

## 설치

1. 다운로드한 `.dmg` 파일을 더블클릭합니다.
2. 열린 창에서 **Hi MD Editor** 아이콘을 **Applications** 폴더로 드래그합니다.
3. 창을 닫고 `.dmg` 파일은 삭제해도 됩니다.

---

## 첫 실행 시 경고 해결

macOS는 서명되지 않은 앱을 기본 차단합니다.  
아래 방법 중 하나로 실행하세요.

### 방법 1 — 우클릭으로 열기 (권장)

1. Finder에서 **Applications → Hi MD Editor** 를 찾습니다.
2. 앱 아이콘을 **우클릭(또는 Control+클릭)** 합니다.
3. 메뉴에서 **"열기"** 를 선택합니다.
4. 경고창이 나타나면 **"열기"** 버튼을 클릭합니다.

> 이후 실행부터는 정상적으로 더블클릭으로 열립니다.

### 방법 2 — 터미널 명령어

```bash
xattr -cr /Applications/Hi\ MD\ Editor.app
```

---

## 사용법

| 동작 | 방법 |
|------|------|
| 파일 열기 | `Cmd+O` 또는 시작 화면의 **파일 열기** 버튼 |
| 폴더 열기 | 왼쪽 사이드바 상단 폴더 아이콘 클릭 |
| 저장 | `Cmd+S` |
| 다른 이름으로 저장 | `Cmd+Shift+S` |
| 새 파일 | `Cmd+N` |
| 검색 | `Cmd+F` |

---

## 시스템 요구사항

- macOS 11 (Big Sur) 이상
- Apple Silicon(M1/M2/M3) 및 Intel Mac 모두 지원
