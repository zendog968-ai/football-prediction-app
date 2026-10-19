#!/usr/bin/env python3
"""Fail-closed release deployment for the Aurelia Football Home service.

This program intentionally does not provision hosts, edit systemd/nginx, touch
schedulers, run database migrations, or inspect environment-file contents.
It is meant to be run by the already-configured non-root service account.
"""
from __future__ import annotations

import argparse
import fcntl
import hashlib
import hmac
import json
import os
from pathlib import Path, PurePosixPath
import pwd
import re
import shlex
import shutil
import signal
import stat
import subprocess
import sys
import tarfile
import tempfile
import time
from dataclasses import dataclass
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener

SYSTEMCTL = "/usr/bin/systemctl"
SUDO = "/usr/bin/sudo"
MAX_ARCHIVE_BYTES = 200 * 1024 * 1024
COMMAND_TIMEOUT = 30
INSTALL_TIMEOUT = 500
HEALTH_TIMEOUT = 60
REQUIRED_FILES = (
    "dist/index.js",
    "dist/public/index.html",
    "package.json",
    "pnpm-lock.yaml",
    "requirements.txt",
    "supabase-sync/requirements.txt",
    ".aurelia-release.json",
)
EXPECTED_POLICY = {
    "minTeamMatches": 5,
    "minLeagueMatches": 20,
    "mode": "research-only",
    "highConfidenceEnabled": False,
    "bettingAdviceEnabled": False,
    "expectedValueEnabled": False,
    "modelVersion": "poisson-v4-shrink10-research",
}
SERVICE_RE = re.compile(r"(?:aurelia-football|football)(?:-[A-Za-z0-9][A-Za-z0-9_.-]*)?\.service\Z")
USER_RE = re.compile(r"[a-z_][a-z0-9_-]{0,31}\Z")
SHA_RE = re.compile(r"[0-9a-f]{40}\Z")
DIGEST_RE = re.compile(r"[0-9a-f]{64}\Z")
RUN_ID_RE = re.compile(r"[0-9]+-[0-9]+\Z")


@dataclass
class ActivationState:
    """Only in-memory state needed to undo an interrupted pointer switch."""

    config: "Config"
    previous_link: str
    switched: bool = False


_activation: ActivationState | None = None


class DeployError(Exception):
    """An intentionally non-sensitive, operator-facing deployment failure."""


@dataclass(frozen=True)
class Config:
    deploy_root: Path
    service: str
    service_user: str
    environment_file: Path
    node_binary: Path
    pnpm_binary: Path
    python_binary: Path
    health_url: str
    rollback_health_url: str
    shared_links: tuple[tuple[PurePosixPath, Path], ...]


@dataclass(frozen=True)
class UnitInfo:
    user: str
    working_directory: str
    exec_start: str
    environment_file_bound: bool
    path_has_venv: bool


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req: Request, fp: Any, code: int, msg: str, headers: Any, newurl: str) -> None:
        return None


def _fail(message: str) -> None:
    raise DeployError(message)


def _is_absolute_string(value: Any) -> bool:
    return isinstance(value, str) and bool(value) and os.path.isabs(value)


