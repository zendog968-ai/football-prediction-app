# Candidate UI repair — 2026-11-08

## Completed in assigned scope

Changed `client/src/pages/Home.tsx`, added `client/src/components/MatchFeed.tsx`, updated `client/src/pages/Home.test.tsx`, and added `client/src/components/MatchFeed.test.tsx`.

The reusable board shows actual home/away/league histories separately from existing model effective sample metadata. Optional `homeHistoryMatches`, `awayHistoryMatches`, `leagueHistoryMatches` and forecast diagnostic snake-case fields are supported; missing counts show `未提供`, real zero remains zero, and prior/effective/global counts are never substituted for actual team history.

Home forecast and cache cards now expose prediction as-of, update timestamp in HKT, update age, quality/stale/invalid reason, research source and odds status. Missing as-of is not replaced with update time. Optional cache-level diagnostics show actual reported fixture/valid-prediction/odds row/query-error counts and latest timestamps. Query failure is visible; the old claim that synchronized odds will appear on the next update is removed.

Cache probabilities and predicted scores are hidden for rejected/missing availability flags, explicit quality rejection, NaN/out-of-range/non-normalized vectors, missing/invalid/future update times, stale updates, or invalid/past kickoffs. Display checks follow the existing 2h prediction and 30m odds freshness limits. Ages refresh every 30 seconds. Odds missing/partial/invalid/stale/query-failed states are explicit and independent of prediction availability.

Preserved research-only behavior: no EV, stake, fair-odds decision or high-confidence recommendation is generated. Inherited free-text betting/calibration claims are suppressed. The existing manual market-implied-probability-only research module remains unchanged.

## Validation

- Baseline before edits: Home and routed feed tests **16/16 passed**; `tsc --noEmit --incremental false` passed.
- Final targeted command: `./node_modules/.bin/vitest run client/src/pages/Home.test.tsx client/src/components/MatchFeed.test.tsx client/src/pages/MatchFeed.test.tsx --testTimeout=30000 --maxWorkers=1 --minWorkers=1 --cache=false`.
- Final result: **3 files / 37 tests passed** (18 Home, 18 scoped component, 1 unchanged routed page; 86.51 seconds).
- Earlier run hit six existing 5-second UI timeouts under shared device load; sufficient CLI timeout resolved them. A minute-boundary assertion in the new integration mock was corrected; exact age boundaries remain deterministic in component tests.
- `git diff --check` for edited tracked UI/test files: **passed**.
- Final shared `tsc --noEmit --incremental false`: **blocked by 3 non-UI errors** at check time: `server/supabaseCache.ts:530` source literal union not assignable to `"Supabase cache"`; `server/teamTranslation.ts:3` missing `clearRuntimeTeamTranslation` and `registerRuntimeTeamTranslation` exports from `@shared/teamDisplay`. No UI errors were reported. These files are concurrently edited/outside scope; parent must resolve and rerun. Previously observed transient backend MapIterator/duplicate schema errors had disappeared by the final check.

## Parent-only integration blocker

Authorized `client/src/components/MatchFeed.tsx` did **not** exist on main. Actual `/` routing in `client/src/App.tsx` uses **`client/src/pages/MatchFeed.tsx`**, which is outside the assigned modification scope and was not modified. The new pure component is integrated into authorized `Home.tsx`, but that Home page is not the current `/` route. Parent must wire the actual routed page to the new component or explicitly authorize editing it before claiming the root feed is repaired. `MatchFeed` accepts already-fetched/filtered fixtures; `MatchDiagnostics` and `predictionDisplayState` are also exported for narrower integration.

Actual cache history fields are optional and may still be absent in the parent-supplied backend contract. The UI honestly shows unavailable values rather than inventing them. No browser/live-route deployment validation was performed.

No production, system/service, package, GitHub, messaging, runtime-secret or git commit mutations were performed. Typechecks used `--incremental false`, and Vitest used `--cache=false`, to avoid emitting artifacts through the production node_modules symlink.
