# Team names and UTC timestamp repair

Candidate: `/home/ubuntu/aurelia-repair-main-20261108`, baseline `fafa07f`. Candidate-only changes; no Git commit, production source mutation, service/system change, package installation, external messaging, network research, runtime-secret read, database connection or database record mutation.

## Changes

- `shared/teamDisplay.ts`: explicit canonical aliases cover CF Pachuca → 帕丘卡, Club Tijuana → 提華納, Guadalajara Chivas → 瓜達拉哈拉, VfL Bochum → 波琴, VfL Wolfsburg → 禾夫斯堡, U.N.A.M. - Pumas → 普馬斯, and Urawa → 浦和紅鑽. The first three already existed; they are retained as explicit aliases. Added narrowly enumerated Pumas/Urawa/Bochum provider variants. Lookup normalizes case, whitespace and compatibility width without rewriting the displayed English spelling. No substring/fuzzy matching of youth/reserve/women/shared short names.
- Authoritative supplied HK translation, then TW translation, still wins over fallback aliases. Names remain display-only, not team identity. Baseline display mapping has no verified numeric team-ID registry; no IDs were guessed or invented. Upstream identity-keyed translations can retain their existing precedence.
- `server/db.ts`: lazily creates a mysql2 pool with `{ uri: databaseUrl, timezone: "Z" }`, and gates **every connection checkout** on successful `SET SESSION time_zone = '+00:00'`. Driver UTC serialization alone would not fix the DB session. Application queries and transaction clients receive the connection only after setup succeeds; setup failure destroys the connection and propagates the error. This also covers new/reconnected/reused pooled connections. Existing `getDb`, user query APIs and schema are unchanged. Initialization failures no longer log raw connection error details; unused pools are closed if Drizzle initialization fails.
- Added `server/teamDisplay.test.ts` (38 cases) and `server/db.test.ts` (9 cases).

## Timestamp diagnosis and limits

Read-only source inspection confirms the production inbound audit is embedded in `/home/ubuntu/aurelia-football/server/telegramResearch.ts`, not a separate audit module. New audit inserts omit `receivedAt`, relying on schema `CURRENT_TIMESTAMP`; completion explicitly supplies JS `new Date()` for `handledAt`. Drizzle emits UTC date values, but the inherited HKT DB session interprets those values eight hours earlier. Pinning both mysql2 serialization and each session to UTC resolves that future-write discrepancy without changing server/global timezone or table defaults.

**Candidate blocker:** baseline `fafa07f` has neither inbound-audit functions nor the `telegramInboundEvents` table. Consequently no audit-specific module was changed or fabricated; production audit changes/integration remain parent-only. The general connection fix is ready for integration and its timestamp regression models the HKT-default server session using mysql2's actual Date serializer; it is not a live database/inbound end-to-end test.

No historical timestamp correction was attempted. Existing `handledAt` instants may already be incorrectly stored; UTC reads must not be described as repairing them. Any later migration must have an explicitly approved affected ID/time range, deployment cutover, verified original timezone/provenance, backup, dry-run counts, transaction/rollback and before/after validation. Do not blanket-shift historical timestamps or change old records while formatting them.

## Validation

Final focused command:

```sh
TZ=Asia/Hong_Kong node node_modules/vitest/vitest.mjs run \
  --config vitest.ci.config.ts \
  server/teamDisplay.test.ts server/db.test.ts server/telegramResearch.test.ts \
  --cache=false --maxWorkers=1 --minWorkers=1
```

**PASS: 3 files, 81 tests** (38 name tests + 9 UTC pool tests + 34 existing Telegram tests). UTC tests include missing-URL lazy behavior, explicit UTC config overriding local URI timezone, setup-before-use ordering, reused/replacement clients, setup/acquisition failure, safe initialization retry/cleanup, and future received/handled instants separated by positive 12 seconds under an HKT-default session.

- `node node_modules/typescript/bin/tsc --noEmit --incremental false`: **PASS** on final rerun; avoids writing incremental build artifacts through the shared production dependency symlink.
- Same type-check with `--target ES2022`: **PASS**.
- `git diff --check -- server/db.ts shared/teamDisplay.ts server/db.test.ts server/teamDisplay.test.ts`: **PASS**.

An earlier broader run including `server/supabaseCache.test.ts` produced **84 passed / 3 failed**: one exact cached probability assertion (`0.45` vs recalculated `0.44956510190815263`) and two stale fixture handicap-quote assertions (expected quote vs `null`). That file/module belongs to separate concurrent work and was not modified here. Earlier transient type errors in that concurrent module also cleared before the final normal type-check. No full-suite or live DB verification is claimed.

## Files changed by this task

1. `shared/teamDisplay.ts`
2. `server/teamDisplay.test.ts`
3. `server/db.ts`
4. `server/db.test.ts`
5. `reports/repair-names-time.md`

Other shared-worktree modifications belong to concurrent agents and were not edited by this task.