def _validate_loopback_url(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value:
        _fail(f"invalid {label}")
    try:
        parsed = urlsplit(value)
        hostname = parsed.hostname
        port = parsed.port
    except ValueError:
        _fail(f"invalid {label}")
    if parsed.scheme not in {"http", "https"} or hostname not in {"127.0.0.1", "::1"}:
        _fail(f"invalid {label}")
    if parsed.username is not None or parsed.password is not None or port is None:
        _fail(f"invalid {label}")
    if parsed.fragment or (parsed.query and label == "health_url"):
        _fail(f"invalid {label}")
    return value


def _validate_shared_links(value: Any) -> tuple[tuple[PurePosixPath, Path], ...]:
    if value is None:
        return ()
    if not isinstance(value, list):
        _fail("invalid shared_links")
    result: list[tuple[PurePosixPath, Path]] = []
    seen: set[str] = set()
    protected = {"dist", "package", "package.json", "node_modules", "pnpm-lock.yaml", "requirements.txt", ".venv", ".env"}
    for entry in value:
        if not isinstance(entry, dict) or set(entry) != {"path", "target"}:
            _fail("invalid shared_links")
        raw_path, raw_target = entry["path"], entry["target"]
        if not isinstance(raw_path, str) or not raw_path or not isinstance(raw_target, str):
            _fail("invalid shared_links")
        path = PurePosixPath(raw_path)
        if path.is_absolute() or not path.parts or any(part in {"", ".", ".."} for part in path.parts):
            _fail("invalid shared_links")
        first = path.parts[0]
        if first in protected or first.startswith((".aurelia", ".env")):
            _fail("invalid shared_links")
        if not _is_absolute_string(raw_target):
            _fail("invalid shared_links")
        normalized = str(path)
        if normalized in seen:
            _fail("invalid shared_links")
        seen.add(normalized)
        result.append((path, Path(raw_target)))
    return tuple(result)


def parse_config(data: Any) -> Config:
    """Validate only the documented configuration schema; no filesystem changes."""
    if not isinstance(data, dict):
        _fail("invalid configuration")
    required = {
        "schema_version", "project", "deploy_root", "service", "service_user",
        "environment_file", "node_binary", "pnpm_binary", "python_binary",
        "health_url", "rollback_health_url",
    }
    allowed = required | {"shared_links"}
    if set(data) - allowed or not required.issubset(data):
        _fail("invalid configuration")
    if data["schema_version"] != 1 or data["project"] != "aurelia-football":
        _fail("invalid configuration")
    if not _is_absolute_string(data["deploy_root"]):
        _fail("invalid configuration")
    service = data["service"]
    if not isinstance(service, str) or not SERVICE_RE.fullmatch(service):
        _fail("invalid service")
    lowered = service.lower()
    if any(forbidden in lowered for forbidden in ("hkjc", "n6", "oncc", "v10")):
        _fail("invalid service")
    service_user = data["service_user"]
    if not isinstance(service_user, str) or service_user == "root" or not USER_RE.fullmatch(service_user):
        _fail("invalid service user")
    for field in ("environment_file", "node_binary", "pnpm_binary", "python_binary"):
        if not _is_absolute_string(data[field]):
            _fail("invalid configuration")
    health_url = _validate_loopback_url(data["health_url"], "health_url")
    health_parsed = urlsplit(health_url)
    if health_parsed.path != "/api/deployment/health":
        _fail("invalid health_url")
    rollback_health_url = _validate_loopback_url(data["rollback_health_url"], "rollback_health_url")
    return Config(
        deploy_root=Path(data["deploy_root"]),
        service=service,
        service_user=service_user,
        environment_file=Path(data["environment_file"]),
        node_binary=Path(data["node_binary"]),
        pnpm_binary=Path(data["pnpm_binary"]),
        python_binary=Path(data["python_binary"]),
        health_url=health_url,
        rollback_health_url=rollback_health_url,
        shared_links=_validate_shared_links(data.get("shared_links", [])),
    )


def assert_secure_config_file(path: Path) -> None:
    try:
        file_stat = os.stat(path, follow_symlinks=False)
    except OSError:
        _fail("cannot read configuration")
    if not stat.S_ISREG(file_stat.st_mode) or file_stat.st_uid != 0 or (file_stat.st_mode & 0o022):
        _fail("unsafe configuration file")


def load_config(path_text: str) -> Config:
    path = Path(path_text)
    if not path.is_absolute():
        _fail("invalid configuration path")
    assert_secure_config_file(path)
    try:
        # Recheck after opening so a replacement cannot bypass the owner/mode test.
        flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
        fd = os.open(path, flags)
        with os.fdopen(fd, "r", encoding="utf-8") as handle:
            file_stat = os.fstat(handle.fileno())
            if not stat.S_ISREG(file_stat.st_mode) or file_stat.st_uid != 0 or (file_stat.st_mode & 0o022):
                _fail("unsafe configuration file")
            data = json.load(handle)
    except DeployError:
        raise
    except (OSError, ValueError, json.JSONDecodeError):
        _fail("cannot read configuration")
    return parse_config(data)


def _run(args: list[str], *, timeout: int = COMMAND_TIMEOUT, cwd: Path | None = None) -> subprocess.CompletedProcess[str]:
    """Run a fixed argument vector, retaining output only transiently for validation."""
    try:
        return subprocess.run(
            args,
            cwd=str(cwd) if cwd is not None else None,
            shell=False,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=timeout,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        _fail("required command failed")


def _required_command(args: list[str], *, timeout: int = COMMAND_TIMEOUT, cwd: Path | None = None) -> str:
    completed = _run(args, timeout=timeout, cwd=cwd)
    if completed.returncode != 0:
        _fail("required command failed")
    return completed.stdout


def _check_binary(path: Path, name: str, minimum: tuple[int, int, int]) -> None:
    try:
        file_stat = path.stat()
    except OSError:
        _fail(f"invalid {name} binary")
    if not stat.S_ISREG(file_stat.st_mode) or not os.access(path, os.X_OK):
        _fail(f"invalid {name} binary")
    output = _required_command([str(path), "--version"], timeout=10).strip()
    match = re.search(r"(?:v|Python )?(\d+)\.(\d+)(?:\.(\d+))?", output)
    if not match:
        _fail(f"invalid {name} version")
    version = tuple(int(part or 0) for part in match.groups())
    if version < minimum:
        _fail(f"unsupported {name} version")
    if name == "pnpm" and version != (10, 4, 1):
        _fail("unsupported pnpm version")


def validate_tools(config: Config) -> None:
    _check_binary(config.node_binary, "node", (22, 12, 0))
    _check_binary(config.pnpm_binary, "pnpm", (10, 4, 1))
    _check_binary(config.python_binary, "python", (3, 11, 0))


def _systemctl_show(service: str) -> str:
    return _required_command([
        SYSTEMCTL, "show", service,
        "--property=User", "--property=WorkingDirectory", "--property=ExecStart",
        "--property=EnvironmentFiles", "--property=Environment",
    ])


def inspect_unit(config: Config) -> UnitInfo:
    """Read only required unit properties; environment values are never returned or logged."""
    output = _systemctl_show(config.service)
    fields: dict[str, str] = {}
    for line in output.splitlines():
        if "=" in line:
            key, value = line.split("=", 1)
            if key in {"User", "WorkingDirectory", "ExecStart", "EnvironmentFiles", "Environment"}:
                fields[key] = value
    user = fields.get("User", "")
    working_directory = fields.get("WorkingDirectory", "")
    exec_start = fields.get("ExecStart", "")
    env_files = fields.get("EnvironmentFiles", "")
    # systemd normally quotes environment tokens.  Parse only PATH and discard all
    # other tokens immediately; this function never returns the Environment value.
    path_value = ""
    try:
        for token in shlex.split(fields.get("Environment", "")):
            if token.startswith("PATH="):
                path_value = token[5:]
                break
    except ValueError:
        _fail("invalid unit environment")
    expected_venv = str(config.deploy_root / "current" / ".venv" / "bin")
    env_file_bound = bool(re.search(r"(?<!\S)" + re.escape(str(config.environment_file)) + r"(?=\s|\(|$)", env_files))
    return UnitInfo(
        user=user,
        working_directory=working_directory,
        exec_start=exec_start,
        environment_file_bound=env_file_bound,
        path_has_venv=expected_venv in path_value.split(":"),
    )


def assert_secure_environment_file(path: Path) -> None:
    try:
        file_stat = os.stat(path, follow_symlinks=False)
    except OSError:
        _fail("unsafe environment file")
    # Explicitly require 0600, not merely "not world-readable".
    if not stat.S_ISREG(file_stat.st_mode) or file_stat.st_uid != 0 or stat.S_IMODE(file_stat.st_mode) != 0o600:
        _fail("unsafe environment file")


def _current_target(config: Config) -> tuple[str, Path]:
    current = config.deploy_root / "current"
    if not current.is_symlink():
        _fail("current release is not a symlink")
    try:
        raw_target = os.readlink(current)
        target = (current.parent / raw_target).resolve() if not os.path.isabs(raw_target) else Path(raw_target).resolve()
        releases = (config.deploy_root / "releases").resolve()
    except OSError:
        _fail("invalid current release")
    if not target.is_dir() or target.parent != releases:
        _fail("invalid current release")
    return raw_target, target


def is_service_active(service: str, timeout: int = 15) -> bool:
    completed = _run([SYSTEMCTL, "is-active", "--quiet", service], timeout=timeout)
    return completed.returncode == 0


def _http_get(url: str, *, want_json: bool, timeout: float = 5) -> tuple[int, dict[str, Any] | None]:
    opener = build_opener(ProxyHandler({}), _NoRedirect())
    request = Request(url, method="GET", headers={"Accept": "application/json"})
    try:
        with opener.open(request, timeout=timeout) as response:
            status = response.getcode()
            if not want_json:
                return status, None
            body = response.read(128 * 1024)
            try:
                payload = json.loads(body.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError):
                _fail("health check failed")
            return status, payload if isinstance(payload, dict) else None
    except HTTPError as error:
        # A redirect is intentionally an error.  Never include its location/body.
        return error.code, None
    except (URLError, OSError, ValueError):
        return 0, None


def check_rollback_health(config: Config) -> bool:
    status, _ = _http_get(config.rollback_health_url, want_json=False)
    return status == 200


def unit_exec_is_exact_node_start(exec_start: str, node_binary: Path, entrypoint: Path) -> bool:
    """Require one systemd command whose actual executable/argv use configured Node."""
    executable_paths = re.findall(r"(?:^|[\s;{])path=([^\s;}]+)", exec_start)
    if executable_paths != [str(node_binary)]:
        return False
    # systemctl show encodes argv as `argv[]=/path/to/node argument ... ;`.
    argv_pattern = r"argv\[\]=" + re.escape(str(node_binary)) + r"(?=\s|;|})"
    return bool(re.search(argv_pattern, exec_start)) and str(entrypoint) in exec_start


def validate_release_health(payload: dict[str, Any] | None, release_sha: str) -> bool:
    if not isinstance(payload, dict):
        return False
    return (
        payload.get("ok") is True
        and payload.get("service") == "aurelia-football"
        and payload.get("releaseSha") == release_sha
        and payload.get("policy") == EXPECTED_POLICY
    )


def wait_for_healthy(config: Config, release_sha: str) -> None:
    deadline = time.monotonic() + HEALTH_TIMEOUT
    while True:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            _fail("new release health check failed")
        # Never begin a systemd/HTTP attempt whose individual timeout can extend
        # the bounded readiness window.  Redirects remain errors via _NoRedirect.
        operation_timeout = max(1, min(5, int(remaining)))
        if is_service_active(config.service, timeout=operation_timeout):
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                _fail("new release health check failed")
            status, payload = _http_get(config.health_url, want_json=True, timeout=max(1, min(5, remaining)))
            if status == 200 and validate_release_health(payload, release_sha):
                return
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            _fail("new release health check failed")
        time.sleep(min(1, remaining))


def preflight(config: Config) -> None:
    """Perform only reads/GETs/subprocess inspection: it never changes host state."""
    if os.geteuid() == 0:
        _fail("must run as a non-root deployment user")
    try:
        current_user = pwd.getpwuid(os.geteuid()).pw_name
    except KeyError:
        _fail("cannot determine deployment user")
    if current_user != config.service_user or current_user == "root":
        _fail("deployment user does not match service user")
    if not config.deploy_root.is_dir() or not (config.deploy_root / "releases").is_dir():
        _fail("invalid deployment root")
    validate_tools(config)
    unit = inspect_unit(config)
    expected_working_directory = str(config.deploy_root / "current")
    expected_entry = str(config.deploy_root / "current" / "dist" / "index.js")
    if unit.user != config.service_user or unit.user == "root":
        _fail("unit user does not match")
    if unit.working_directory != expected_working_directory:
        _fail("unit working directory does not match")
    if not unit_exec_is_exact_node_start(unit.exec_start, config.node_binary, Path(expected_entry)):
        _fail("unit ExecStart does not match")
    if not unit.environment_file_bound:
        _fail("unit environment file is not bound")
    if not unit.path_has_venv:
        _fail("unit PATH does not include release venv")
    assert_secure_environment_file(config.environment_file)
    for _, target in config.shared_links:
        if not target.exists():
            _fail("shared link target is missing")
    _current_target(config)
    if not is_service_active(config.service):
        _fail("service is not active")
    if not check_rollback_health(config):
        _fail("rollback health check failed")
    _required_command([SUDO, "-n", "-l", SYSTEMCTL, "restart", config.service])


def _validate_release_inputs(archive: Path, release_sha: str, digest: str, run_id: str) -> None:
    if not SHA_RE.fullmatch(release_sha) or not DIGEST_RE.fullmatch(digest) or not RUN_ID_RE.fullmatch(run_id):
        _fail("invalid release arguments")
    try:
        archive_stat = archive.stat()
    except OSError:
        _fail("cannot read archive")
    if not stat.S_ISREG(archive_stat.st_mode):
        _fail("cannot read archive")


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    try:
        with path.open("rb") as handle:
            for block in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(block)
    except OSError:
        _fail("cannot read archive")
    return digest.hexdigest()


def _safe_member_path(member: tarfile.TarInfo) -> PurePosixPath:
    name = member.name
    path = PurePosixPath(name)
    lowered_parts = {part.lower() for part in path.parts}
    forbidden_parts = {".git", ".hg", ".svn", "node_modules", "deps", ".pnpm-store", ".venv", "venv", "__pycache__"}
    final_name = path.name.lower()
    if (
        not name or name.startswith("/") or path.is_absolute() or not path.parts
        or any(part in {"", ".", ".."} for part in path.parts)
        or lowered_parts & forbidden_parts
        or final_name in {"secret.env", "id_rsa", "id_ed25519"}
        or final_name.startswith(".env") or final_name.endswith((".env", ".pem", ".key"))
    ):
        _fail("unsafe archive")
    if not member.isreg():
        _fail("unsafe archive")
    return path


def inspect_archive(archive: Path, release_sha: str) -> tuple[PurePosixPath, ...]:
    """Validate every member before extracting anything."""
    total = 0
    paths: list[PurePosixPath] = []
    seen: set[str] = set()
    try:
        with tarfile.open(archive, "r:*") as tar:
            for member in tar:
                path = _safe_member_path(member)
                if member.size < 0:
                    _fail("unsafe archive")
                total += member.size
                if total > MAX_ARCHIVE_BYTES:
                    _fail("archive exceeds size limit")
                text = str(path)
                if text in seen:
                    _fail("unsafe archive")
                seen.add(text)
                paths.append(path)
    except DeployError:
        raise
    except (tarfile.TarError, OSError):
        _fail("cannot read archive")
    required = {PurePosixPath(item) for item in REQUIRED_FILES}
    if not required.issubset(set(paths)):
        _fail("archive is missing required files")
    return tuple(paths)


def _write_member(tar: tarfile.TarFile, member: tarfile.TarInfo, destination: Path) -> None:
    source = tar.extractfile(member)
    if source is None:
        _fail("unsafe archive")
    destination.parent.mkdir(parents=True, exist_ok=True)
    # Parent paths were made solely by us from regular-member paths; no archive link
    # can turn this into a write outside staging.
    try:
        fd = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644)
        with os.fdopen(fd, "wb") as target:
            shutil.copyfileobj(source, target, length=1024 * 1024)
            target.flush()
            os.fsync(target.fileno())
    except OSError:
        _fail("archive extraction failed")
    finally:
        source.close()


def extract_archive(archive: Path, destination: Path) -> None:
    try:
        with tarfile.open(archive, "r:*") as tar:
            for member in tar:
                path = _safe_member_path(member)
                _write_member(tar, member, destination / Path(*path.parts))
    except DeployError:
        raise
    except (tarfile.TarError, OSError):
        _fail("archive extraction failed")


def validate_release_tree(release_dir: Path, release_sha: str) -> None:
    for relative in REQUIRED_FILES:
        candidate = release_dir / relative
        if not candidate.is_file() or candidate.is_symlink():
            _fail("archive is missing required files")
    try:
        metadata = json.loads((release_dir / ".aurelia-release.json").read_text(encoding="utf-8"))
        recorded_sha = metadata.get("sha") if isinstance(metadata, dict) else None
    except (OSError, ValueError, json.JSONDecodeError):
        _fail("invalid release metadata")
    if recorded_sha != release_sha:
        _fail("release metadata does not match")


def create_shared_links(config: Config, release_dir: Path) -> None:
    for relative, target in config.shared_links:
        if not target.exists():
            _fail("shared link target is missing")
        link = release_dir / Path(*relative.parts)
        if link.exists() or link.is_symlink():
            _fail("shared link would overwrite release content")
        try:
            link.parent.mkdir(parents=True, exist_ok=True)
            os.symlink(str(target), link)
        except OSError:
            _fail("cannot create shared link")


def install_dependencies(config: Config, release_dir: Path) -> None:
    # Full frozen install is deliberate: production code imports build/runtime tools.
    _required_command([str(config.pnpm_binary), "install", "--frozen-lockfile"], timeout=INSTALL_TIMEOUT, cwd=release_dir)
    venv_dir = release_dir / ".venv"
    _required_command([str(config.python_binary), "-m", "venv", str(venv_dir)], timeout=INSTALL_TIMEOUT, cwd=release_dir)
    venv_python = venv_dir / "bin" / "python"
    _required_command([
        str(venv_python), "-m", "pip", "install", "--requirement", "requirements.txt",
        "--requirement", "supabase-sync/requirements.txt",
    ], timeout=INSTALL_TIMEOUT, cwd=release_dir)


def _atomic_set_current(config: Config, target: str) -> None:
    current = config.deploy_root / "current"
    try:
        fd, temp_name = tempfile.mkstemp(prefix=".current-", dir=config.deploy_root)
        os.close(fd)
        os.unlink(temp_name)
        os.symlink(target, temp_name)
        os.replace(temp_name, current)
    except OSError:
        try:
            if "temp_name" in locals() and os.path.lexists(temp_name):
                os.unlink(temp_name)
        except OSError:
            pass
        _fail("cannot switch current release")


def restart_service(config: Config) -> None:
    _required_command([SUDO, "-n", SYSTEMCTL, "restart", config.service], timeout=60)


def rollback(config: Config, previous_link: str) -> bool:
    try:
        _atomic_set_current(config, previous_link)
        restart_service(config)
        deadline = time.monotonic() + HEALTH_TIMEOUT
        while time.monotonic() < deadline:
            if is_service_active(config.service) and check_rollback_health(config):
                return True
            time.sleep(1)
        return False
    except DeployError:
        return False


def write_receipt(config: Config, run_id: str, receipt: dict[str, Any]) -> None:
    receipts = config.deploy_root / "receipts"
    try:
        receipts.mkdir(mode=0o700, exist_ok=True)
        destination = receipts / f"{run_id}.json"
        fd, temporary = tempfile.mkstemp(prefix=".receipt-", dir=receipts)
        try:
            os.fchmod(fd, 0o600)
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                json.dump(receipt, handle, sort_keys=True, separators=(",", ":"))
                handle.write("\n")
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, destination)
        except Exception:
            try:
                os.close(fd)
            except OSError:
                pass
            if os.path.exists(temporary):
                os.unlink(temporary)
            raise
    except OSError:
        _fail("cannot save deployment receipt")


