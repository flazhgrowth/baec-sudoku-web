# Sudoku API

> **Superseded.** The backend's own document, `baec-portfolio-api/docs/api.md`, is now the source of
> truth. Where this file differs from it (response envelope, register/login shape, error codes, no
> presence, client-driven `turn/expire`), the backend wins. This file is kept only as the original
> design draft; see section 12 of the backend doc for the list of differences.

Human-readable companion to [`openapi.yaml`](./openapi.yaml). That file is the source of truth for
exact schemas; this one is for reading top to bottom. Base URL: `/ms/sudous/api/v1`.

The server is authoritative for the solution, move validation, scoring, turn timing and presence.
The solution is never sent to the client.

## Contents

- [Accounts](#accounts)
- [Game kinds](#game-kinds)
- [Identity: two kinds of token](#identity-two-kinds-of-token)
- [Online lifecycle](#online-lifecycle)
- [Presence and forfeit](#presence-and-forfeit)
- [Versus rules](#versus-rules)
- [Turn expiry](#turn-expiry)
- [Live updates (SSE)](#live-updates-sse)
- [Conventions](#conventions)
- [Endpoints](#endpoints)
- [Errors](#errors)
- [Data model](#data-model)
- [Example: full online game](#example-full-online-game)

## Accounts

A simple username + password account system — just enough to attribute games (and, later, a
leaderboard) to a person. `POST /auth/register` performs no verification of any kind: no email, no
confirmation step, no "are you sure". The account exists the moment the call returns.

The client must be logged in to play at all: `POST /games` and `POST /games/join` both require an
account token (see [Identity](#identity-two-kinds-of-token)). There is no guest/anonymous path in
this contract — the reference frontend shows a login screen before anything else.

Passwords: 6–72 characters, no other rule. **Implementer's note:** the reference mock
(`src/mock/authEngine.ts`) hashes passwords with a fast, non-cryptographic hash purely so the
in-browser demo doesn't keep plaintext in `localStorage` — it is explicitly *not* secure. A real
backend must hash passwords with bcrypt, argon2 or scrypt (slow, salted, purpose-built) and must
never log the plaintext password.

## Game kinds

| `mode` | `online` | Meaning |
| --- | --- | --- |
| `single` | `false` | Classic play. One player, no turns, no timer, no points. `mistakes` is tracked. |
| `versus` | `false` | Two players sharing one device, turn based. Created with both players already seated. |
| `versus` | `true` | Two players on their own devices. Created as a lobby (`status: waiting`) that a second player joins with a code. |

## Identity: two kinds of token

Two separate tokens are in play, answering two different questions:

- **Account token** — `Authorization: Bearer <token>`, from `/auth/register` or `/auth/login`.
  *Who is calling?* Required on `POST /games` and `POST /games/join`. The server uses it to set the
  acting seat's `Player.user_id` and to take that seat's `name` from the account's `username` —
  any name supplied for that seat in `player_names` is ignored.
- **Player token** — `X-Player-Token`, from `credentials` in the `Session` that create/join
  return. *Which seat, in this one game?* Required on `POST /games/{id}/moves` and
  `POST /games/{id}/forfeit`; the event stream takes it as `?token=` instead, since browsers can't
  set headers on `EventSource`. The server derives the acting player from this token — the client
  never sends a player id directly.

Why two tokens: one account can hold both seats of a same-device `versus` game (one `POST /games`
call, with one account token, returns two player-token credentials — one per seat). But in an
online game, the guest logs in with *their own* account token when they join, and the two seats'
player tokens end up on two different devices.

- **Online games:** create returns the host's player-token credential only, join returns the
  guest's. Each device holds exactly one.
- **Same-device versus:** create returns both player-token credentials. The client picks whichever
  token belongs to `current_turn.player_id`. Only the seat matching the caller's account gets a
  `user_id`; the other is a guest (`user_id: null`).
- **Single:** one player-token credential.

Treat both kinds of token as secrets — anyone holding one can act as that account or that seat.

## Online lifecycle

1. Host calls `POST /games` with `online: true` and their account token. Response: `status:
   waiting`, a `join_code` (6 characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, unique among open
   lobbies), one player (the host, `user_id` set from their account).
2. Host opens the event stream and waits.
3. Guest calls `POST /games/join` with the code and *their own* account token. The game starts:
   `status: in_progress`, `join_code: null`, `started_at` resets to now, and player 1 (the host) gets
   the first turn. The guest is seated as `p2` with their own `user_id` and username. The host learns
   this over the stream (`player_joined` event).
4. Play proceeds. Both devices keep their stream connection open.
5. The game ends when the puzzle is solved, or when a player forfeits — either explicitly or by
   staying disconnected too long. `end_reason` records which.

A lobby nobody joins should be discarded by the server after a while (suggested: 30 minutes); the
game then answers `404 GAME_NOT_FOUND`.

## Presence and forfeit

Applies only to online games that are `in_progress` — never to `waiting` lobbies, `single` games,
or same-device `versus` games.

- A player counts as **connected** while their event stream is open, or they made an authenticated
  request or heartbeat less than 15 seconds ago. (The reference mock uses that 15 s window; a
  backend with real persistent streams can instead treat "stream open" as connected and start the
  clock only once the last stream closes.)
- `Player.connected` flips to `false` 15 seconds after the last sign of life, and back to `true`
  when the player returns. Each flip emits a `player_connection` event.
- While disconnected, `Player.forfeit_at` = last sign of life + `rules.disconnect_forfeit_ms`
  (60 000 ms by default). If that time passes, the disconnected player forfeits: the game completes
  with `end_reason: forfeit` and the other player as winner. The clock never starts before
  `started_at`.
- A disconnected player's turn still expires normally in the meantime (no fault, no points) — it
  isn't held open for them.

## Versus rules

All the constants below live on `Game.rules`, so a client should read them from there rather than
hardcode them.

1. A turn is one attempt to fill one box. `players[0]` (the host, in online games) moves first.
2. A turn lasts `turn_limit_ms` (10 000 ms). At or after `deadline_at` the turn is over: no fault, no
   points, and it passes to the other player.
3. A correct fill scores `max(min_points, max_points - floor(elapsed_ms / 1000))`, where
   `elapsed_ms = now - current_turn.started_at`. That's 10 points in the first second, 9 in the
   second, … down to 1 point from the tenth second on. A correct fill ends the turn.
4. A wrong fill scores nothing, is **not** written to the board, adds one fault (`faults` and
   `mistakes` both increment) and ends the turn.
5. On reaching `fault_limit` (3) faults, the player owes `skip_turns_on_fault_limit` (2) turns
   (`skip_turns_remaining = 2`). The turn passes to the opponent as usual; each time the turn would
   come back to the offender it is skipped instead (`skip_turns_remaining--`, `turn_skipped` event)
   and stays with the opponent. When the last skipped turn is consumed, `faults` resets to 0. Net
   effect: after the third fault, the opponent plays three turns in a row.
6. The game completes when every box matches the solution. `winner_id` is the player with the higher
   score, or `null` on a draw.

## Turn expiry

The server must expire turns on its own — a timer firing at `deadline_at` — because in an online game
either client may simply be gone. On top of that, **every** request that touches a game (`GET`,
moves, expire, forfeit) must first apply anything already due: turn timeouts, presence changes,
disconnect forfeits. When a turn is expired lazily this way, the next turn starts at the moment of
processing (`started_at = now`), not at the old deadline.

Important for implementers: state changed lazily at the top of a request must be committed even if
that same request goes on to fail with an error. For example, if a move arrives just after the
turn's deadline, the server should (a) expire the turn, hand it to the other player, and save that,
then (b) still reject the move with `409 TURN_EXPIRED` — the caller sees the new state in
`error.game`, not the old one.

`POST /games/{gameId}/turn/expire` is a client-side fallback for the server's own timer. It does
nothing before the deadline. Same-device games have no stream to piggyback on, so they rely on this
endpoint unless the server-side timer covers them too.

## Live updates (SSE)

```
GET /games/{gameId}/events?token=...
```

Streams `text/event-stream`.

- On connect, the server sends one `update` message with the full current state and `events: []`.
  A reconnect therefore fully resyncs the client — nothing needs to be replayed.
- After every state change it sends another `update` with the new `game` and the `events` that
  describe what just happened (a move, a timeout, a join, …), so the other device can animate and
  announce them.
- Send a `: ping` comment roughly every 10 seconds to stop intermediate proxies from closing the
  connection. The open stream is itself what marks that player as connected.
- Every state change increments `Game.version`. Clients should drop any state older than the one
  they already hold, and announce a given change's events only once — so it's fine that the player
  who made a move receives that same change both in the HTTP response *and* on the stream.
- Errors: `401 INVALID_TOKEN` or `404 GAME_NOT_FOUND` if the token or game don't resolve. Note this
  token is the *player* token, not the account token — see [Identity](#identity-two-kinds-of-token).

Message shape:

```
event: update
data: {"game": { ...Game... }, "events": [ ...GameEvent... ]}
```

## Conventions

- **Time.** All timestamps are ISO-8601 UTC strings. Every `Game` carries `server_time`; clients use
  it to correct their own clock skew before rendering a countdown.
- **Coordinates.** `row` and `col` are 0-based; `(0, 0)` is top-left. Grids are indexed
  `[row][col]`. `0` means an empty box.
- **Puzzle generation.** Puzzles must have exactly one solution. Suggested clue counts: easy 40,
  medium 32, hard 26. Reference implementations exist in this repo — `src/mock/generator.ts` for
  puzzle generation and `src/mock/engine.ts` for every rule above, with executable tests in
  `engine.test.ts`.

## Endpoints

| Method & path | Auth | Purpose |
| --- | --- | --- |
| `POST /auth/register` | — | Create an account (no verification) and log in. |
| `POST /auth/login` | — | Log in to an existing account. |
| `GET /auth/me` | account token | Resolve the account behind a token (restore a session). |
| `POST /auth/logout` | account token | Invalidate an account token. |
| `POST /games` | account token | Start a `single`/same-device `versus` game, or open an `online` lobby. |
| `POST /games/join` | account token | Join an online lobby by code. |
| `GET /games/{gameId}` | — | Fetch current state (used to resume after a reload). |
| `GET /games/{gameId}/events` | `?token=` (player) | Live updates over SSE. |
| `POST /games/{gameId}/moves` | `X-Player-Token` | Fill one box. |
| `POST /games/{gameId}/turn/expire` | — | Fallback: report that the current turn ran out of time. |
| `POST /games/{gameId}/forfeit` | `X-Player-Token` | Leave a running online game (you lose). |

### `POST /auth/register` — create an account

Request:

```json
{ "username": "Alex", "password": "hunter2222" }
```

`username`: 3–20 letters, digits or underscores, unique case-insensitively. `password`: 6–72
characters.

Response `201` — an `AuthSession`:

```json
{ "user": { "id": "u1", "username": "Alex", "created_at": "..." }, "token": "..." }
```

Errors: `409 USERNAME_TAKEN`, `422 VALIDATION_ERROR`.

### `POST /auth/login` — log in

Request: `{ "username": "Alex", "password": "hunter2222" }`. Response `200`: an `AuthSession`, same
shape as register (logging in again issues a new token; older tokens for the same account keep
working — there's no session limit).

Errors: `401 INVALID_CREDENTIALS` (unknown username *or* wrong password — deliberately the same
error either way, so this endpoint can't be used to test whether a username exists),
`422 VALIDATION_ERROR`.

### `GET /auth/me` — resolve a token

Header: `Authorization: Bearer <token>`. Response `200`: a `User`. Used to restore a session after
a reload, and to check a stored token is still valid. Errors: `401 INVALID_TOKEN`.

### `POST /auth/logout` — invalidate a token

Header: `Authorization: Bearer <token>`. Response `204`. Idempotent — logging out a token twice, or
one that's already invalid, is not an error.

### `POST /games` — start a game

Header: `Authorization: Bearer <account token>`.

Request:

```json
{ "mode": "versus", "difficulty": "hard", "online": true }
```

- `mode`: `"single" | "versus"`, required.
- `difficulty`: `"easy" | "medium" | "hard"`, required.
- `online`: only valid with `mode: "versus"`. Defaults to `false`.
- `player_names`: index 0 (the caller) is **always ignored** — that seat's name is the account's
  username. In practice this field only matters for index 1, the second seat of a same-device
  `versus` game (a guest with no account): trimmed, truncated to 20 characters, defaulting to
  `"Player 2"` if blank.

Response `201` — a `Session`:

```json
{
  "game": { "...": "see Game below", "status": "waiting", "join_code": "ABC234" },
  "credentials": [{ "player_id": "p1", "token": "..." }]
}
```

Same-device `versus` starts with the first turn already running (`status: in_progress`, two
`credentials`). Online starts as a `waiting` lobby (one credential, a `join_code`).

Errors: `401 INVALID_TOKEN`, `422 VALIDATION_ERROR`.

### `POST /games/join` — join an online lobby

Header: `Authorization: Bearer <account token>`.

Request:

```json
{ "code": "ABC234" }
```

Codes are case-insensitive. Seats the caller as `p2` — using *their* account's username and id, not
anything from the request — starts the game and its first turn, and notifies the host over the
event stream (`player_joined`).

Response `200` — a `Session` with the guest's player-token credential only:

```json
{
  "game": { "...": "see Game below", "status": "in_progress", "join_code": null },
  "credentials": [{ "player_id": "p2", "token": "..." }]
}
```

Errors:
- `401 INVALID_TOKEN`
- `404 JOIN_CODE_NOT_FOUND` — no open lobby with that code (also returned for a lobby that already
  started, so a stale code can't be probed for state).
- `409 GAME_FULL` — the game started a moment ago (a race with another joiner).
- `422 VALIDATION_ERROR`.

### `GET /games/{gameId}` — fetch current state

No token required. Applies anything due (timeouts, presence, forfeits) before responding. Used to
resume a game after a page reload.

Response `200`: a `Game`. Errors: `404 GAME_NOT_FOUND`.

### `GET /games/{gameId}/events` — live updates

See [Live updates (SSE)](#live-updates-sse) above. Takes the *player* token as `?token=`. Errors:
`401 INVALID_TOKEN`, `404 GAME_NOT_FOUND`.

### `POST /games/{gameId}/moves` — fill a box

Header: `X-Player-Token: <token>`.

Request:

```json
{ "row": 4, "col": 7, "value": 3 }
```

A wrong number is a normal `200` with `"result": "incorrect"` — not an error. Errors are only for
requests that can't be processed at all.

Response `200` — a `MoveResponse`:

```json
{
  "result": "correct",
  "points": 8,
  "elapsed_ms": 2500,
  "game": { "...": "the new state" },
  "events": [
    { "type": "move", "player_id": "p1", "row": 4, "col": 7, "value": 3, "result": "correct", "points": 8 }
  ]
}
```

Errors:
- `401 INVALID_TOKEN`
- `404 GAME_NOT_FOUND`
- `409`, with `error.game` set so the client can resync without another call:
  - `GAME_NOT_STARTED` — online lobby still waiting for a second player.
  - `GAME_COMPLETED` — the game is already over (including by forfeit).
  - `TURN_EXPIRED` — the deadline passed before this move arrived; the timeout has already been
    applied, and `error.game.current_turn` shows the new turn.
  - `NOT_YOUR_TURN` — the token's player isn't `current_turn.player_id`.
  - `CELL_NOT_EMPTY` — the box already holds a clue or a previously correct fill.
- `422 VALIDATION_ERROR` — bad `row`/`col`/`value`.

### `POST /games/{gameId}/turn/expire` — report a timeout

No token required (it's a fallback, not a player action). Only acts once `now >= deadline_at`, so
calling early or twice can't cut a turn short.

Response `200` — a `GameUpdate`:

```json
{
  "game": { "...": "the new state" },
  "events": [{ "type": "turn_expired", "player_id": "p2" }]
}
```

Errors:
- `404 GAME_NOT_FOUND`
- `409`:
  - `TURN_NOT_EXPIRED` — the deadline hasn't passed yet (or the server's own timer already handled
    it). `error.game` holds the current state.
  - `NO_ACTIVE_TURN` — the game is `single` mode.
  - `GAME_NOT_STARTED` — online lobby still waiting.
  - `GAME_COMPLETED` — the game is already over.

### `POST /games/{gameId}/forfeit` — leave a running online game

Header: `X-Player-Token: <token>`. Online games only, and only while `in_progress`. The caller
loses; the opponent wins with `end_reason: forfeit`. (Leaving a `waiting` lobby needs no call — it
simply expires unjoined.)

Response `200` — a `GameUpdate`, same shape as `turn/expire` above, with a `player_forfeited` event
followed by `game_completed`.

Errors: `401 INVALID_TOKEN`, `404 GAME_NOT_FOUND`, `409` (`NOT_ONLINE`, `GAME_NOT_STARTED`,
`GAME_COMPLETED`).

## Errors

Every error is:

```json
{
  "error": {
    "code": "NOT_YOUR_TURN",
    "message": "It is not your turn",
    "game": { "...": "present on 409s only" }
  }
}
```

All codes:

| Code | HTTP | Meaning |
| --- | --- | --- |
| `VALIDATION_ERROR` | 422 | Malformed request body. |
| `INVALID_TOKEN` | 401 | Missing or unknown token — account token on `/auth/me`, `/auth/logout`, `POST /games`, `POST /games/join`; player token everywhere else that needs one. |
| `USERNAME_TAKEN` | 409 | Registering with a username already in use (case-insensitively). |
| `INVALID_CREDENTIALS` | 401 | Login with an unknown username or wrong password. |
| `GAME_NOT_FOUND` | 404 | No game with that id. |
| `JOIN_CODE_NOT_FOUND` | 404 | No open lobby with that code. |
| `GAME_FULL` | 409 | The lobby just started (race on join). |
| `GAME_NOT_STARTED` | 409 | Online lobby still `waiting`. |
| `GAME_COMPLETED` | 409 | The game is already over. |
| `NOT_YOUR_TURN` | 409 | Wrong player for the current turn. |
| `TURN_EXPIRED` | 409 | Move arrived after the deadline. |
| `TURN_NOT_EXPIRED` | 409 | `turn/expire` called too early. |
| `NO_ACTIVE_TURN` | 409 | `turn/expire` called on a `single` game. |
| `NOT_ONLINE` | 409 | `forfeit` called on a non-online game. |
| `CELL_NOT_EMPTY` | 409 | Box already filled. |

## Data model

### `User`

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | |
| `username` | string | 3-20 letters, digits or underscores. Unique, case-insensitively. |
| `created_at` | datetime | |

### `Game`

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | |
| `mode` | `single \| versus` | |
| `online` | boolean | |
| `difficulty` | `easy \| medium \| hard` | |
| `status` | `waiting \| in_progress \| completed` | `waiting` only for online lobbies. |
| `join_code` | string \| null | Set only while `waiting`. |
| `puzzle` | `Grid` | Initial clues. Never changes. |
| `board` | `Grid` | Clues plus every correctly filled box. Wrong fills are never stored. |
| `players` | `Player[]` | Turn order = array order. 1 item for `single` and a waiting lobby (host only); 2 otherwise. |
| `current_turn` | `Turn \| null` | Null in `single` mode, while `waiting`, and once completed. |
| `rules` | `Rules` | The constants used in [Versus rules](#versus-rules). |
| `started_at` | datetime | Creation time; reset to the join moment for online games. |
| `completed_at` | datetime \| null | |
| `end_reason` | `solved \| forfeit \| null` | |
| `winner_id` | string \| null | Versus only; null on a draw. |
| `version` | integer | Starts at 1, increases on every state change. |
| `server_time` | datetime | For client clock-skew correction. |

### `Player`

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | Opaque; the reference mock uses `p1`/`p2`. |
| `name` | string | |
| `user_id` | string \| null | The account playing this seat (see [Identity](#identity-two-kinds-of-token)), or null for a guest — e.g. player 2 of a same-device versus game. For a future leaderboard. |
| `score` | integer | |
| `faults` | integer | Toward the fault limit; resets to 0 once the skip penalty is served. |
| `mistakes` | integer | Total wrong fills, ever. Never resets. Shown as "mistakes" in single mode. |
| `skip_turns_remaining` | integer | |
| `connected` | boolean | Online games only; always `true` otherwise. |
| `forfeit_at` | datetime \| null | Set while an online player in a running game is disconnected. |

### `Turn`

| Field | Type |
| --- | --- |
| `player_id` | string |
| `started_at` | datetime |
| `deadline_at` | datetime |

### `Rules`

| Field | Default | Meaning |
| --- | --- | --- |
| `turn_limit_ms` | 10000 | Turn length. |
| `max_points` | 10 | Points for an instant correct fill. |
| `min_points` | 1 | Floor for a correct fill's points. |
| `fault_limit` | 3 | Faults before the skip penalty. |
| `skip_turns_on_fault_limit` | 2 | Turns skipped once the fault limit is hit. |
| `disconnect_forfeit_ms` | 60000 | How long a player may stay disconnected before forfeiting. |

### `GameEvent`

A tagged union on `type`, describing one thing that just happened. Sent in `events` arrays and over
the SSE stream, in chronological order.

| `type` | Extra fields | When |
| --- | --- | --- |
| `move` | `player_id, row, col, value, result, points` | Every accepted move, correct or not. |
| `turn_expired` | `player_id` | That player's turn ran out of time. |
| `turn_skipped` | `player_id` | That player had a skip penalty consumed instead of getting the turn. |
| `fault_limit_reached` | `player_id, skip_turns` | That player just hit the fault limit. |
| `player_joined` | `player_id` | The guest joined an online lobby. |
| `player_connection` | `player_id, connected` | Online presence flipped. |
| `player_forfeited` | `player_id` | That player forfeited (explicitly or by timeout). |
| `game_completed` | — | The game just ended, for any reason. |

### `RegisterRequest` / `LoginRequest` / `AuthSession`

```ts
RegisterRequest = { username: string, password: string }
LoginRequest    = { username: string, password: string }
AuthSession     = { user: User, token: string }  // token: send as Authorization: Bearer <token>
```

### `Credential` / `Session`

```ts
Credential = { player_id: string, token: string }  // token: send as X-Player-Token
Session    = { game: Game, credentials: Credential[] }
```

`Credential.player_id` is the **seat** this token controls within this one game. It equals
`Player.id` in `game.players`, and is the id that `current_turn.player_id`, `winner_id` and every
event's `player_id` refer to. It is **not** the account's `user_id` or username. To find the
account behind a seat, look up the player with that id and read its `user_id` (`null` for a
same-device guest). It is opaque and only unique within the game; the mock uses `p1` / `p2`
(turn order).

| Field | Identifies | Scope |
|---|---|---|
| `Player.user_id` | The account playing the seat, or `null` for a guest | Global, permanent (leaderboard key) |
| `Player.name` | The account's username, or a guest name | Display only |
| `Player.id` = `Credential.player_id` | The seat in this game | This game only |

### `MoveResponse`

```ts
MoveResponse = {
  result: "correct" | "incorrect",
  points: number,       // 0 if incorrect, always 0 in single mode
  elapsed_ms: number | null,  // null in single mode
  game: Game,
  events: GameEvent[],
}
```

### `GameUpdate`

Returned by `turn/expire` and `forfeit`, and used as the `data` of every SSE `update` message:

```ts
GameUpdate = { game: Game, events: GameEvent[] }
```

## Example: full online game

```
Alex (host)                          Sam (guest)
────────────                         ───────────
POST /auth/register
  { username: Alex,
    password: hunter2222 }
→ 201 { user: {id: u1, username: Alex},
        token: acct_a }
                                      POST /auth/register
                                        { username: Sam,
                                          password: hunter2222 }
                                      → 201 { user: {id: u2, username: Sam},
                                              token: acct_s }

POST /games
  Authorization: Bearer acct_a
  { mode: versus, online: true }
→ 201 { game: { status: waiting,
        join_code: "ABC234" },
        credentials: [{p1, tok_a}] }

GET /games/g1/events?token=tok_a
  (opens stream, waits)
                                      POST /games/join
                                        Authorization: Bearer acct_s
                                        { code: ABC234 }
                                      → 200 { game: { status:
                                              in_progress, join_code: null },
                                              credentials: [{p2, tok_s}] }

  ← stream: update
    { game: {...}, events:
      [{ type: player_joined,
         player_id: p2 }] }
                                      GET /games/g1/events?token=tok_s
                                        (opens stream)

POST /games/g1/moves
  X-Player-Token: tok_a
  { row: 4, col: 7, value: 3 }
→ 200 { result: correct, points: 8,
        events: [{ type: move, ... }] }
                                      ← stream: update
                                        { events: [{ type: move,
                                          player_id: p1, ... }] }

  (Sam's turn now; if Sam doesn't
   move within 10s...)
                                      POST /games/g1/turn/expire  (fallback;
                                        the server's own timer usually beats it)
                                      → 200 { events: [{ type: turn_expired,
                                              player_id: p2 }] }
  ← stream: update
    { events: [{ type: turn_expired,
      player_id: p2 }] }

  ... play continues until the board is solved ...
  ← stream: update
    { events: [{ type: move, ... },
               { type: game_completed }] }
                                      ← stream: update (same)
```
