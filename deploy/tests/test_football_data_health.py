#!/usr/bin/env python3
"""Stdlib tests: synthetic loopback responses only; no live env, DB or sends."""
from __future__ import annotations

import contextlib
import copy
import datetime as dt
import http.server
import importlib.util
import io
import json
import os
from pathlib import Path
import socket
import stat
import subprocess
import sys
import threading
import time
from types import SimpleNamespace
import unittest
from unittest import mock

MODULE_PATH = Path(__file__).resolve().parents[1] / "football_data_health.py"
spec = importlib.util.spec_from_file_location("football_data_health", MODULE_PATH)
assert spec and spec.loader
health = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = health
spec.loader.exec_module(health)
NOW = dt.datetime(2026, 11, 8, 2, 0, tzinfo=dt.timezone.utc)
SHA = "a" * 40
SECRET = "DO_NOT_LEAK_PRIVATE_VALUE"


def deployment():
    return {"ok": True, "service": "aurelia-football", "releaseSha": SHA,
            "policy": {"mode": "research-only", "highConfidenceEnabled": False,
                       "bettingAdviceEnabled": False, "expectedValueEnabled": False}}


def cache():
    return {"available": True, "loadedAt": "2026-11-08T02:00:00Z",
            "lastSyncAt": "2026-11-08T01:30:00Z", "fallback": False,
            "fixtures": [
                {"fixtureId": 101, "homeTeam": SECRET, "hasPrediction": True,
                 "odds": {"home": 1.9, "capturedAt": "2026-11-08T01:45:00Z"}},
                {"fixtureId": 102, "hasPrediction": False,
                 "handicapQuote": {"capturedAt": "2026-11-08T01:55:00Z"}}]}


def trpc(data, superjson=True, batch=False):
    value = {"result": {"data": {"json": data, "meta": {"values": SECRET}} if superjson else data}}
    return [value] if batch else value


class SyntheticHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.server.paths.append(self.path)
        body, status, content_type, delay = self.server.responses.get(
            self.path, (b"", 404, "application/json", 0))
        if delay:
            time.sleep(delay)
        try:
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            if status == 302:
                self.send_header("Location", "http://192.0.2.1/" + SECRET)
            self.end_headers()
            if getattr(self.server, "trickle", False):
                for byte in body:
                    self.wfile.write(bytes([byte]))
                    self.wfile.flush()
                    time.sleep(0.05)
            else:
                self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def log_message(self, *_):
        pass


@contextlib.contextmanager
def server(responses):
    instance = http.server.ThreadingHTTPServer(("127.0.0.1", 0), SyntheticHandler)
    instance.daemon_threads = True
    instance.responses = responses
    instance.paths = []
    worker = threading.Thread(target=instance.serve_forever, daemon=True)
    worker.start()
    try:
        yield instance, "http://127.0.0.1:" + str(instance.server_port)
    finally:
        instance.shutdown()
        instance.server_close()
        worker.join(timeout=2)


def encoded(payload, status=200, content_type="application/json", delay=0):
    return json.dumps(payload).encode(), status, content_type, delay


