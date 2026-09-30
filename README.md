# Sudoku

One-player (classic) and two-player (turn-based versus) Sudoku. Two players can share a device
or play online from separate devices by joining a session with a code. A simple username/password
login sits in front of everything, so games can eventually feed a leaderboard. React + TypeScript
+ Vite.

## Run

```bash
npm install
npm run dev        # http://localhost:5173; uses the in-browser mock API
npm test           # rules engine, generator, auth and mock API tests
npm run build
```

The app opens on a login screen. **Sign up** creates an account with just a username and password —
no email, no verification. Login persists across reloads (and across tabs of the same browser).

### Trying online play without a backend

The mock API keeps every game — and every account — in `localStorage`. That has one consequence
for local testing: login is shared by every tab of the same browser, so **two tabs of one browser
act as two devices for the same account**, not two different people. That's enough to exercise the
whole online flow (turns, timers, the live stream, disconnect/forfeit):

1. Tab 1: sign up, then **2 Players → Online → Create game**. Note the code.
2. Tab 2: open the invite link (`/?join=CODE`, use **Copy invite link**) or choose **Join with
   code**. It's already logged in as the same account — that's fine, it still gets its own seat and
   its own player token.

Keep both tabs visible (e.g. side by side): browsers throttle timers in hidden tabs, which the mock
mistakes for a disconnect.

There's no way to see two genuinely different accounts sharing one game *in a browser* against the
mock: the account store and the game store are both just `localStorage`, so whatever isolates two
accounts (two browser profiles, one incognito window) also isolates the game between them. That's a
limitation of the client-only mock, not of the contract — a real backend keeps both in a real,
shared database, so two different people on two different devices work exactly as you'd expect.
`src/api/mockApi.test.ts` and `src/api/mockAuthApi.test.ts` exercise that two-account path directly,
without a browser, by registering two accounts in the same test.

## Backend

The UI talks only to the `SudokuApi` interface (`src/api/types.ts`). Two implementations:

| `VITE_API_MODE` | What runs |
| --- | --- |
| `mock` (default) | `src/api/mockApi.ts`: in-browser server. State in localStorage, `BroadcastChannel` standing in for the event stream. |
| `http` | `src/api/httpApi.ts`: `fetch` + `EventSource` against `VITE_API_BASE_URL` (default `/ms/sudous/api/v1`). The dev server proxies `/ms/sudous/api` to `API_PROXY_TARGET` (default `http://127.0.0.1:12000`, the local backend). |

Copy `.env.example` to `.env.local` and set `VITE_API_MODE=http` to switch.

To check the HTTP clients against a running backend (skipped by default; it creates a few throwaway accounts):

```sh
E2E_BASE_URL=http://127.0.0.1:12000/ms/sudous/api/v1 npx vitest run src/api/http.e2e.test.ts
```

Use `127.0.0.1`, not `localhost`: Node 18 resolves `localhost` to IPv6 first and the backend listens on IPv4 only.

**API contract:** the backend's `docs/api.md` (in `../baec-portfolio-api`) is the source of truth. It
describes the three response shapes (envelope, bare, error object), the two token kinds, the rules, the
SSE stream and what is not built yet. `src/api/http.ts` decodes those shapes. The older
[`docs/openapi.yaml`](docs/openapi.yaml) and [`docs/API.md`](docs/API.md) are superseded drafts.
Endpoints:

| | |
| --- | --- |
| `POST /auth/register` | create an account (no verification) and log in |
| `POST /auth/login` | log in |
| `GET /auth/me` | resolve the account behind a token (resume a session) |
| `POST /auth/logout` | no-op on the server; the client just drops its token |
| `POST /games` | create a game, or an online lobby — needs an account token |
| `POST /games/join` | join a lobby by code — needs an account token |
| `GET /games/{id}` | current state (resume) |
| `GET /games/{id}/events` | live updates (SSE) |
| `POST /games/{id}/moves` | fill a box |
| `POST /games/{id}/turn/expire` | how a turn times out: the client calls it when its countdown hits zero (the server has no timer) |
| `POST /games/{id}/forfeit` | leave a running online game |

The mock engine (`src/mock/engine.ts`, `src/mock/authEngine.ts`) and their tests are an executable
spec of those rules, and `src/mock/generator.ts` generates unique-solution puzzles. Port them if
useful — **except `authEngine.ts`'s password hash**, which is deliberately simplistic and explicitly
flagged as unsafe in its own file header; use a real password-hashing algorithm instead.

## Deploy

Production runs on the VPS as the `sudoku-web` service in `~/works/projects-manage/docker-compose.yaml`
(nginx serving the static build, behind Caddy at `https://sudous.baeclatant.com`). It is built with
`VITE_API_MODE=http` and `VITE_API_BASE_URL=https://api.baeclatant.com/ms/sudous/api/v1`, which Vite
bakes in at build time. After pushing to `main`, run on the server:

```sh
dpl-sudoku-web            # git pull, rebuild, restart only sudoku-web, health-check
dpl-sudoku-web --no-pull  # rebuild what is already checked out
```

The script is `scripts/dpl-sudoku-web.sh`. To install or update it on the server:
`sudo install -m 0755 scripts/dpl-sudoku-web.sh /usr/local/bin/dpl-sudoku-web`. It refuses to run if the
server checkout has local changes or cannot fast-forward.

## Layout

```
docs/openapi.yaml       original API draft (superseded by the backend's docs/api.md)
docs/API.md             original API draft, written out for reading (superseded)
src/api/                SudokuApi + AuthApi interfaces, http + mock implementations
src/mock/               rules engine, auth engine, puzzle generator (mock backend, reference for the real one)
src/hooks/useAuth.ts    login/register/logout, persisted session
src/hooks/useGame.ts    game state, live stream, feedback, turn-expiry fallback
scripts/dpl-sudoku-web.sh    server deploy script (installed as /usr/local/bin/dpl-sudoku-web)
src/components/         Login, Home, Lobby, GameScreen, Board, NumberPad, Scoreboard
```
