#!/usr/bin/env python3
"""Read-only football health aggregates; no credentials, DB calls, sends or repairs.

Only two fixed loopback GET endpoints are permitted. Each request runs in a
short-lived child process so slow headers/body trickles cannot defeat the total
wall-clock budget. The configurable env file is lstat'ed, NEVER opened.
"""
from __future__ import annotations

import argparse
import datetime as dt
import ipaddress
import json
import math
from pathlib import Path
import re
import stat
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

UTC = dt.timezone.utc
DEFAULT_BASE_URL = "http://127.0.0.1:3100"
DEFAULT_ENV_FILE = "/etc/aurelia-football.env"
MAX_BODY_BYTES = 2 * 1024 * 1024
ENDPOINTS = {
    "deployment": "/api/deployment/health",
    "cache": "/api/trpc/prediction.upcomingCache",
}
SAFE_STATUSES = frozenset({
    "ok", "valid", "healthy", "compatible", "verified", "complete", "available",
    "missing", "invalid", "mismatch", "unavailable", "unknown", "not_checked",
    "partial", "degraded", "error",
})
GOOD_STATUSES = frozenset({"ok", "valid", "healthy", "compatible", "verified", "complete", "available"})


def validate_base_url(value: str) -> str:
    """No DNS, proxies, credentials, arbitrary paths or non-loopback targets."""
    try:
        parsed = urllib.parse.urlsplit(value)
        host = parsed.hostname
        port = parsed.port if parsed.port is not None else (443 if parsed.scheme == "https" else 80)
        if (parsed.scheme not in ("http", "https") or not host
                or not ipaddress.ip_address(host).is_loopback
                or parsed.username is not None or parsed.password is not None
                or parsed.path not in ("", "/") or parsed.query or parsed.fragment
                or not 1 <= port <= 65535
                or any(ord(c) < 33 for c in value)):
            raise ValueError
    except (ValueError, TypeError):
        raise ValueError("Invalid loopback base URL") from None
    return value.rstrip("/")


def positive_seconds(value: float) -> float:
    if not math.isfinite(value) or not 0 < value <= 120:
        raise ValueError("Timeout must be finite, positive and at most 120 seconds")
    return value


def env_file_metadata(path: str | Path) -> dict:
    """Inspect permissions only; do not read values or disclose the supplied path."""
    try:
        info = Path(path).lstat()
    except FileNotFoundError:
        return {"status": "missing", "contents_read": False}
    except OSError:
        return {"status": "unavailable", "contents_read": False}
    regular = stat.S_ISREG(info.st_mode)
    private = not bool(stat.S_IMODE(info.st_mode) & 0o077)
    return {
        "status": "ok" if regular and info.st_uid == 0 and private else "invalid",
        "regular_file": regular,
        "root_owned": info.st_uid == 0,
        "private_permissions": private,
        "contents_read": False,
    }


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class ProbeFailure(Exception):
    """A fixed safe error code, never response bodies, URLs or exception messages."""


