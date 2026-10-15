# Proposal: consecutive-timeout skip rule

Date: 2026-10-15 · Status: proposed, nothing implemented · Audience: the backend (`../baec-portfolio-api`) and the web client

## Summary

In a 2-player (versus) game, a player who lets their whole turn run out (10 s, no answer) **3 times in a row**
skips their next turn. This is separate from the existing fault rule (3 faults = skip 2 turns).

The server is authoritative for turns, faults and skips, so the rule must live in the backend. The turn
timer is client-driven (the client calls `POST /games/{id}/turn/expire` when its countdown ends), but the
counting happens in the server's expire handler, not in the client.

The in-browser mock (`src/mock/engine.ts`) is intentionally **not** updated for this rule.

## Rule

1. Versus games only. Single-player has no turns, so it is unaffected.
2. Each time a player's turn expires with no answer (`turn_expired`), increment that player's `timeouts`.
3. When `timeouts >= timeout_limit` (3), set `skip_turns_remaining = skip_turns_on_timeout_limit` (1) and
   emit `timeout_limit_reached`.
4. "Consecutive" means the streak is reset by:
   - the player submitting **any** answer before the deadline, correct or wrong (they acted in time), and
   - the skip being served, i.e. when the last owed skipped turn is consumed (same as `faults` today).
5. Skips are consumed through the existing path: `turn_skipped` event, `skip_turns_remaining` decrement.
6. Interaction with the fault rule: both feed the same `skip_turns_remaining`. If both penalties trigger,
   the skips add up (`skip_turns_remaining += n` rather than overwrite), or the backend picks another
   policy and documents it. **Open question, see below.**

Worked example (limit 3): A times out, times out, answers wrong (streak reset, `faults` +1), times out,
times out, times out. At the third timeout of the new streak A gets `skip_turns_remaining = 1` and
their next turn is skipped.

## Contract changes

All names below are proposals; the backend may rename them, but then must tell the web side.

### `Rules`

| Field | Type | Default |
|-------|------|---------|
| `timeout_limit` | number | `3` |
| `skip_turns_on_timeout_limit` | number | `1` |

They sit beside the existing `fault_limit` and `skip_turns_on_fault_limit`.

### Player

| Field | Type | Meaning |
|-------|------|---------|
| `timeouts` | number | Consecutive expired turns. Resets as in rule 4. |

Sits beside `faults` and `skip_turns_remaining`.

### Event

```json
{ "type": "timeout_limit_reached", "player_id": "...", "skip_turns": 1 }
```

Emitted by the expire handler, after `turn_expired`, when the limit is hit. The skip itself is later reported
by the existing `turn_skipped`.

These appear in the game state returned by the game endpoints, in the `update` SSE payloads and in the
`events` array of `GameUpdate`. Document them in the backend's `docs/api.md`.

## Backend checklist

- [ ] Add `timeouts` to the player model and the two fields to the rules (new games get the defaults).
- [ ] Increment in the turn-expiry path; trigger the skip at the limit; emit `timeout_limit_reached`.
- [ ] Reset `timeouts` on a timely answer (correct or wrong) and when the last owed skip is consumed.
- [ ] Make expiry idempotent: two clients calling `turn/expire` for the same turn must count **once**
      (the web client already races the server's own expiry, see `ONLINE_EXPIRE_GRACE_MS` in `useGame.ts`).
- [ ] Decide the stacking policy with the fault skip (open question 1).
- [ ] Update `docs/api.md` and the e2e tests.
- [ ] Games already in progress at deploy time: treat a missing `timeouts` as 0.

## Web client changes (after the backend names are settled)

- `src/api/types.ts`: add `timeouts` to the player, the two fields to `Rules`, and the event variant to the
  event union (`GameEvent`, next to `fault_limit_reached`).
- `src/hooks/useGame.ts` (event-to-text switch, around lines 72-79): add a message for
  `timeout_limit_reached`, e.g. "X timed out 3 times in a row and skips 1 turn". Without it the existing
  `turn_skipped` line still shows, but the reason is not explained.
- Scoreboard (optional): show a timeout counter next to the fault pips so players see the penalty coming.
- `src/api/http.ts`: expected to need no change (it passes the payload through); verify.
- Mock (`src/mock/engine.ts`, `src/api/mockApi.ts`): **not changed**. Mock games will not have `timeouts`,
  so the UI must treat a missing `timeouts` / `timeout_limit` as "feature absent" (hide the counter, no
  crash).

## Open questions

1. **Stacking.** If a fault skip (2 turns) and a timeout skip (1 turn) trigger close together, should the
   skips add up or should the larger one win? Proposal: add up.
2. **Wrong answer resets the streak?** Proposed yes, since the player acted in time. Alternative: only a
   correct answer resets it.
3. **Skipped turns and the streak.** A skipped turn is not a timeout and must not count toward the streak.
   Proposed: it neither increments nor resets it.
4. **Disconnect.** Online, a disconnected player's turns expire. Proposed: they count as timeouts like any
   other (the forfeit rules for long absences are unchanged).
