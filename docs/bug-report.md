# Bug report: "a mistake got reset after a few moves"

Date: 2026-10-01 · Status: investigated, no code changed · Reported second-hand (friend), not reproduced live

## Summary

Two different things can look like "a mistake got reset". Both are in the UI/rules by design, not data loss.
Which one the friend saw is unconfirmed.

| # | What the player sees | UI-only? | Cause |
|---|----------------------|----------|-------|
| 1 | A wrong number in a cell vanishes a moment later | Yes (display) | Wrong answers are never stored on the board |
| 2 | The fault pips (2-player) drop back to 0 | No (rule) | Fault counter resets after a skipped turn is served |

The server-side `mistakes` total (shown in single-player) is never reset.

## 1. Wrong number disappears (UI-only, by design)

- `submitMove` (`src/mock/engine.ts:339-352`) writes to `game.board` only when the answer is correct. An incorrect
  answer just increments `faults` and `mistakes`; the board stays `0` in that cell.
- `Board.tsx:40` shows the wrong value only while `feedback` matches that cell (`value || (fb && !fb.ok ? fb.value : 0)`).
- `useGame.ts:14,116`: feedback is cleared after `FEEDBACK_MS = 900` ms, and it is a single slot, so the next
  move (or the opponent's move arriving over the event stream) replaces it earlier.
- Result: the red number flashes for under a second and the cell goes back to empty. In a quick sequence of
  moves it can look like the mistake was "reset". The counters (`faults`, `mistakes`) were still incremented.
- Same behavior with the `http` backend: the UI logic is identical, and the server likewise only applies correct moves.

## 2. Fault pips reset to 0 (2-player rule)

- `advanceTurn` (`src/mock/engine.ts:208-215`) sets `faults = 0` when the player's last skipped turn is consumed.
  This matches `requirements.md` rule 5 ("Once done, the limit will reset back to 0").
- Faults are otherwise never reset. After 3 faults the player skips 2 turns, then the pips clear, which a few moves
  later can read as "my mistakes got reset".

## Not found

- No code path clears `mistakes`, and no path restores a cell to empty after a correct answer.
- Not checked: the real backend (`../baec-portfolio-api`) was not read; its fault reset is assumed to follow the same
  rules as the mock engine.

## Suggested follow-ups (not done, need a product decision)

1. Keep wrong numbers visible (e.g. red) until the player picks another cell or fills a new number, or lengthen `FEEDBACK_MS`.
2. Announce the fault reset (a notice such as "Faults cleared") so it is not silent.
3. Ask the friend: single-player or 2-player? Did the pips or the cell digit change? That decides which of the two it was.
