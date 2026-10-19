#!/usr/bin/env python3
"""Unit tests for home_ssh_release: no root, SSH, systemctl, or real service needed."""
from __future__ import annotations

import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import sys
import tarfile
import tempfile
import unittest
from types import SimpleNamespace
from unittest import mock

MODULE_PATH = Path(__file__).resolve().parents[1] / "home_ssh_release.py"
spec = importlib.util.spec_from_file_location("home_ssh_release", MODULE_PATH)
assert spec and spec.loader
release = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = release
spec.loader.exec_module(release)

SHA = "a" * 40
DIGEST = "b" * 64
RUN_ID = "123-1"


def valid_data(root: Path) -> dict[str, object]:
    return {
        "schema_version": 1,
        "project": "aurelia-football",
        "deploy_root": str(root),
        "service": "aurelia-football.service",
        "service_user": "deployuser",
        "environment_file": "/etc/aurelia-football.env",
        "node_binary": "/usr/bin/node",
        "pnpm_binary": "/usr/bin/pnpm",
        "python_binary": "/usr/bin/python3",
        "health_url": "http://127.0.0.1:3100/api/deployment/health",
        "rollback_health_url": "http://127.0.0.1:3100/api/deployment/health",
        "shared_links": [],
    }


def write_archive(path: Path, metadata: str = SHA, *, traversal: bool = False, symlink: bool = False) -> None:
    members = {
        "dist/index.js": b"console.log('ok')\n",
        "dist/public/index.html": b"<!doctype html>\n",
        "package.json": b"{}\n",
        "pnpm-lock.yaml": b"lockfileVersion: '9.0'\n",
        "requirements.txt": b"requests\n",
        "supabase-sync/requirements.txt": b"requests\n",
        ".aurelia-release.json": json.dumps({"sha": metadata}).encode(),
    }
    with tarfile.open(path, "w") as tar:
        for name, content in members.items():
            info = tarfile.TarInfo(name)
            info.size = len(content)
            tar.addfile(info, io.BytesIO(content))
        if traversal:
            info = tarfile.TarInfo("../outside")
            info.size = 1
            tar.addfile(info, io.BytesIO(b"x"))
        if symlink:
            info = tarfile.TarInfo("linked")
            info.type = tarfile.SYMTYPE
            info.linkname = "/etc/passwd"
            tar.addfile(info)


class HomeSshReleaseTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "app"
        (self.root / "releases").mkdir(parents=True)
        self.old = self.root / "releases" / "old"
        self.old.mkdir()
        (self.root / "current").symlink_to(self.old)
        self.config = release.parse_config(valid_data(self.root))

    def archive(self, **kwargs: object) -> Path:
        archive = Path(self.temp.name) / "release.tar"
        write_archive(archive, **kwargs)
        return archive

    def test_rejects_illegal_configuration_and_service_names(self) -> None:
        for service in ("hkjc.service", "football-hkjc.service", "n6.service", "oncc.service", "v10.service", "ssh.service"):
            data = valid_data(self.root)
            data["service"] = service
            with self.assertRaises(release.DeployError):
                release.parse_config(data)
        data = valid_data(self.root)
        data["deploy_root"] = "relative/root"
        with self.assertRaises(release.DeployError):
            release.parse_config(data)
        data = valid_data(self.root)
        data["health_url"] = "https://football.example/api/deployment/health"
        with self.assertRaises(release.DeployError):
            release.parse_config(data)
        data = valid_data(self.root)
        data["shared_links"] = [{"path": "dist/cache", "target": "/srv/shared"}]
        with self.assertRaises(release.DeployError):
            release.parse_config(data)

    def test_legacy_health_query_is_allowed_only_for_rollback(self) -> None:
        data = valid_data(self.root)
        data["rollback_health_url"] = 'http://127.0.0.1:3100/api/trpc/system.health?input=%7B%22json%22%3A%7B%22timestamp%22%3A1%7D%7D'
        self.assertIn("?input=", release.parse_config(data).rollback_health_url)
        data["health_url"] += "?input=1"
        with self.assertRaises(release.DeployError):
            release.parse_config(data)

    def test_archive_secrets_are_rejected(self) -> None:
        for name in [".env.production", "private.pem", "id_ed25519"]:
            member = tarfile.TarInfo(name)
            member.size = 0
            with self.assertRaisesRegex(release.DeployError, "unsafe archive"):
                release._safe_member_path(member)

    def test_pnpm_is_pinned_not_merely_newer(self) -> None:
        regular = SimpleNamespace(st_mode=stat.S_IFREG | 0o755)
        with mock.patch.object(release.Path, "stat", return_value=regular), \
             mock.patch.object(release.os, "access", return_value=True), \
             mock.patch.object(release, "_required_command", return_value="11.0.0"):
            with self.assertRaisesRegex(release.DeployError, "unsupported pnpm version"):
                release._check_binary(Path("/usr/bin/pnpm"), "pnpm", (10, 4, 1))

    def test_tar_traversal_and_symlink_are_rejected_before_extract(self) -> None:
        with self.assertRaisesRegex(release.DeployError, "unsafe archive"):
            release.inspect_archive(self.archive(traversal=True), SHA)
        with self.assertRaisesRegex(release.DeployError, "unsafe archive"):
            release.inspect_archive(self.archive(symlink=True), SHA)

    def test_root_owned_config_and_environment_permissions_are_fail_closed(self) -> None:
        secure = SimpleNamespace(st_mode=stat.S_IFREG | 0o600, st_uid=0)
        unsafe_owner = SimpleNamespace(st_mode=stat.S_IFREG | 0o600, st_uid=1001)
        unsafe_mode = SimpleNamespace(st_mode=stat.S_IFREG | 0o620, st_uid=0)
        with mock.patch.object(release.os, "stat", return_value=secure):
            release.assert_secure_config_file(Path("/etc/aurelia-football-deploy.json"))
            release.assert_secure_environment_file(Path("/etc/aurelia-football.env"))
        with mock.patch.object(release.os, "stat", return_value=unsafe_owner):
            with self.assertRaisesRegex(release.DeployError, "unsafe configuration"):
                release.assert_secure_config_file(Path("/etc/aurelia-football-deploy.json"))
        with mock.patch.object(release.os, "stat", return_value=unsafe_mode):
            with self.assertRaisesRegex(release.DeployError, "unsafe environment"):
                release.assert_secure_environment_file(Path("/etc/aurelia-football.env"))

    def test_restart_uses_fixed_noninteractive_systemctl_vector(self) -> None:
        with mock.patch.object(release, "_required_command") as command:
            release.restart_service(self.config)
        command.assert_called_once_with(
            ["/usr/bin/sudo", "-n", "/usr/bin/systemctl", "restart", "aurelia-football.service"],
            timeout=60,
        )

    def test_metadata_mismatch_is_rejected(self) -> None:
        archive = self.archive(metadata="c" * 40)
        destination = Path(self.temp.name) / "unpacked"
        destination.mkdir()
        release.inspect_archive(archive, SHA)
        release.extract_archive(archive, destination)
        with self.assertRaisesRegex(release.DeployError, "metadata"):
            release.validate_release_tree(destination, SHA)

    def test_health_rejects_wrong_commit_or_policy(self) -> None:
        payload = {
            "ok": True,
            "service": "aurelia-football",
            "releaseSha": "c" * 40,
            "policy": release.EXPECTED_POLICY,
        }
        self.assertFalse(release.validate_release_health(payload, SHA))
        payload["releaseSha"] = SHA
        payload["policy"] = {**release.EXPECTED_POLICY, "mode": "live"}
        self.assertFalse(release.validate_release_health(payload, SHA))
        payload["policy"] = release.EXPECTED_POLICY
        self.assertTrue(release.validate_release_health(payload, SHA))

    def test_preflight_does_not_change_filesystem(self) -> None:
        before = sorted((p.relative_to(self.root), p.is_symlink(), os.readlink(p) if p.is_symlink() else None)
                        for p in self.root.rglob("*"))
        unit = release.UnitInfo(
            user="deployuser",
            working_directory=str(self.root / "current"),
            exec_start=f"{{ path={self.config.node_binary} ; argv[]={self.config.node_binary} {self.root}/current/dist/index.js ; }}",
            environment_file_bound=True,
            path_has_venv=True,
        )
        with mock.patch.object(release.os, "geteuid", return_value=1001), \
             mock.patch.object(release.pwd, "getpwuid", return_value=SimpleNamespace(pw_name="deployuser")), \
             mock.patch.object(release, "validate_tools") as tools, \
             mock.patch.object(release, "inspect_unit", return_value=unit), \
             mock.patch.object(release, "assert_secure_environment_file") as env, \
             mock.patch.object(release, "is_service_active", return_value=True), \
             mock.patch.object(release, "check_rollback_health", return_value=True), \
             mock.patch.object(release, "_required_command") as sudo_check:
            release.preflight(self.config)
        after = sorted((p.relative_to(self.root), p.is_symlink(), os.readlink(p) if p.is_symlink() else None)
                       for p in self.root.rglob("*"))
        self.assertEqual(before, after)
        tools.assert_called_once_with(self.config)
        env.assert_called_once_with(self.config.environment_file)
        sudo_check.assert_called_once_with([release.SUDO, "-n", "-l", release.SYSTEMCTL, "restart", self.config.service])

    def test_dependency_failure_never_switches_current(self) -> None:
        archive = self.archive()
        digest = hashlib.sha256(archive.read_bytes()).hexdigest()
        old_link = os.readlink(self.root / "current")
        with mock.patch.object(release, "preflight"), \
             mock.patch.object(release, "install_dependencies", side_effect=release.DeployError("required command failed")), \
             mock.patch.object(release, "_atomic_set_current") as switch:
            with self.assertRaises(release.DeployError):
                release.deploy(self.config, archive, SHA, digest, RUN_ID)
        self.assertEqual(os.readlink(self.root / "current"), old_link)
        switch.assert_not_called()

    def test_normal_activation_switches_current_and_writes_nonsecret_receipt(self) -> None:
        archive = self.archive()
        digest = hashlib.sha256(archive.read_bytes()).hexdigest()
        with mock.patch.object(release, "preflight"), \
             mock.patch.object(release, "install_dependencies"), \
             mock.patch.object(release, "restart_service"), \
             mock.patch.object(release, "wait_for_healthy") as healthy:
            receipt = release.deploy(self.config, archive, SHA, digest, RUN_ID)
        new_release = self.root / "releases" / f"{SHA}-{RUN_ID}"
        self.assertEqual((self.root / "current").resolve(), new_release)
        self.assertEqual(receipt, {
            "status": "deployed",
            "releaseSha": SHA,
            "previousTarget": str(self.old),
            "policyVerified": True,
        })
        self.assertEqual(json.loads((self.root / "receipts" / f"{RUN_ID}.json").read_text()), receipt)
        healthy.assert_called_once_with(self.config, SHA)

    def test_rollback_reports_success_only_after_active_and_http_200(self) -> None:
        other = self.root / "releases" / "other"
        other.mkdir()
        with mock.patch.object(release, "restart_service"), \
             mock.patch.object(release, "is_service_active", return_value=True), \
             mock.patch.object(release, "check_rollback_health", return_value=True):
            self.assertTrue(release.rollback(self.config, str(other)))
        self.assertEqual((self.root / "current").resolve(), other)

    def test_rollback_failure_is_not_reported_as_success(self) -> None:
        with mock.patch.object(release, "restart_service"), \
             mock.patch.object(release, "is_service_active", return_value=True), \
             mock.patch.object(release, "check_rollback_health", return_value=False), \
             mock.patch.object(release.time, "monotonic", side_effect=[0, 1, 61]), \
             mock.patch.object(release.time, "sleep"):
            self.assertFalse(release.rollback(self.config, str(self.old)))

    def test_activation_failure_rolls_back_and_reports_rollback_state(self) -> None:
        archive = self.archive()
        digest = hashlib.sha256(archive.read_bytes()).hexdigest()
        with mock.patch.object(release, "preflight"), \
             mock.patch.object(release, "install_dependencies"), \
             mock.patch.object(release, "restart_service"), \
             mock.patch.object(release, "wait_for_healthy", side_effect=release.DeployError("new release health check failed")), \
             mock.patch.object(release, "check_rollback_health", return_value=True), \
             mock.patch.object(release, "is_service_active", return_value=True):
            with self.assertRaisesRegex(release.DeployError, "rollback completed"):
                release.deploy(self.config, archive, SHA, digest, RUN_ID)
        self.assertEqual((self.root / "current").resolve(), self.old)


if __name__ == "__main__":
    unittest.main()