class FootballDataHealthTests(unittest.TestCase):
    def summary(self, value=None):
        return health.summarize_cache(trpc(cache() if value is None else value), NOW, 7200, 1800)

    def test_loopback_targets_only(self):
        for value in ("http://127.0.0.1:3100", "http://127.1.2.3:3100/", "http://[::1]:3100"):
            self.assertEqual(health.validate_base_url(value), value.rstrip("/"))
        for value in ("http://localhost:3100", "http://192.0.2.1:3100", "http://0.0.0.0:3100",
                      "file:///tmp/file", "http://user:pass@127.0.0.1", "http://127.0.0.1/api",
                      "http://127.0.0.1?token=" + SECRET, "http://127.0.0.1#fragment",
                      "http://127.0.0.1:0", "http://127.0.0.1:99999", "http://127.0.0.1\n"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                health.validate_base_url(value)

    def test_no_secret_file_contents_read(self):
        info = SimpleNamespace(st_mode=stat.S_IFREG | 0o600, st_uid=0)
        with mock.patch.object(Path, "lstat", return_value=info), \
                mock.patch.object(Path, "read_text", side_effect=AssertionError("Contents accessed")), \
                mock.patch("builtins.open", side_effect=AssertionError("File opened")):
            result = health.env_file_metadata("/custom/existing.env")
        self.assertEqual(result["status"], "ok")
        self.assertFalse(result["contents_read"])
        self.assertNotIn("/custom", json.dumps(result))

    def test_env_metadata_fail_closed(self):
        for mode, uid in ((stat.S_IFLNK | 0o600, 0), (stat.S_IFREG | 0o644, 0), (stat.S_IFREG | 0o600, 1000)):
            with mock.patch.object(Path, "lstat", return_value=SimpleNamespace(st_mode=mode, st_uid=uid)):
                self.assertEqual(health.env_file_metadata("ignored")["status"], "invalid")
        for error, status in ((FileNotFoundError(), "missing"), (PermissionError(), "unavailable")):
            with mock.patch.object(Path, "lstat", side_effect=error):
                self.assertEqual(health.env_file_metadata("ignored")["status"], status)

    def test_counts_and_latest_visible_odds(self):
        result = self.summary()
        self.assertEqual(result["fixture_count"], 2)
        self.assertEqual(result["has_prediction_count"], 1)
        self.assertEqual(result["latest_sync"]["age_seconds"], 1800)
        self.assertEqual(result["latest_odds"]["age_seconds"], 300)
        self.assertEqual(result["latest_odds"]["source"], "visible_cache_quotes")
        self.assertEqual(result["latest_sync"]["source"], "upcoming_fixture_updated_at")
        self.assertNotIn(SECRET, json.dumps(result))
        self.assertNotIn("homeTeam", json.dumps(result))

    def test_trpc_and_superjson_single_batch(self):
        for superjson in (True, False):
            for batch in (True, False):
                self.assertEqual(health.unwrap_cache(trpc(cache(), superjson, batch)), cache())

    def test_invalid_trpc_envelopes_rejected(self):
        for value in ({"error": {"message": SECRET}}, [], [trpc(cache()), trpc(cache())],
                      None, {"result": {}}, {"result": {"data": []}}):
            with self.subTest(value=value), self.assertRaises(health.ProbeFailure) as raised:
                health.unwrap_cache(value)
            self.assertNotIn(SECRET, str(raised.exception))

    def test_missing_boolean_and_fixtures_schema(self):
        for key, value in (("available", "true"), ("fixtures", None)):
            payload = cache()
            payload[key] = value
            with self.assertRaises(health.ProbeFailure):
                self.summary(payload)

    def test_prediction_boolean_strict_and_invalid_rows(self):
        payload = cache()
        payload["fixtures"] += [{"hasPrediction": "true"}, None, {"hasPrediction": 1}]
        result = self.summary(payload)
        self.assertEqual(result["has_prediction_count"], 1)
        self.assertEqual(result["invalid_row_count"], 3)
        self.assertEqual(result["response_schema_status"], "invalid")
        self.assertFalse(result["ok"])

    def test_empty_cache_not_false_transport_failure(self):
        payload = cache()
        payload.update(fixtures=[], lastSyncAt=None)
        result = self.summary(payload)
        self.assertEqual(result["fixture_count"], 0)
        self.assertTrue(result["ok"])
        self.assertEqual(result["latest_sync"]["status"], "missing")

    def test_cache_unavailable_does_not_echo_reason(self):
        payload = cache()
        payload.update(available=False, reason="https://host/" + SECRET, fixtures=[])
        result = self.summary(payload)
        self.assertFalse(result["ok"])
        self.assertTrue(result["reason_present"])
        self.assertNotIn(SECRET, json.dumps(result))

    def test_timezone_independent_freshness(self):
        result = health.freshness("2026-11-08T09:30:00+08:00", NOW, 1800, "test")
        self.assertEqual(result["age_seconds"], 1800)
        self.assertEqual(result["status"], "fresh")
        self.assertEqual(health.freshness("2026-11-08T01:29:59Z", NOW, 1800, "test")["status"], "stale")

    def test_invalid_missing_and_future_timestamps(self):
        for value, expected in ((None, "missing"), ("2026-11-08 01:59:00", "invalid"),
                                (SECRET, "invalid"), ("2026-02-30T01:00:00Z", "invalid"),
                                ("2026-11-08T02:00:01Z", "future"), (True, "invalid")):
            result = health.freshness(value, NOW, 1800, "test")
            self.assertEqual(result["status"], expected)
            self.assertIsNone(result["age_seconds"])
            self.assertNotIn(SECRET, json.dumps(result))

    def test_diagnostics_preferred_without_other_db_requests(self):
        payload = cache()
        payload["diagnostics"] = {"latestSyncAt": "2026-11-08T01:59:00Z",
                                  "latestOddsAt": "2026-11-08T01:58:00Z",
                                  "metadataStatus": "valid", "schema": {"status": "compatible"},
                                  "privateField": SECRET}
        result = self.summary(payload)
        self.assertEqual(result["latest_sync"]["age_seconds"], 60)
        self.assertEqual(result["latest_odds"]["age_seconds"], 120)
        self.assertEqual(result["latest_sync"]["source"], "api_diagnostics")
        self.assertEqual(result["diagnostics"]["schema_status"], "compatible")
        self.assertNotIn(SECRET, json.dumps(result))

    def test_missing_diagnostics_not_inferred_from_superjson_meta(self):
        result = self.summary()["diagnostics"]
        self.assertFalse(result["present"])
        self.assertEqual(result["metadata_status"], "unknown")
        self.assertEqual(result["schema_status"], "unknown")
        self.assertIsNone(result["schema_version"])

    def test_candidate_aggregate_diagnostics_and_warnings(self):
        payload = cache()
        payload["diagnostics"] = {
            "fixtureCount": 3, "validPredictions": 1, "oddsQueryErrors": 1,
            "oddsRows": 120, "localSnapshot": True, "schemaVersion": "q4-v1",
            "truncated": True, "warnings": [SECRET], "lastOddsAt": "2026-11-08T01:40:00Z"}
        summary = self.summary(payload)
        diagnostics = summary["diagnostics"]
        self.assertEqual(diagnostics["schema_version"], "q4-v1")
        self.assertEqual(diagnostics["schema_status"], "unknown")
        self.assertEqual(diagnostics["odds_rows"], 120)
        self.assertEqual(diagnostics["warning_count"], 1)
        self.assertEqual(summary["latest_odds"]["age_seconds"], 1200)
        self.assertNotIn(SECRET, json.dumps(summary))
        with mock.patch.object(health, "run_endpoint", side_effect=[health.summarize_deployment(deployment()), summary]), \
                mock.patch.object(health, "env_file_metadata", return_value={"status": "ok"}):
            report = health.collect(now=NOW)
        for warning in ("ODDS_QUERY_ERRORS_PRESENT", "API_DIAGNOSTICS_WARNINGS_PRESENT",
                        "CACHE_DIAGNOSTICS_TRUNCATED", "DIAGNOSTICS_FIXTURE_COUNT_MISMATCH"):
            self.assertIn(warning, report["warnings"])

    def test_free_text_diagnostics_rejected(self):
        payload = cache()
        payload["diagnostics"] = {"metadata_status": SECRET, "schema_status": "valid\n" + SECRET}
        self.assertEqual(self.summary(payload)["diagnostics"]["metadata_status"], "unknown")
        self.assertNotIn(SECRET, json.dumps(self.summary(payload)))

    def test_authoritative_missing_or_invalid_diagnostic_not_faked_by_quote(self):
        payload = cache()
        payload["diagnostics"] = {"latestOddsAt": None, "latestSyncAt": SECRET}
        result = self.summary(payload)
        self.assertEqual(result["latest_odds"]["status"], "missing")
        self.assertEqual(result["latest_sync"]["status"], "invalid")

    def test_deployment_release_and_policy(self):
        result = health.summarize_deployment(deployment())
        self.assertEqual(result["release_sha"], SHA)
        self.assertTrue(result["research_only_policy"])
        for sha, status in ((None, "missing"), (SECRET, "invalid"), ("g" * 40, "invalid")):
            payload = deployment()
            payload["releaseSha"] = sha
            result = health.summarize_deployment(payload)
            self.assertEqual(result["metadata_status"], status)
            self.assertIsNone(result["release_sha"])
            self.assertNotIn(SECRET, json.dumps(result))
        payload = deployment()
        payload["policy"]["highConfidenceEnabled"] = True
        self.assertFalse(health.summarize_deployment(payload)["research_only_policy"])

    def test_wrong_deployment_schema_rejected(self):
        for payload in (None, [], {"ok": 1, "service": "aurelia-football"}, {"ok": True, "service": SECRET}):
            with self.assertRaises(health.ProbeFailure):
                health.summarize_deployment(payload)

    def test_network_two_fixed_gets_and_compact_safe_summary(self):
        responses = {health.ENDPOINTS["deployment"]: encoded(deployment()),
                     health.ENDPOINTS["cache"]: encoded(trpc(cache()))}
        with server(responses) as (instance, base):
            with mock.patch.object(health, "env_file_metadata", return_value={"status": "ok", "contents_read": False}):
                result = health.collect(base, now=NOW)
        self.assertEqual(instance.paths, list(health.ENDPOINTS.values()))
        self.assertEqual(result["direct_database_queries"], 0)
        self.assertEqual(result["external_requests"], 0)
        self.assertEqual(result["cache"]["fixture_count"], 2)
        self.assertEqual(result["overall"], "ATTENTION")
        self.assertIn("DIAGNOSTICS_SCHEMA_STATUS_UNVERIFIED", result["warnings"])
        text = health.render_summary(result)
        self.assertLess(len(text), 500)
        self.assertIn("hasPrediction 1", text)
        self.assertNotIn(SECRET, json.dumps(result) + text)

    def test_all_verified_observations_can_be_ok(self):
        payload = cache()
        payload["fixtures"][1]["hasPrediction"] = True
        payload["diagnostics"] = {"metadata_status": "valid", "schema_status": "ok"}
        summaries = [health.summarize_deployment(deployment()), self.summary(payload)]
        with mock.patch.object(health, "run_endpoint", side_effect=summaries), \
                mock.patch.object(health, "env_file_metadata", return_value={"status": "ok", "contents_read": False}):
            result = health.collect(now=NOW)
        self.assertEqual(result["overall"], "OK")
        self.assertEqual(result["warnings"], [])

    def test_deadline_kills_child_and_safe_error(self):
        responses = {health.ENDPOINTS["deployment"]: encoded(deployment(), delay=1.2),
                     health.ENDPOINTS["cache"]: encoded(trpc(cache()))}
        with server(responses) as (_, base), mock.patch.object(health, "env_file_metadata", return_value={"status": "ok"}):
            start = time.monotonic()
            result = health.collect(base, request_timeout=2, total_timeout=0.25, now=NOW)
            elapsed = time.monotonic() - start
        self.assertLess(elapsed, 1)
        self.assertEqual(result["deployment"]["error_code"], "DeadlineExceeded")
        self.assertEqual(result["cache"]["error_code"], "DeadlineExceeded")

    def test_trickling_body_cannot_extend_wall_clock_budget(self):
        responses = {health.ENDPOINTS["deployment"]: encoded(deployment())}
        with server(responses) as (instance, base), mock.patch.object(health, "env_file_metadata", return_value={"status": "ok"}):
            instance.trickle = True
            start = time.monotonic()
            result = health.collect(base, request_timeout=0.2, total_timeout=0.45, now=NOW)
            elapsed = time.monotonic() - start
        self.assertLess(elapsed, 1)
        self.assertEqual(result["deployment"]["error_code"], "DeadlineExceeded")

    def test_no_proxy_and_no_redirect_follow(self):
        responses = {health.ENDPOINTS["deployment"]: encoded({}, status=302)}
        with server(responses) as (instance, base), mock.patch.dict(os.environ, {
            "HTTP_PROXY": "http://192.0.2.1:1", "http_proxy": "http://192.0.2.1:1", "NO_PROXY": "", "no_proxy": ""}):
            result = health.endpoint_summary(base, "deployment", 1, NOW, 7200, 1800)
        self.assertEqual(result["http"], 302)
        self.assertEqual(len(instance.paths), 1)
        self.assertNotIn(SECRET, json.dumps(result))

    def test_html_invalid_json_and_oversized_responses(self):
        for response, expected in ((encoded({}, content_type="text/html"), "InvalidContentType"),
                                   ((b"{broken " + SECRET.encode(), 200, "application/json", 0), "InvalidJson"),
                                   ((b"x" * 65, 200, "application/json", 0), "ResponseTooLarge"),
                                   ((b'{"value": NaN}', 200, "application/json", 0), "InvalidJson")):
            with server({health.ENDPOINTS["deployment"]: response}) as (_, base), \
                    mock.patch.object(health, "MAX_BODY_BYTES", 64):
                result = health.endpoint_summary(base, "deployment", 1, NOW, 7200, 1800)
            self.assertEqual(result["error_code"], expected)
            self.assertNotIn(SECRET, json.dumps(result))

    def test_invalid_config_never_starts_child(self):
        for kwargs in ({"base_url": "http://192.0.2.1"}, {"total_timeout": 0},
                       {"request_timeout": float("nan")}, {"sync_max_age": float("inf")},
                       {"now": NOW.replace(tzinfo=None)}):
            with mock.patch.object(health, "run_endpoint") as child, self.assertRaises(ValueError):
                health.collect(**kwargs)
            child.assert_not_called()

    def test_worker_failure_and_timeout_safe(self):
        for outcome, expected in ((SimpleNamespace(returncode=1, stdout=SECRET), "ProbeWorkerFailed"),
                                  (SimpleNamespace(returncode=0, stdout=SECRET), "ProbeWorkerUnavailable"),
                                  (SimpleNamespace(returncode=0, stdout='{"ok": "true"}'), "InvalidWorkerResponse")):
            with mock.patch.object(subprocess, "run", return_value=outcome):
                result = health.run_endpoint(health.DEFAULT_BASE_URL, "cache", 1, 2, NOW, 7200, 1800)
            self.assertEqual(result["error_code"], expected)
            self.assertNotIn(SECRET, json.dumps(result))
        with mock.patch.object(subprocess, "run", side_effect=subprocess.TimeoutExpired([SECRET], 1)):
            self.assertEqual(health.run_endpoint(health.DEFAULT_BASE_URL, "cache", 1, 2, NOW, 7200, 1800)["error_code"], "DeadlineExceeded")

    def test_cli_error_does_not_disclose_config(self):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            code = health.main(["--base-url", "http://user:" + SECRET + "@127.0.0.1"])
        self.assertEqual(code, 2)
        self.assertNotIn(SECRET, output.getvalue())
        self.assertTrue(json.loads(output.getvalue())["read_only"])

    def test_cli_attention_is_exit_one(self):
        report = {"overall": "ATTENTION", "read_only": True, "cache": {}, "deployment": {}}
        with mock.patch.object(health, "collect", return_value=report), contextlib.redirect_stdout(io.StringIO()) as output:
            self.assertEqual(health.main(["--format", "text"]), 1)
        self.assertIn("Football data: ATTENTION", output.getvalue())


if __name__ == "__main__":
    unittest.main()


class InflightLoadedTimeTests(unittest.TestCase):
    def test_loaded_during_request_is_not_clock_skew(self):
        end=NOW+dt.timedelta(seconds=1)
        summary={'cache_loaded':{'status':'future','at_utc':(NOW+dt.timedelta(milliseconds=500)).isoformat()},'latest_odds':{'status':'future'}}
        result=health.reconcile_inflight_cache_time(summary,NOW,end)
        self.assertEqual(result['cache_loaded']['status'],'fresh')
        self.assertEqual(result['latest_odds']['status'],'future')
    def test_genuine_future_cache_timestamp_remains_invalid(self):
        summary={'cache_loaded':{'status':'future','at_utc':(NOW+dt.timedelta(minutes=1)).isoformat()}}
        result=health.reconcile_inflight_cache_time(summary,NOW,NOW+dt.timedelta(seconds=1))
        self.assertEqual(result['cache_loaded']['status'],'future')