def deployment_lock(config: Config):
    """A small context manager for an exclusive, non-blocking per-root lock."""
    class _Lock:
        def __enter__(self) -> None:
            try:
                self.fd = os.open(config.deploy_root / ".aurelia-deploy.lock", os.O_RDWR | os.O_CREAT, 0o600)
                fcntl.flock(self.fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except OSError:
                _fail("another deployment is in progress")

        def __exit__(self, exc_type: Any, exc: Any, traceback: Any) -> None:
            try:
                fcntl.flock(self.fd, fcntl.LOCK_UN)
                os.close(self.fd)
            except OSError:
                pass
    return _Lock()


def deploy(config: Config, archive: Path, release_sha: str, digest: str, run_id: str) -> dict[str, Any]:
    _validate_release_inputs(archive, release_sha, digest, run_id)
    with deployment_lock(config):
        if not hmac.compare_digest(_sha256(archive), digest):
            _fail("archive digest does not match")
        inspect_archive(archive, release_sha)
        # Baseline health/pointer checks happen under the same lock as activation.
        preflight(config)
        releases = config.deploy_root / "releases"
        release_dir = releases / f"{release_sha}-{run_id}"
        if release_dir.exists() or release_dir.is_symlink():
            _fail("release directory already exists")
        try:
            release_dir.mkdir(mode=0o700)
        except OSError:
            _fail("cannot create release directory")
        try:
            extract_archive(archive, release_dir)
            validate_release_tree(release_dir, release_sha)
            create_shared_links(config, release_dir)
            # Dependency failure occurs strictly before current is changed.
            install_dependencies(config, release_dir)
            previous_link, previous_target = _current_target(config)
            global _activation
            _activation = ActivationState(config=config, previous_link=previous_link)
            # Mark before os.replace: a signal in the tiny replacement window can
            # safely restore the old target even if replacement did not complete.
            _activation.switched = True
            try:
                _atomic_set_current(config, str(release_dir))
                restart_service(config)
                wait_for_healthy(config, release_sha)
                receipt = {
                    "status": "deployed",
                    "releaseSha": release_sha,
                    "previousTarget": str(previous_target),
                    "policyVerified": True,
                }
                write_receipt(config, run_id, receipt)
            except (DeployError, OSError):
                if rollback(config, previous_link):
                    _activation = None
                    _fail("deployment failed; rollback completed")
                _activation = None
                _fail("deployment failed; rollback failed")
            _activation = None
            return receipt
        except DeployError:
            raise
        except OSError:
            _fail("deployment failed")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Deploy an already-built Aurelia Football release")
    parser.add_argument("--config", required=True, help="root-owned deployment JSON")
    parser.add_argument("--preflight", action="store_true", help="perform validation only")
    parser.add_argument("--archive", help="release tar archive")
    parser.add_argument("--sha", help="40-hex source release SHA")
    parser.add_argument("--digest", help="64-hex SHA-256 of archive")
    parser.add_argument("--run-id", help="CI run identifier: digits-digits")
    return parser


def _handle_termination(signum: int, frame: Any) -> None:
    """On TERM/HUP after activation, make one best-effort verified rollback.

    Python runs handlers between bytecodes.  This deliberately has no stdout and
    makes no success claim: rollback() itself confirms both systemd active and
    rollback HTTP 200 before returning true.
    """
    global _activation
    state = _activation
    if state is not None and state.switched:
        restored = rollback(state.config, state.previous_link)
        _activation = None
        message = "deployment interrupted; rollback completed" if restored else "deployment interrupted; rollback failed"
    else:
        message = "deployment interrupted"
    print(f"error: {message}", file=sys.stderr)
    raise SystemExit(128 + signum)


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        if args.config != "/etc/aurelia-football-deploy.json":
            _fail("invalid configuration path")
        config = load_config(args.config)
        deploy_args = (args.archive, args.sha, args.digest, args.run_id)
        if args.preflight:
            if any(value is not None for value in deploy_args):
                _fail("preflight does not accept release arguments")
            preflight(config)
            print(json.dumps({"status": "preflight-ok"}, separators=(",", ":")))
            return 0
        if any(value is None for value in deploy_args):
            _fail("deploy requires archive, sha, digest, and run-id")
        receipt = deploy(config, Path(args.archive), args.sha, args.digest, args.run_id)
        # The only success stdout for an actual deployment is this receipt JSON.
        print(json.dumps(receipt, separators=(",", ":")))
        return 0
    except DeployError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    signal.signal(signal.SIGHUP, _handle_termination)
    signal.signal(signal.SIGTERM, _handle_termination)
    signal.signal(signal.SIGINT, _handle_termination)
    raise SystemExit(main())
