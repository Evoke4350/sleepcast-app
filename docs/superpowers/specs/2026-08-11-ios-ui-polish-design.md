# iOS UI Refined-Polish — Design

**Date:** 2026-08-11
**Goal:** Make the iOS app visibly more beautiful — a refined, crafted pass over the existing dark-warm nocturnal look — without changing the Android/foss build (currently in F-Droid review).

## Direction & scope (decided)

- **Direction:** refined polish. Keep the dark-warm bedtime identity; elevate it with a real type scale, consistent spacing rhythm, consolidated color tokens, softer surfaces, and restrained motion. No structural redesign.
- **Scope:** a shared design-token foundation applied across all five screens (Setup, Player, Rest, GettingUp, YouTubeNight).
- **Typography:** Apple **SF** throughout (no bundled fonts, no serif) with a deliberate weight/size/tracking scale.
- **Platform isolation:** iOS-only. Android/foss must render **identically to today** so the in-review F-Droid submission is undisturbed.

## Architecture

A single design-token module, platform-gated, consumed by every screen in place of ad-hoc hex.

**New file: `src/theme/tokens.ts`**

- Exports a `t` object: `t.color.*`, `t.type.*` (each a partial `TextStyle`), `t.space(n)`, `t.radius.*`, `t.surface.*`, `t.hairline`.
- **Gate:** `const IOS = Platform.OS === "ios";`
  - `t.color`, `t.type`, `t.radius`, `t.space` return the **polished** values on iOS.
  - On Android they return values that reproduce the **current** appearance exactly (the existing hex + sizes), so Android is byte-for-byte visually unchanged.
- Rationale: one source of truth; screens read tokens; the gate keeps foss/Android frozen while iOS diverges. No new dependencies.

**Refactor:** each screen's `StyleSheet.create` replaces literal hex/sizes with token references. Where a layout refinement is genuinely iOS-only (e.g. tighter control row), use `Platform.select` locally rather than forking the file.

**No `.ios.tsx` screen forks** — divergence lives in the tokens + a few `Platform.select` spots, keeping single files.

## Tokens

Consolidate the ~15 current hex values into a coherent set. Android column = current look preserved.

### Color (iOS values)
| token | iOS | role | replaces |
|---|---|---|---|
| `ground` | `#050508` | app background (solid) | `#050508` |
| `surface` | `#0d0b14` | panels/cards | `#12100c`,`#171310` |
| `surfaceRaised` | `#14111d` | pressed/active surface | (new) |
| `hairline` | `rgba(240,220,184,.09)` | 1px borders | `#3a3325`,`#6f6a62` |
| `textPrimary` | `#f0dcb8` | titles, key text | `#d9c9a8` |
| `textSecondary` | `#b0a898` | body/rows | `#c8c0b0` |
| `textMuted` | `#6f6a62` | captions | `#8a7a5c` |
| `label` | `#9a875f` | uppercase labels/links | `#9a875f` |
| `accent` | `#b3746b` | active/destructive/warning | `#b3746b` |
| `focusRing` | `rgba(240,220,184,.5)` | keyboard focus | (new) |

### Type (SF; `{fontSize, fontWeight, letterSpacing, lineHeight}`)
| token | size | weight | tracking | use |
|---|---|---|---|---|
| `display` | 34 | 600 | -0.4 | player now-playing title |
| `title` | 22 | 600 | -0.2 | screen/section titles |
| `heading` | 17 | 500 | 0 | row emphasis |
| `body` | 16 | 400 | 0 | primary body |
| `bodySm` | 15 | 400 | 0 | rows, banner title |
| `label` | 13 | 500 | 0.2 | control labels |
| `micro` | 11 | 600 | 1.2 (uppercase) | eyebrows |
| `mono` | — | 400 | 0 | add `fontVariant:["tabular-nums"]` for timers/stats |

### Space / radius / surface
- `space(n)` → `n * 4` (use 1..8 → 4/8/12/16/20/24/28/32). Standardize screen padding to `space(6)` (24), row gaps `space(3)`.
- `radius`: `sm 12`, `md 16`, `pill 999`.
- `surface.panel`: `{ backgroundColor: surface, borderRadius: radius.md, borderWidth: 1, borderColor: hairline, padding: space(4) }` + iOS soft shadow (`shadowColor:#000, shadowOpacity:.35, shadowRadius:16, shadowOffset:{0,6}`).
- Ground: **solid** `ground` (`#050508`). No gradient — RN has no radial gradient without a new dependency, and we add none. Depth comes from surfaces + shadow, not the background.

### Motion
- Press feedback: `activeOpacity` ~0.6 on touchables; a shared 150ms opacity/scale on primary actions.
- Screen/element fades: gentle 200ms. **Honor Reduce Motion** (`AccessibilityInfo.isReduceMotionEnabled`) — disable transitions when on.
- No parallax, no looping ambient animation (bedtime = calm).

## Per-screen refinement

**Setup (home)** — the most-seen screen.
- Header: moon glyph + quiet title, generous top space; `micro` eyebrow for section headers (`h`).
- Feeds: each feed a `surface.panel` row with consistent rhythm; toggle + title + trim stepper aligned on a baseline; remove control uses `accent`.
- Timer options (`chip`/`chipOn`): a cohesive segmented row — selected chip uses `textPrimary` border + faint `surfaceRaised` fill.
- Start actions (`btn`): primary action gets weight (filled/`accent`-edged); secondary stays outline.
- Now-playing banner + step-back card: `surface.panel`, `micro` eyebrow, tabular-nums countdown.

**Player** — calm focus.
- Now-playing title in `display`; feed name in `label`; countdown large + serene (`title`, tabular-nums); drop the raw `vol 0.xx` debug line into a quieter treatment or remove from view.
- Lineup list: token rows, current pick marked with `accent`/filled surface.
- Controls (home/next/stop): one clean control row, evenly spaced, `pill` hit targets ≥44pt.

**Rest / GettingUp / YouTubeNight** — apply tokens (surfaces, type, spacing) for consistency; no behavior change.

## Isolation & non-goals

- **Android/foss unchanged:** verified by keeping the Android token branch equal to current literals; snapshot tests (existing `react-test-renderer`) assert Android styles don't change.
- **No behavior changes:** only presentation. All existing tests (151) must stay green.
- **No new dependencies.** No bundled fonts. No native module changes.
- Out of scope: new features, dark/light theming toggle, animations beyond restrained fades, redesign of information architecture.

## Testing

- **Unit/snapshot:** existing screen tests continue to pass; add a token-module test asserting Android values equal the pre-refactor literals (regression guard for foss).
- **Type/lint:** `tsc --noEmit` + eslint clean.
- **Device:** build to the iPhone (Release), eyeball each screen; confirm Reduce Motion disables transitions; confirm Android build visually unchanged (simulator or the foss APK).

## Files

- Create: `src/theme/tokens.ts`, `src/theme/tokens.test.ts`
- Modify: `src/screens/SetupScreen.tsx`, `PlayerScreen.tsx`, `RestScreen.tsx`, `GettingUpScreen.tsx`, `YouTubeNightScreen.tsx` (styles → tokens), and any shared style in `App.tsx`.
