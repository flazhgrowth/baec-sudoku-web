# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Vite dev server on :5173, in-browser mock API by default
npm run build        # tsc --noEmit && vite build
npm run typecheck    # tsc --noEmit
npm test             # vitest run (node environment)
npx vitest run src/mock/engine.test.ts          # single test file
npx vitest run -t "some test name"              # single test by name
E2E_BASE_URL=http://127.0.0.1:12000/ms/sudous/api/v1 npx vitest run src/api/http.e2e.test.ts   # live-backend check (skipped without E2E_BASE_URL; use 127.0.0.1, not localhost)
```

No linter is configured.

## Architecture

React 18 + TypeScript + Vite SPA for 1-player and 2-player (turn-based, local or online) Sudoku, behind a username/password login. Game rules are in `requirements.md` (2-player: 10s turns, 10→1 points by speed, 3 faults = skip 2 turns).

**API abstraction is the core seam.** The UI only talks to the `SudokuApi` / `AuthApi` interfaces (`src/api/types.ts`, `src/api/auth.ts`). `src/api/index.ts` picks the implementation at build time from `VITE_API_MODE`:
- `mock` (default): `src/api/mockApi.ts` / `mockAuthApi.ts` — an in-browser "server" using `localStorage` for state and `BroadcastChannel` as the event stream. Built on the pure rules in `src/mock/engine.ts`, `authEngine.ts` and `generator.ts` (unique-solution puzzle generator).
- `http`: `httpApi.ts` / `httpAuthApi.ts` using `fetch` + `EventSource`; `http.ts` decodes the backend's three response shapes (envelope, bare, error object). Dev server proxies `/ms/sudous/api` to `API_PROXY_TARGET` (default `http://127.0.0.1:12000`). Copy `.env.example` to `.env.local` to switch.

Source of truth for the HTTP contract is the backend repo's `docs/api.md` (`../baec-portfolio-api`); `docs/openapi.yaml` and `docs/API.md` here are superseded drafts. The mock engine is an executable spec of the server rules (the server has no turn timer — the client calls `POST /games/{id}/turn/expire` when its countdown hits zero). `authEngine.ts`'s password hash is intentionally insecure; never port it.

State lives in hooks: `src/hooks/useAuth.ts` (persisted session) and `src/hooks/useGame.ts` (game state, live event stream, answer feedback, turn-expiry fallback). Components in `src/components/` are screen-level (Login, Home, Lobby, GameScreen, Board, NumberPad, Scoreboard, Credits, ChangePassword); `src/App.tsx` routes between them, and online games are joinable via `/?join=CODE`.

Mock-mode quirk: login is shared across tabs of one browser, so two tabs act as two devices for the same account. Keep both tabs visible — hidden-tab timer throttling reads as a disconnect.

## Deploy

Production is nginx serving the static build (`Dockerfile`, `nginx.conf`) as the `sudoku-web` service on a VPS; `VITE_API_MODE=http` and `VITE_API_BASE_URL` are baked in at build time. Deploy by running `dpl-sudoku-web` on the server (`scripts/dpl-sudoku-web.sh`).
