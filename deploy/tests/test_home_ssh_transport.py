from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]


def load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


transport = load("run_home_ssh")
notify = load("notify_home_deploy")
packager = load("package_home_release")
SHA = "a" * 40
RUN_URL = "https://github.com/zendog968-ai/football-prediction-app/actions/runs/123"


class TransportTests(unittest.TestCase):
    def test_only_valid_non_root_target(self):
        self.assertEqual(transport.validate_connection("example.test", "football", "2222"), 2222)
        self.assertEqual(transport.validate_connection("::1", "football", "22"), 22)
        for host, user, port in [("-oProxyCommand=x", "football", "22"), ("example.test", "root", "22"),
                                 ("example.test", "a;id", "22"), ("example.test", "football", "0"),
                                 ("example..test", "football", "22"), ("user@host", "football", "22")]:
            with self.assertRaises(transport.TransportError):
                transport.validate_connection(host, user, port)

    def test_remote_argument_quoting(self):
        import shlex
        values = ["python3", "/tmp/aurelia-incoming.ABC12345/x.py", "a; touch /tmp/wrong"]
        self.assertEqual(shlex.split(transport.remote_command(values)), values)

    def test_subprocess_error_does_not_echo_credentials(self):
        import subprocess
        response = subprocess.CompletedProcess([], 255, stdout="PRIVATE KEY", stderr="bot123:SECRET")
        with patch.object(transport.subprocess, "run", return_value=response):
            with self.assertRaises(transport.TransportError) as result:
                transport.execute(["ssh"], "SSH test")
        self.assertNotIn("SECRET", str(result.exception))
        self.assertNotIn("PRIVATE", str(result.exception))

    def test_pinned_host_and_allowlisted_receipt(self):
        calls = []
        def fake(command, label, timeout=60):
            calls.append(command)
            if command[0] == "ssh-keygen":
                return "matching host key" if "-F" in command else "public key"
            if label == "SSH connection":
                return "/tmp/aurelia-incoming.ABC12345"
            if label == "Home deployment/preflight":
                return json.dumps({"status": "preflight-ok", "secret": "DO NOT SAVE"})
            return ""
        env = {"HOME_SSH_HOST": "example.test", "HOME_SSH_PORT": "22", "HOME_SSH_USER": "football",
               "HOME_SSH_PRIVATE_KEY": "fake-private", "HOME_SSH_KNOWN_HOSTS": "fake-host-key"}
        with tempfile.TemporaryDirectory() as folder:
            out = Path(folder) / "receipt.json"
            with patch.dict(transport.os.environ, env, clear=True), patch.object(transport, "execute", side_effect=fake), patch.object(sys, "argv", ["tool", "--mode", "preflight", "--sha", SHA, "--run-id", "123-1", "--receipt-out", str(out)]):
                transport.main()
            receipt = json.loads(out.read_text())
            self.assertNotIn("secret", receipt)
            self.assertEqual(receipt["status"], "preflight-ok")
            for command in calls:
                if command[0] in {"ssh", "scp"}:
                    self.assertIn("StrictHostKeyChecking=yes", command)
                    self.assertIn("IdentitiesOnly=yes", command)
                    self.assertNotIn("StrictHostKeyChecking=no", command)


class NotificationTests(unittest.TestCase):
    def test_success_requires_real_deployment_evidence(self):
        for receipt in [None, {}, {"status": "deployed", "releaseSha": "b" * 40, "policyVerified": True}]:
            with self.assertRaises(notify.NotificationError):
                notify.make_message("success", SHA, RUN_URL, receipt)
        message = notify.make_message("success", SHA, RUN_URL, {"status": "deployed", "releaseSha": SHA, "policyVerified": True})
        self.assertIn("不是賽事預測", message)
        self.assertNotIn("校準成功", message)

    def test_failure_does_not_claim_rollback_succeeded(self):
        message = notify.make_message("failure", SHA, RUN_URL, None)
        self.assertIn("請查看", message)
        self.assertNotIn("已回滾", message)

    def test_telegram_checks_ok_and_message_id(self):
        from io import BytesIO
        class Response(BytesIO):
            def __enter__(self): return self
            def __exit__(self, *args): self.close()
        with patch.object(notify.request, "urlopen", return_value=Response(b'{"ok":true,"result":{"message_id":44}}')):
            self.assertEqual(notify.send("fake", "123", "test")["messageId"], 44)
        with patch.object(notify.request, "urlopen", return_value=Response(b'{"ok":false}')):
            with self.assertRaises(notify.NotificationError): notify.send("fake", "123", "test")
        with patch.object(notify.request, "urlopen", side_effect=RuntimeError("token:SECRET")):
            with self.assertRaises(notify.NotificationError) as result: notify.send("fake", "123", "test")
            self.assertNotIn("SECRET", str(result.exception))

    def test_missing_settings_fail_instead_of_skip(self):
        for token, chat in [("", "123"), ("fake", "some username")]:
            with self.assertRaises(notify.NotificationError): notify.send(token, chat, "test")


class PackagingTests(unittest.TestCase):
    def test_excludes_secrets_and_live_data(self):
        for name in [".env", ".env.production", "data/history.db", "model/main.pkl", "node_modules/mod.js", ".venv/bin/python", "secret.pem"]:
            self.assertFalse(packager.eligible(Path(name)))
        self.assertTrue(packager.eligible(Path("scripts/predict_upcoming.py")))
        self.assertTrue(packager.eligible(Path("dist/index.js")))

    def test_fixed_sha_archive_includes_dist_and_metadata(self):
        import tarfile
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            for name in ["dist/index.js", "dist/public/index.html", "package.json", "pnpm-lock.yaml", "requirements.txt", "scripts/predict_upcoming.py", ".env", "data.db"]:
                p = root / name
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_text("{}" if name == "package.json" else "fixture")
            def fake(command, **kwargs):
                return SHA + "\n" if "rev-parse" in command else b"package.json\0pnpm-lock.yaml\0requirements.txt\0scripts/predict_upcoming.py\0.env\0data.db\0"
            out = root / "release.tar.gz"
            with patch.object(packager.subprocess, "check_output", side_effect=fake):
                packager.package(root, SHA, out)
            with tarfile.open(out) as archive:
                self.assertIn("dist/index.js", archive.getnames())
                self.assertNotIn(".env", archive.getnames())
                self.assertNotIn("data.db", archive.getnames())
                metadata = json.load(archive.extractfile(".aurelia-release.json"))
                self.assertEqual(metadata["sha"], SHA)
                self.assertRegex(metadata["builtAt"], r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$")


if __name__ == "__main__":
    unittest.main()
