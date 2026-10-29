# 개발 안내

## 프로젝트 위치

`C:\Users\SSAFY\Documents\Codex\skull_king`을 유일한 개발 폴더로 사용합니다. werewolf와는 별도 Git 저장소이며, 그 프로젝트의 비밀 값이나 운영 설정은 사용하지 않습니다.

## 명령

```powershell
cd C:\Users\SSAFY\Documents\Codex\skull_king
npm start
npm test
```

`npm start`는 서버가 실행되는 동안 유지됩니다. 다른 터미널에서 테스트를 실행해 주세요. `.env.example`은 참고용이며 자동으로 읽지 않습니다. 설정 변경은 셸에서 환경 변수를 지정합니다.

```powershell
$env:PORT = '4181'
npm start
```

기본 바인딩은 로컬 전용 `127.0.0.1`입니다. 같은 네트워크에서 개발 확인이 필요하면 `HOST=0.0.0.0`을 셸 환경 변수로 지정하고 PC의 LAN 주소로 접속할 수 있습니다. 현재 단계는 운영용 공개 서비스가 아닙니다.

초대 링크의 `127.0.0.1`은 다른 기기에서 접속할 수 없습니다. 추후 외부 HTTPS 주소를 구성한 뒤 지인 초대에 사용합니다. 브라우저 보안 환경에 따라 링크 복사가 차단되면 화면의 방 코드를 전달하시면 됩니다.

## 접속할 수 없을 때

첫 확인 주소는 <http://localhost:4180/>입니다. 서버가 실행 중이어야 열립니다. `start-local.cmd` 또는 `npm start`로 실행한 창을 닫으면 서버도 종료됩니다. `localhost` 접속이 어려운 경우 <http://127.0.0.1:4180/>도 확인합니다.

2026-10-29 접속 요청 시 서버가 종료된 상태임을 확인하고, 별도의 숨김 백그라운드 Node.js 프로세스로 다시 실행했습니다. 해당 서버는 채팅 작업 완료 후에도 유지합니다. 재부팅하면 자동으로 시작하지 않습니다. 로그는 Git에서 제외된 `.local/server-4180.stdout.log`, `.local/server-4180.stderr.log`에 있으며, 실행 시 기록한 PID는 `.local/server-4180.pid`에 있습니다. PID 파일은 과거 값일 수 있으므로 중지 전 포트 소유자와 프로세스를 다시 확인합니다. 이미 서버가 실행 중이면 중복 실행하지 않습니다.

```powershell
Invoke-RestMethod http://localhost:4180/api/health
Get-NetTCPConnection -LocalPort 4180 -State Listen
```

정상 서버는 `project: skull_king`, `ok: true`를 응답합니다.

## 소스 구조

| 위치 | 역할 |
| --- | --- |
| `server.mjs` | HTTP 서버, 고정 정적 파일 목록, API |
| `src/lobby.mjs` | 서버 소유의 방·참가자·인증·준비 상태 |
| `public/` | 한국어 화면과 대기실 상태 갱신 |
| `tests/lobby.test.mjs` | 임의 포트에 실제 서버를 열어 다중 참가자 흐름 검증 |

현재 상태 공유는 1초 간격 HTTP 조회입니다. 카드 진행을 구현할 때 서버 이벤트 전송 또는 WebSocket을 검토합니다. 이름은 HTML이 아닌 텍스트로 출력하고, 참가 인증 토큰은 URL과 공개 방 상태에 넣지 않습니다. 화면은 갱신 시 입력 폼과 버튼을 다시 생성하지 않습니다.

방은 브라우저 탭 단위 참가 정보로 복원됩니다. 여러 참가자 검증에는 새 탭에서 주소를 직접 열거나 별도의 브라우저 프로필을 이용합니다. 탭 복제 시 브라우저가 sessionStorage까지 복사할 수 있습니다.

## Git과 배포

원격 `origin`은 <https://github.com/KJM0603/skull_king.git>입니다. 개발은 `dev`에서 진행하고, 검증한 변경을 `origin/dev`에 푸시합니다. `main` 병합은 사용자의 요청이 있을 때 진행합니다.

```powershell
git status
git switch dev
git push -u origin dev
```

GitHub 푸시와 외부 서버 반영은 별도로 확인합니다. 현재 외부 운영 서버에는 배포하지 않았습니다. 이 프로젝트를 Codex 사이드바의 프로젝트로 등록하려면 이 폴더를 프로젝트로 열어 주세요. 폴더 생성 자체가 사이드바 등록을 뜻하지는 않습니다.
