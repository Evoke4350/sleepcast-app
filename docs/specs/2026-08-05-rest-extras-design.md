# Slice 5 — Rest Extras: Quarter-Hour Rule + Step-Back

**Status:** design 2026-08-05. Fifth parity slice. Not yet built. Completes the sleep-detector feature set from slice 3.

Two opt-in-ish behaviors from sleepcast.pro's rest engine, both pure TypeScript reusing slice 3's `RestSession`:

1. **The quarter-hour rule** (CBT-I stimulus control, opt-in): if you've been restless-and-fiddling for a while, the app stops and suggests getting out of bed — because a bed shouldn't become a place you lie awake.
2. **Step-back**: after a long run of falling asleep quickly, the app offers to go quiet for a month — no resume prompts, no nudges. Retention is not the metric here.

## Reuse — engine unchanged

Both `rest/quarterhour.ts` and `rest/stepback.ts` are consumed as-is, plus the ledger's quiet/step-back persistence — no `vendor/player` edits:

- `shouldSuggestGettingUp({ elapsedMs, interactions, msSinceLastInteraction })` — fires when `elapsedMs ≥ 25min`, `interactions ≥ 3`, and the last touch was within `5min`. Slice 3's `RestSession.wakefulness(now)` already returns exactly `{ interactions, msSinceLastInteraction }`.
- `qualifiesForStepBack(loadNights())`, `isQuiet(quietUntil, now)`, `quietUntilFrom(now)`, `quietDays = 30`.
- `loadQuietUntil`/`saveQuietUntil`/`loadStepBackAsked`/`markStepBackAsked` (in `rest/ledger`).
- `Settings.quarterHourRule` (already in the store, default `false`).

## Quarter-hour rule

**Setting.** A toggle on `SetupScreen` (a Switch, like the feed toggles) bound to `settings.quarterHourRule`, persisted via `saveState`. Copy: "get-up nudge · after 25 restless minutes".

**In-night check.** In `App.tsx`'s 1s foreground interval (where the rest `tick` already runs), when `quarterHourRule` is on and the rule hasn't already fired this night:
```ts
if (quarterHourRuleRef.current && !ruleSpentRef.current && restRef.current) {
  const w = restRef.current.wakefulness(Date.now());
  if (shouldSuggestGettingUp({ elapsedMs: Date.now() - startedAtRef.current, ...w })) {
    ruleSpentRef.current = true;
    setGettingUp(true);
    endSession();            // stops playback (cancels the native timer, records the night)
  }
}
```
Fires **at most once per night** (`ruleSpentRef`). It runs in JS while foregrounded — the rule is about someone awake and touching the transport with the screen on, so foreground-only is correct (consistent with the detector).

**The suggestion.** `setGettingUp(true)` shows a small full-screen message instead of setup: "you've been up a while — the bed works best when it's for sleep. try getting up for a few minutes." with a single "ok" (`dismissGettingUp` → back to setup). `testID`s: `gettingup`, `gettingup-dismiss`.

## Step-back

**Eligibility** (computed on `SetupScreen` mount, or in `App`):
```ts
function stepBackEligible(now: number): boolean {
  if (isQuiet(loadQuietUntil(), now)) return false;         // already stepped back
  const asked = loadStepBackAsked();
  if (asked !== null && isQuiet(quietUntilFrom(asked), now)) return false; // asked recently
  return qualifiesForStepBack(loadNights());                // ≥10 of last 14 slept, median <20min
}
```

**The offer.** When eligible, `SetupScreen` shows a card above the feeds: "you've been falling asleep quickly for a while. you might not need us right now — we can stop nudging and stay out of the way." with **go quiet** / **not now**:
- go quiet → `saveQuietUntil(quietUntilFrom(now)); markStepBackAsked(now)` → card hides.
- not now → `markStepBackAsked(now)` → card hides.
`testID`s: `stepback-offer`, `stepback-accept`, `stepback-decline`.

**What "quiet" suppresses.** For 30 days, the app stops nudging: the **resume-last-night** affordance and the **quarter-hour rule** are both gated on `!isQuiet(loadQuietUntil(), now)`. (The web also gates its re-anchor and goodbye on quiet; we have no goodbye, and resume-last-night is our re-anchor.)

## JavaScript wiring

- `App.tsx`: `quarterHourRuleRef` (from `loadState().settings.quarterHourRule`, refreshed when returning from setup), `ruleSpentRef` (reset in `beginPlayback`), the interval check above, `gettingUp` state + screen. `resumeNight`-based `resumeAvailable` gains an `&& !isQuiet(loadQuietUntil(), Date.now())` guard.
- `SetupScreen.tsx`: the quarter-hour Switch (persists `quarterHourRule`), and the step-back offer card with accept/decline.

## Testing

- `quarterhour.ts`, `stepback.ts`, and the ledger are already unit-tested in `vendor/player` — unchanged.
- **New RN tests:**
  - App quarter-hour: with `quarterHourRule` on and a `RestSession` reporting `elapsedMs ≥ 25min`, `interactions ≥ 3`, recent touch, the interval sets `gettingUp` and ends the night (assert the getting-up screen renders and playback stopped / native `cancelTimer` called); it fires at most once.
  - `SetupScreen`: the quarter-hour toggle persists `settings.quarterHourRule`; the step-back offer renders only when eligible (seed a qualifying `loadNights()` + no quiet/asked), **accept** writes `quietUntil` (`loadQuietUntil()` non-null after) and `markStepBackAsked`, **decline** writes only `markStepBackAsked`.
  - Quiet suppresses: with `quietUntil` in the future, `resumeAvailable` is false even when a resumable night exists, and the quarter-hour check is skipped.
- **On-device (Pixel 7):** enable the quarter-hour toggle, start a night, tap the screen ≥3 times over a short simulated window (the 25-min threshold makes a full real test long — verify the wiring and the toggle persist; the fire path is covered by unit tests). Confirm the step-back card does not appear without qualifying history, and the toggle persists across relaunch.

## Scope

- **In:** the quarter-hour rule (opt-in toggle + in-night stop/suggest, fires once) and step-back (eligibility offer + 30-day quiet that suppresses resume + quarter-hour). Pure-TS/OTA, no native change.
- **Out:** the goodbye/morning-note (`surface.shouldGreetGoodbye`) and the drift game — separate/never. No change to the native timer, embeddings, feeds, or leveling.

## Done means

With the quarter-hour rule on, a night where you keep fiddling past ~25 minutes stops itself and suggests getting up (once). After a seeded good run, setup offers to go quiet; accepting suppresses the resume prompt and the quarter-hour rule for 30 days; the toggle and the quiet state survive a relaunch. Everything stays on device.
