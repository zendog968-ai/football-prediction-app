# Football data-health probe handoff

**Candidate:** `/home/ubuntu/aurelia-repair-main-20261108`, baseline main `fafa07f`. **Date:** 2026-11-08 HKT. Source and synthetic tests complete; **not installed, enabled or live-validated**.

## Changes and safety

Added only `deploy/football_data_health.py`, `deploy/tests/test_football_data_health.py`, and this report. Production project, installed monitor, services, schedules, GitHub, packages and runtime credentials were not modified. No commit, external request/message, repair, restart or direct database query was performed.

The stdlib probe performs at most two fixed loopback GETs: `/api/deployment/health` and `/api/trpc/prediction.upcomingCache`. It rejects DNS/non-loopback targets, URL credentials, arbitrary paths, proxies, redirects, HTML fallback responses, malformed JSON and responses above 2 MiB. Defaults are a 3-second socket timeout and an 8-second combined network/worker deadline; bounded child processes are killed and reaped on deadline, including slow headers/body trickles. It creates no state files and never opens the env file: `--env-file` defaults to the existing `/etc/aurelia-football.env` and inspects only regular-file/root-owner/private-permission metadata.

JSON contains aggregate fixture/strict-boolean `hasPrediction` counts, cache-load age, latest sync/odds ages, release SHA/metadata and research-only-policy checks, response-schema status, safe API diagnostics, fixed warning codes and `read_only=true`. No team identities, predictions, market values, raw diagnostics/warnings, response bodies, env values, supplied paths or exception text are emitted. `--format text` produces a three-line summary below 500 characters in tests. Exit codes: **0** all observations verified, **1** attention/unknown/missing/degraded, **2** configuration/runtime failure.

Supports plain and SuperJSON tRPC responses plus single-result batch envelopes. Recognizes current shared-cache diagnostics `lastOddsAt`, `fixtureCount`, `validPredictions`, `oddsQueryErrors`, `oddsRows`, `localSnapshot`, `schemaVersion=q4-v1`, `truncated`, and aggregate warning count. Query failures, truncation and count mismatches generate attention codes without any additional Supabase request. Explicit metadata/schema status fields are allowlisted if supplied.

## Parent-only integration with installed monitor

Read-only inspection of `/opt/home-health-monitor/monitor.py` showed `collect()` and `render()` as the insertion points. Its current football webhook liveness check does not validate data freshness. **Do not run the existing monitor, even `--preview`, for an offline test:** it reads credentials and can query Telegram.

The installed monitor has `ProtectHome=true`; importing the candidate from `/home/ubuntu` inside its service will therefore fail. If approved, parent should copy the reviewed probe into a root-owned `/opt/home-health-monitor/football_data_health.py` alongside the monitor, preserving all existing timer, sender, locking, deduplication, permissions and hardening behavior. The subprocess worker locates its own installed source file, so installing the actual module—not only importing from a hidden home path—is necessary.

Illustrative integration, **not applied**:

```python
# Top-level import after parent installs the reviewed module beside monitor.py:
import football_data_health

# Within monitor.collect(), before determining final warnings/overall:
football_data = football_data_health.collect(
    env_file=ENV_FILE, request_timeout=3, total_timeout=8,
)
warnings.extend('Football data: ' + code for code in football_data['warnings'])
# Include 'football_data': football_data in the existing returned report dict.

# Within monitor.render():
lines += ['', football_data_health.render_summary(report['football_data'])]
```

Catch unexpected probe integration failures and append a fixed safe warning; a probe failure must not suppress the rest of the daily report. Retain existing delivery/dedup rules, inspect total oneshot timeout for the extra budget, and exercise the final `render()` with synthetic data against its **3,900-character** message limit. Many individual warning lines can exceed the remaining budget; parent should collapse football warning codes into one bounded line while retaining the full aggregate object in the monitor's existing private receipt. Update its old disclaimer “Application/data freshness … not validated” to describe the narrower API observation checks and remaining limitations below. This work does **not** authorize timer/service changes or a test send.

Standalone parent-run example, not executed against production during this task:

```sh
python3 -B /home/ubuntu/aurelia-repair-main-20261108/deploy/football_data_health.py \
  --env-file /etc/aurelia-football.env --format text
```

## Tests

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -B -m unittest discover \
  -s deploy/tests -p 'test_football_data_health.py' -v
```

**29/29 PASS**, final run 8.054 seconds. Covers counts, strict booleans, empty/unavailable caches, UTC/HKT ages, future/invalid timestamps, diagnostics precedence and redaction, deployment release/policy, loopback validation, two fixed synthetic GETs, proxy/redirect blocking, malformed/oversized/HTML responses, total deadlines including body trickles, metadata-only env checks, worker errors and CLI status. AST syntax validation: **2/2 PASS**. Initial suite caught explicit port-zero acceptance; fixed and retested.

Installed `monitor.py` SHA-256 stayed `c5567fa58f38f01d23bcf278309cab66d76ac405d86be9c1c80415f6860fcf08` between inspections. Tests use synthetic loopback servers and stubs only; no live production probe or runtime env-content read occurred.

## Limitations / blockers

No filesystem blocker. Integration/installation and real protected-service validation remain parent-owned.

- Existing `lastSyncAt` is the latest upcoming fixture `updated_at`, **not** a sync-job completion timestamp or evidence that every fixture is current. Output labels its source accordingly. Sync default threshold 2h is configurable, not a claim about the scheduler cadence.
- Without `lastOddsAt` diagnostics, odds age is the newest visible HDA/handicap quote only. The cache may hide stale quotes; missing age means unavailable evidence, not zero-age freshness. Latest odds do not establish full fixture/market coverage. Default threshold 30m matches current visible-quote policy.
- `schemaVersion=q4-v1` is exposed as a recognized version label, **not** proof of database schema readiness or per-row metadata validity. Current shared diagnostics do not provide explicit `metadataStatus`/`schemaStatus`, so both remain `unknown` and create attention warnings until the API supplies trustworthy statuses. Do not hide these unknowns or add expensive Supabase health queries to make the report appear green.
- `has_prediction_count` follows the API's projected `hasPrediction` flags; diagnostics `validPredictions` is reported separately and may differ as projection freshness changes.
- The GET may trigger the application's existing cache-fill queries on a miss; the probe adds no direct database/provider queries or forced refresh. One on-host observation cannot prove scheduler success, external uptime, calibration, betting performance or phone receipt.
