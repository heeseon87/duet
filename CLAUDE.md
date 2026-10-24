# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`README.md`가 동작 명세다. 화면, 지도와 코드의 묶음, 터미널 mod의 동작을 바꾸기 전에 README의 해당 절을 읽고, 동작을 바꾸면 같은 커밋에서 README도 고친다.

## 명령

```bash
npm run typecheck                          # tsc + mod 타입 검사
npm test                                   # vitest 전체
npx vitest run tests/mod.test.ts -t "<이름>" # 파일 하나, 케이스 하나
npm run build                              # web → dist/web
npm run mod:tools                          # canvasTools.ts → mod/hooks/tools.ts 다시 쓰기
DUET_HOME=/tmp/duet-dev npx tsx watch server/main.ts --port 7981   # 개발 서버
```

- 서버는 `dist/web`만 서빙한다. Vite 개발 서버나 HMR은 없으므로, `web/`이나 `shared/`를 고치면 `npm run build` 뒤에 탭을 새로 고친다.
- `npm run typecheck`의 mod 쪽은 `mod/.claude-plugin/types/`를 읽는다. 이 폴더는 git에 없고, `claude --plugin-dir mod`를 한 번 띄웠다가 나가면 Claude Code가 쓴다.
- `server/agent/canvasTools.ts`를 고치면 `npm run mod:tools`를 돌린다. 안 돌리면 `tests/mod.test.ts`가 어긋남을 잡고 실패한다.
- 개발은 7981 포트와 별도 `DUET_HOME`에서 한다. 토큰은 `$DUET_HOME/token`에 있다. 기본 포트 7979의 서버는 사용자의 실제 대화를 돌리고 있을 수 있으므로 `duet --stop`이나 프로세스 종료로 멈추지 않는다. 다만 `duet` 실행기(`~/.local/bin/duet` → `bin/duet.mjs`)는 이 체크아웃에서 돌기 때문에 두 서버는 `dist/web`과 코드 해시를 공유한다. 그래서 `npm run build`는 7979의 열린 탭에도 바로 반영되고, `server/`·`shared/`를 고치면 그 탭에도 재시작이 필요하다는 칩이 뜬다.
- e2e는 테스트 러너가 아니라 떠 있는 서버를 상대로 도는 `node e2e/<이름>.mjs` 스크립트다. 필요한 환경 변수와 준비물은 각 파일 머리 주석에 있다. 상당수가 실제 Haiku 대화를 돌린다(`DUET_MODEL`로 바꾼다). `smoke.mjs`는 `e2e/make-demo.sh <경로>`로 만든 데모 저장소가 필요하다. `DUET_SETTING_SOURCES=project,local`을 주면 대화가 사용자 설정(CLAUDE.md, 훅) 없이 뜬다.

## 구조

프로세스 셋이 서버 하나를 가운데 두고 만난다.

- **브라우저 ↔ 서버.** `server/main.ts`가 HTTP 라우트와 SSE(`/api/events`) 방송을 맡는다. 브라우저는 프로세스 상태를 직접 보지 않고 `shared/protocol.ts`에 정의된 이벤트만 받는다. 이 파일이 서버와 브라우저 사이의 계약이다.
- **서버 ↔ Duet 대화.** `server/agent/session.ts`가 Agent SDK `query()`를 스트리밍 입력(Inbox)으로 붙잡고 있고, 캔버스 도구는 같은 프로세스 안의 SDK MCP 서버(`mcp__duet__canvas_*`)로 붙는다. 턴마다 작업 트리를 스냅샷으로 남겨 리뷰의 Turns 비교에 쓴다(`server/git/diff.ts`의 `snapshot`).
- **서버 ↔ 터미널 Claude Code.** `mod/`는 MCP 플러그인이 아니라 Claude Code mod다. mod는 SSE를 읽을 수 없어서 `GET /api/terminals/:id/poll`을 길게 붙잡아 메시지와 지도 변경을 받고, 도구 호출은 `POST /api/terminals/:id/tools/:tool`로 보내 서버의 `runCanvasTool`이 처리한다. 순수 로직은 `mod/hooks/duet.ts`(단위 테스트 대상)에, 상태와 훅 등록은 `mod/hooks/register.tsx`에 둔다.