def fetch_json(url: str, timeout: float) -> tuple[int, object]:
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    request = urllib.request.Request(url, method="GET", headers={"Accept": "application/json"})
    try:
        with opener.open(request, timeout=timeout) as response:
            if response.status != 200:
                raise ProbeFailure("UnexpectedHttpStatus")
            body = response.read(MAX_BODY_BYTES + 1)
            if len(body) > MAX_BODY_BYTES:
                raise ProbeFailure("ResponseTooLarge")
            # Reject HTML fallbacks rather than treating a frontend 200 as liveness.
            if "json" not in response.headers.get("Content-Type", "").lower():
                raise ProbeFailure("InvalidContentType")
            try:
                return response.status, json.loads(body, parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
            except (ValueError, UnicodeError, RecursionError):
                raise ProbeFailure("InvalidJson") from None
    except urllib.error.HTTPError as error:
        raise ProbeFailure("HttpStatus" + str(error.code)) from None
    except ProbeFailure:
        raise
    except (TimeoutError, urllib.error.URLError):
        raise ProbeFailure("NetworkUnavailable") from None
    except Exception:
        raise ProbeFailure("TransportFailure") from None


def parse_timestamp(value: object) -> dt.datetime | None:
    if not isinstance(value, str) or len(value) > 64:
        return None
    if not re.search(r"(?:Z|[+-]\d{2}:\d{2})$", value):
        return None
    try:
        parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            return None
        return parsed.astimezone(UTC)
    except (ValueError, OverflowError):
        return None


def freshness(value: object, now: dt.datetime, max_age: float, source: str) -> dict:
    stamp = parse_timestamp(value)
    if value is None:
        status = "missing"
    elif stamp is None:
        status = "invalid"
    elif stamp > now:
        status = "future"
    else:
        age = (now - stamp).total_seconds()
        return {"status": "fresh" if age <= max_age else "stale",
                "at_utc": stamp.isoformat(), "age_seconds": round(age, 3), "source": source}
    return {"status": status, "at_utc": stamp.isoformat() if status == "future" and stamp is not None else None, "age_seconds": None, "source": source}


def unwrap_cache(payload: object) -> dict:
    if isinstance(payload, list):
        if len(payload) != 1:
            raise ProbeFailure("InvalidTrpcEnvelope")
        payload = payload[0]
    if not isinstance(payload, dict):
        raise ProbeFailure("InvalidTrpcEnvelope")
    if "error" in payload:
        raise ProbeFailure("TrpcError")
    result = payload.get("result")
    if not isinstance(result, dict) or "data" not in result:
        raise ProbeFailure("InvalidTrpcEnvelope")
    data = result["data"]
    # SuperJSON's metadata only describes serialization; it is NOT DB diagnostics.
    if isinstance(data, dict) and "json" in data:
        data = data["json"]
    if not isinstance(data, dict):
        raise ProbeFailure("InvalidCacheSchema")
    return data


def diagnostic_status(diagnostics: dict, key: str) -> str:
    value = diagnostics.get(key + "Status", diagnostics.get(key + "_status"))
    if value is None:
        value = diagnostics.get(key)
    if isinstance(value, dict):
        value = value.get("status")
    return value if isinstance(value, str) and value in SAFE_STATUSES else "unknown"


def diagnostic_metadata(diagnostics: dict, present: bool) -> dict:
    """Allowlist aggregate diagnostic fields; a version label is not a DB audit."""
    result = {"present": present,
              "metadata_status": diagnostic_status(diagnostics, "metadata"),
              "schema_status": diagnostic_status(diagnostics, "schema"),
              "schema_version": "q4-v1" if diagnostics.get("schemaVersion") == "q4-v1" else None}
    for source, target in (("fixtureCount", "fixture_count"), ("validPredictions", "valid_predictions"),
                           ("oddsQueryErrors", "odds_query_errors"), ("oddsRows", "odds_rows")):
        value = diagnostics.get(source)
        result[target] = value if type(value) is int and 0 <= value <= 2**53 - 1 else None
    for source, target in (("localSnapshot", "local_snapshot"), ("truncated", "truncated")):
        value = diagnostics.get(source)
        result[target] = value if type(value) is bool else None
    warnings = diagnostics.get("warnings")
    result["warning_count"] = len(warnings) if isinstance(warnings, list) else None
    return result


def first_timestamp_field(objects: list[dict], keys: tuple[str, ...]) -> tuple[object, bool]:
    for obj in objects:
        for key in keys:
            if key in obj:
                return obj[key], True
    return None, False


def summarize_deployment(payload: object) -> dict:
    if not isinstance(payload, dict):
        raise ProbeFailure("InvalidDeploymentSchema")
    if payload.get("ok") is not True or payload.get("service") != "aurelia-football":
        raise ProbeFailure("InvalidDeploymentSchema")
    sha = payload.get("releaseSha")
    valid_sha = isinstance(sha, str) and re.fullmatch(r"[a-fA-F0-9]{40}", sha) is not None
    policy = payload.get("policy")
    policy = policy if isinstance(policy, dict) else {}
    safe_policy = (policy.get("mode") == "research-only"
                   and all(policy.get(k) is False for k in
                           ("highConfidenceEnabled", "bettingAdviceEnabled", "expectedValueEnabled")))
    return {"ok": True, "http": 200, "schema_status": "valid",
            "release_sha": sha.lower() if valid_sha else None,
            "metadata_status": "valid" if valid_sha else "missing" if sha is None else "invalid",
            "research_only_policy": safe_policy}


def summarize_cache(payload: object, now: dt.datetime, sync_max_age: float, odds_max_age: float) -> dict:
    cache = unwrap_cache(payload)
    rows = cache.get("fixtures")
    if not isinstance(rows, list) or type(cache.get("available")) is not bool:
        raise ProbeFailure("InvalidCacheSchema")
    invalid_rows = sum(not isinstance(row, dict) or type(row.get("hasPrediction")) is not bool for row in rows)
    valid_rows = [row for row in rows if isinstance(row, dict)]
    diagnostics = cache.get("diagnostics")
    diagnostics = diagnostics if isinstance(diagnostics, dict) else {}
    sync_at, sync_diagnostic = first_timestamp_field(
        [diagnostics], ("lastSyncAt", "latestSyncAt", "last_sync_at", "latest_sync_at"))
    if not sync_diagnostic:
        sync_at = cache.get("lastSyncAt")
    odds_at, odds_diagnostic = first_timestamp_field(
        [diagnostics, cache], ("latestOddsAt", "lastOddsAt", "latestOddsSnapshotAt", "latest_odds_at", "last_odds_at"))
    quotes = [row.get(key) for row in valid_rows for key in ("odds", "handicapQuote")]
    quote_times = [parse_timestamp(q.get("capturedAt")) for q in quotes if isinstance(q, dict)]
    quote_times = [stamp for stamp in quote_times if stamp is not None]
    if not odds_diagnostic:
        odds_at = max(quote_times).isoformat() if quote_times else None
    prediction_count = sum(row.get("hasPrediction") is True for row in valid_rows)
    return {
        "ok": cache["available"] and invalid_rows == 0,
        "http": 200,
        "available": cache["available"],
        "response_schema_status": "valid" if invalid_rows == 0 else "invalid",
        "fixture_count": len(rows),
        "has_prediction_count": prediction_count,
        "invalid_row_count": invalid_rows,
        "fallback": cache.get("fallback") if type(cache.get("fallback")) is bool else None,
        "cache_loaded": freshness(cache.get("loadedAt"), now, 120, "api_cache_loaded_at"),
        "latest_sync": freshness(sync_at, now, sync_max_age,
                                 "api_diagnostics" if sync_diagnostic else "upcoming_fixture_updated_at"),
        "latest_odds": freshness(odds_at, now, odds_max_age,
                                 "api_diagnostics" if odds_diagnostic else "visible_cache_quotes"),
        "visible_odds_timestamp_count": len(quote_times),
        "diagnostics": diagnostic_metadata(diagnostics, isinstance(cache.get("diagnostics"), dict)),
        # No free-text reason, fixture/team identities, predictions or market values.
        "reason_present": isinstance(cache.get("reason"), str) and bool(cache["reason"]),
    }


def reconcile_inflight_cache_time(summary: dict, started: dt.datetime, ended: dt.datetime) -> dict:
    # The API can build a fresh cache after the parent probe clock was sampled.
    # Only a loadedAt proven to occur INSIDE this HTTP request is reconciled.
    loaded = summary.get('cache_loaded', {})
    stamp = parse_timestamp(loaded.get('at_utc'))
    if loaded.get('status') == 'future' and stamp is not None and started <= stamp <= ended:
        summary['cache_loaded'] = freshness(stamp.isoformat(), ended, 120, 'api_cache_loaded_at')
    return summary


def endpoint_summary(base_url: str, kind: str, timeout: float, now: dt.datetime,
                     sync_max_age: float, odds_max_age: float) -> dict:
    try:
        request_started = dt.datetime.now(UTC)
        _, payload = fetch_json(validate_base_url(base_url) + ENDPOINTS[kind], timeout)
        request_ended = dt.datetime.now(UTC)
        if kind == "deployment":
            return summarize_deployment(payload)
        return reconcile_inflight_cache_time(summarize_cache(payload, now, sync_max_age, odds_max_age), request_started, request_ended)
    except ProbeFailure as error:
        code = str(error)
        result = {"ok": False, "error_code": code}
        if re.fullmatch(r"HttpStatus\d{3}", code):
            result["http"] = int(code[-3:])
        return result


def run_endpoint(base_url: str, kind: str, timeout: float, budget: float,
                 now: dt.datetime, sync_max_age: float, odds_max_age: float) -> dict:
    """Hard wall-clock limit including child startup and all response parsing."""
    command = [sys.executable, "-B", str(Path(__file__).resolve()), "--_endpoint", kind,
               "--base-url", base_url, "--request-timeout", str(timeout),
               "--now-utc", now.isoformat(), "--sync-max-age", str(sync_max_age),
               "--odds-max-age", str(odds_max_age)]
    try:
        result = subprocess.run(command, capture_output=True, text=True,
                                timeout=budget, check=False)
        if result.returncode != 0:
            return {"ok": False, "error_code": "ProbeWorkerFailed"}
        data = json.loads(result.stdout)
        if not isinstance(data, dict) or type(data.get("ok")) is not bool:
            return {"ok": False, "error_code": "InvalidWorkerResponse"}
        return data
    except subprocess.TimeoutExpired:
        # subprocess.run kills and waits for the child before raising.
        return {"ok": False, "error_code": "DeadlineExceeded"}
    except (OSError, ValueError):
        return {"ok": False, "error_code": "ProbeWorkerUnavailable"}


def collect(base_url: str = DEFAULT_BASE_URL, env_file: str | Path = DEFAULT_ENV_FILE,
            request_timeout: float = 3, total_timeout: float = 8,
            sync_max_age: float = 7200, odds_max_age: float = 1800,
            now: dt.datetime | None = None) -> dict:
    base_url = validate_base_url(base_url)
    request_timeout, total_timeout = positive_seconds(request_timeout), positive_seconds(total_timeout)
    if not all(math.isfinite(v) and v > 0 for v in (sync_max_age, odds_max_age)):
        raise ValueError("Freshness thresholds must be finite and positive")
    now = now or dt.datetime.now(UTC)
    if now.tzinfo is None:
        raise ValueError("Check time must have a timezone")
    now = now.astimezone(UTC)
    deadline = time.monotonic() + total_timeout
    checks = {}
    for kind in ENDPOINTS:
        remaining = deadline - time.monotonic()
        checks[kind] = (run_endpoint(base_url, kind, request_timeout,
                                    min(request_timeout + 0.5, remaining), now,
                                    sync_max_age, odds_max_age) if remaining > 0
                        else {"ok": False, "error_code": "DeadlineExceeded"})
    env = env_file_metadata(env_file)
    warnings = []
    deployment, cache = checks["deployment"], checks["cache"]
    for kind, check in checks.items():
        if not check.get("ok"):
            warnings.append(kind.upper() + "_CHECK_FAILED")
    if deployment.get("ok"):
        if deployment["metadata_status"] != "valid":
            warnings.append("RELEASE_METADATA_UNVERIFIED")
        if not deployment["research_only_policy"]:
            warnings.append("RESEARCH_POLICY_UNVERIFIED")
    if "fixture_count" in cache:
        count = cache["fixture_count"]
        if count == 0 and cache.get("available"):
            warnings.append("NO_UPCOMING_FIXTURES")
        if count and cache["has_prediction_count"] < count:
            warnings.append("PREDICTION_COVERAGE_INCOMPLETE")
        for name in ("latest_sync", "latest_odds"):
            if cache[name]["status"] != "fresh" and count:
                warnings.append(name.upper() + "_" + cache[name]["status"].upper())
        if cache["cache_loaded"]["status"] != "fresh":
            warnings.append("CACHE_LOAD_TIME_UNVERIFIED")
        for name in ("metadata_status", "schema_status"):
            if cache["diagnostics"][name] not in GOOD_STATUSES:
                warnings.append("DIAGNOSTICS_" + name.upper() + "_UNVERIFIED")
        diagnostics = cache["diagnostics"]
        if diagnostics["odds_query_errors"]:
            warnings.append("ODDS_QUERY_ERRORS_PRESENT")
        if diagnostics["warning_count"]:
            warnings.append("API_DIAGNOSTICS_WARNINGS_PRESENT")
        if diagnostics["truncated"] is True:
            warnings.append("CACHE_DIAGNOSTICS_TRUNCATED")
        if diagnostics["fixture_count"] is not None and diagnostics["fixture_count"] != count:
            warnings.append("DIAGNOSTICS_FIXTURE_COUNT_MISMATCH")
    if env["status"] != "ok":
        warnings.append("ENV_FILE_METADATA_UNVERIFIED")
    return {"schema_version": 1, "checked_at_utc": now.isoformat(),
            "overall": "ATTENTION" if warnings else "OK", "read_only": True,
            "deployment": deployment, "cache": cache, "env_file": env,
            "warnings": warnings,
            "limits": {"total_timeout_seconds": total_timeout,
                       "request_timeout_seconds": request_timeout,
                       "max_response_bytes": MAX_BODY_BYTES,
                       "sync_max_age_seconds": sync_max_age,
                       "odds_max_age_seconds": odds_max_age},
            "direct_database_queries": 0, "external_requests": 0}


def render_summary(report: dict) -> str:
    cache = report.get("cache", {})
    deployment = report.get("deployment", {})
    diagnostics = cache.get("diagnostics", {})
    def age(name):
        item = cache.get(name, {})
        seconds = item.get("age_seconds")
        return (f"{round(seconds / 60, 1)}m ({item.get('status', 'unknown')})"
                if isinstance(seconds, (int, float)) else item.get("status", "unavailable"))
    sha = deployment.get("release_sha")
    return (f"Football data: {report.get('overall', 'ATTENTION')} | "
            f"fixtures {cache.get('fixture_count', '?')} | hasPrediction {cache.get('has_prediction_count', '?')}\n"
            f"Latest sync {age('latest_sync')} | latest odds {age('latest_odds')} | "
            f"release {sha[:12] if sha else 'unverified'}\n"
            f"Diagnostics metadata {diagnostics.get('metadata_status', 'unavailable')} / "
            f"schema {diagnostics.get('schema_status', 'unavailable')} | read-only")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL)
    parser.add_argument("--env-file", default=DEFAULT_ENV_FILE,
                        help="Existing env-file path; metadata only, contents never read")
    parser.add_argument("--request-timeout", type=float, default=3)
    parser.add_argument("--total-timeout", type=float, default=8)
    parser.add_argument("--sync-max-age", type=float, default=7200, help="Seconds; observation age, not sync job success")
    parser.add_argument("--odds-max-age", type=float, default=1800, help="Seconds; latest observation, not complete coverage")
    parser.add_argument("--format", choices=("json", "text"), default="json")
    parser.add_argument("--_endpoint", choices=tuple(ENDPOINTS), help=argparse.SUPPRESS)
    parser.add_argument("--now-utc", help=argparse.SUPPRESS)
    args = parser.parse_args(argv)
    try:
        if args._endpoint:
            positive_seconds(args.request_timeout)
            now = parse_timestamp(args.now_utc)
            if now is None or not all(math.isfinite(v) and v > 0 for v in (args.sync_max_age, args.odds_max_age)):
                raise ValueError
            report = endpoint_summary(args.base_url, args._endpoint, args.request_timeout,
                                      now, args.sync_max_age, args.odds_max_age)
        else:
            report = collect(args.base_url, args.env_file, args.request_timeout,
                             args.total_timeout, args.sync_max_age, args.odds_max_age)
    except Exception:
        # Never log URLs, response bodies, filesystem paths or exception text.
        print(json.dumps({"overall": "ATTENTION", "read_only": True, "error_code": "ProbeConfigurationOrRuntimeError"}))
        return 2
    print(render_summary(report) if args.format == "text" and not args._endpoint else json.dumps(report, sort_keys=True))
    return 0 if args._endpoint or report["overall"] == "OK" else 1


if __name__ == "__main__":
    raise SystemExit(main())