한 가지 의미는 한 곳에만 둔다.

- `shared/canvas.ts`: 지도 모델(검증, 패치, rev diff, Mermaid 변환). 순수 함수만 두고, 서버와 브라우저가 함께 쓴다.
- `server/agent/canvasTools.ts`의 `CANVAS_TOOLS`: 캔버스 도구의 설명과 스키마. Duet 대화의 MCP 서버, 터미널 라우트, 생성된 `mod/hooks/tools.ts`가 모두 여기서 나온다.
- `shared/mapFiles.ts`: 상자와 파일을 짝짓는 규칙. 리뷰의 '지도' 묶음과 캔버스의 코드 배지가 같은 함수를 쓴다.
- 지도가 묶인 코드(`<name>.map.json`의 `code`)는 rev 밖에 저장되므로 rev 비교·복원과 무관하다.

브라우저 쪽 상태는 zustand 스토어(`web/src/state.ts`, `review/store.ts`, `canvas/store.ts`)에 있고, 테스트할 수 있는 계산은 `transcript.ts`, `focusModel.ts`, `diffModel.ts`처럼 React 밖의 모듈로 빼서 `tests/`가 직접 import한다.

`bin/duet.mjs`와 서버는 `server/`·`shared/`의 코드 해시를 비교한다. 코드가 바뀌면 실행기는 일하는 대화가 없을 때만 서버를 다시 띄우고, 열린 탭에는 재시작이 필요하다는 칩이 뜬다.

## 지켜야 할 것

서버 보안이나 git 동작을 건드리기 전에 README의 '지켜야 할 것'을 읽는다. 핵심은 다음과 같다.

- 서버는 Bash를 돌리는 에이전트를 부린다. `127.0.0.1`에만 묶고, 토큰 쿠키와 Host·Origin 검사를 유지하며, CORS는 열지 않는다.
- 리뷰와 턴 스냅샷은 작업 트리, 진짜 인덱스, stash를 건드리지 않는다. 트리 객체는 임시 인덱스로만 만든다.
- Duet이 띄우는 대화에는 터미널 mod와 옛 design-map 플러그인이 붙지 않는다(`CLAUDE_CODE_PLUGIN_DIRS`에서 빼고 `DUET_CONVERSATION=1`을 준다).

## 관례

- 커밋 메시지는 한국어로 쓰고 `feat:`, `feat(mod):`, `fix(canvas):`, `chore(mod):` 같은 접두를 붙인다. 본문에는 무엇이 왜 바뀌었는지 쓰고, 변경이 여럿이면 `- ` 목록으로 쓴다.
- mod 동작을 바꾼 커밋들을 push하기 전에 `mod/.claude-plugin/plugin.json`의 버전을 올리는 `chore(mod)` 커밋을 따로 하나 둔다(예: 4292acd 뒤의 c2988dc). 기능 커밋마다 올리지는 않는다.
- 코드 주석은 영어로, 화면 문구와 사용자에게 보이는 오류 메시지는 한국어 반말로 쓴다.
- mod에 새 훅 이벤트를 쓰기 전에 확인한다. Team·Enterprise 조직 계정에서는 내장 플러그인 `cc-plugin-sec-default`가 `prompt.section`, `context`, `attachment`, `compose`, `skill.prompt`, `attribution.text`, `session.compact`, `settings.read`, `classic.*`를 사용자 플러그인에 넘기지 않는다. `session.compact`를 대신한 방법은 README '기준 지도' 항목에 있다.
- 상태 줄을 지우면 SDK가 받는 `ui_status`의 text는 `undefined`가 아니라 `null`이다.
