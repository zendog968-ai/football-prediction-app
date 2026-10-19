#!/usr/bin/env python3
"""Pinned-host SSH transport; no credentials, tokens or remote output are logged."""
from __future__ import annotations

import argparse
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import tempfile


class TransportError(RuntimeError):
    pass


def required(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise TransportError(f"Missing required setting: {name}")
    return value


def validate_connection(host: str, user: str, port: str) -> int:
    try:
        ipaddress.ip_address(host)
    except ValueError:
        if not re.fullmatch(r"[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?", host):
            raise TransportError("Invalid SSH host")
        if any(not label or len(label) > 63 or label.startswith("-") or label.endswith("-") for label in host.split(".")):
            raise TransportError("Invalid SSH hostname")
    if not re.fullmatch(r"[a-z_][a-z0-9_-]{0,31}", user) or user == "root":
        raise TransportError("SSH must use a dedicated non-root user")
    if not port.isdigit() or not 1 <= int(port) <= 65535:
        raise TransportError("Invalid SSH port")
    return int(port)


def execute(command: list[str], label: str, timeout: int = 60) -> str:
    try:
        result = subprocess.run(command, text=True, capture_output=True, timeout=timeout, check=False)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise TransportError(f"{label} unavailable or timed out") from exc
    if result.returncode:
        # Only exact static messages from our remote program are safe to report.
        trusted = {
            "deployment failed; rollback completed", "deployment failed; rollback failed",
            "deployment interrupted; rollback completed", "deployment interrupted; rollback failed",
            "invalid configuration", "unsafe configuration file", "cannot read configuration",
            "invalid service", "invalid service user", "invalid deployment root",
            "deployment user does not match service user", "must run as a non-root deployment user",
            "unit user does not match", "unit working directory does not match", "unit ExecStart does not match",
            "unit environment file is not bound", "unit PATH does not include release venv",
            "unsafe environment file", "rollback health check failed", "service is not active",
            "required command failed", "unsupported pnpm version", "unsupported node version",
            "archive digest does not match", "unsafe archive", "archive is missing required files",
            "release metadata does not match", "another deployment is in progress",
            "release directory already exists", "new release health check failed",
        }
        safe_detail = next((line[7:] for line in result.stderr.splitlines() if line.startswith("error: ") and line[7:] in trusted), "inspect host connectivity, pinned key, account and prerequisites")
        raise TransportError(f"{label} failed (exit {result.returncode}); {safe_detail}")
    return result.stdout.strip()


def remote_command(words: list[str]) -> str:
    return " ".join(shlex.quote(word) for word in words)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", choices=("preflight", "deploy"), required=True)
    parser.add_argument("--sha", required=True)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--archive", type=Path)
    parser.add_argument("--receipt-out", type=Path, required=True)
    args = parser.parse_args()
    if not re.fullmatch(r"[a-f0-9]{40}", args.sha):
        raise TransportError("Invalid release SHA")
    if not re.fullmatch(r"[0-9]+-[0-9]+", args.run_id):
        raise TransportError("Invalid Actions run identity")
    host, user = required("HOME_SSH_HOST"), required("HOME_SSH_USER")
    port = validate_connection(host, user, required("HOME_SSH_PORT"))
    private_key, known_hosts = required("HOME_SSH_PRIVATE_KEY"), required("HOME_SSH_KNOWN_HOSTS")
    archive = args.archive.resolve() if args.archive else None
    if args.mode == "deploy" and (archive is None or not archive.is_file()):
        raise TransportError("Deployment requires a local archive")
    digest = hashlib.sha256(archive.read_bytes()).hexdigest() if archive else None
    remote_script = Path(__file__).with_name("home_ssh_release.py")
    if not remote_script.is_file():
        raise TransportError("Remote deployment program is missing")
    with tempfile.TemporaryDirectory(prefix="aurelia-ssh-") as directory:
        key_path, hosts_path = Path(directory) / "key", Path(directory) / "known_hosts"
        key_path.write_text(private_key + "\n")
        hosts_path.write_text(known_hosts + "\n")
        key_path.chmod(0o600)
        hosts_path.chmod(0o600)
        os.environ.pop("HOME_SSH_PRIVATE_KEY", None)
        os.environ.pop("HOME_SSH_KNOWN_HOSTS", None)
        execute(["ssh-keygen", "-y", "-P", "", "-f", str(key_path)], "SSH private-key validation", 10)
        pinned_target = host if port == 22 else f"[{host}]:{port}"
        found = execute(["ssh-keygen", "-F", pinned_target, "-f", str(hosts_path)], "Pinned SSH host lookup", 10)
        if not found:
            raise TransportError("No pinned key for configured SSH host and port")
        options = [
            "-i", str(key_path), "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes",
            "-o", "StrictHostKeyChecking=yes", "-o", f"UserKnownHostsFile={hosts_path}",
            "-o", "GlobalKnownHostsFile=/dev/null", "-o", "ConnectTimeout=10",
            "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=3",
        ]
        ssh = ["ssh", *options, "-p", str(port), f"{user}@{host}"]
        scp = ["scp", *options, "-P", str(port)]
        incoming = execute([*ssh, "umask 077; mktemp -d /tmp/aurelia-incoming.XXXXXXXX"], "SSH connection", 45)
        if not re.fullmatch(r"/tmp/aurelia-incoming\.[A-Za-z0-9]{8}", incoming):
            raise TransportError("Unexpected remote temporary directory")
        scp_host = f"[{host}]" if ":" in host else host
        destination = f"{user}@{scp_host}:{incoming}"
        try:
            execute([*scp, str(remote_script), f"{destination}/home_ssh_release.py"], "Deployment program transfer", 60)
            command = ["python3", f"{incoming}/home_ssh_release.py", "--config", "/etc/aurelia-football-deploy.json"]
            if args.mode == "preflight":
                command += ["--preflight"]
            else:
                execute([*scp, str(archive), f"{destination}/release.tar.gz"], "Release archive transfer", 300)
                command += ["--archive", f"{incoming}/release.tar.gz", "--sha", args.sha,
                            "--digest", str(digest), "--run-id", args.run_id]
            raw = execute([*ssh, remote_command(command)], "Home deployment/preflight", 1800)
            try:
                receipt = json.loads(raw)
            except (ValueError, TypeError) as exc:
                raise TransportError("Remote receipt is not valid JSON") from exc
            if not isinstance(receipt, dict):
                raise TransportError("Remote receipt must be a JSON object")
            if args.mode == "deploy" and (receipt.get("status") != "deployed" or receipt.get("releaseSha") != args.sha or receipt.get("policyVerified") is not True):
                raise TransportError("Remote deployment receipt did not prove the requested version")
            if args.mode == "preflight" and receipt.get("status") != "preflight-ok":
                raise TransportError("Remote preflight was not confirmed")
            # Allowlist the evidence fields; never save arbitrary remote stdout or paths.
            safe = {"status": receipt["status"], "runId": args.run_id,
                    "releaseSha": args.sha if args.mode == "deploy" else None,
                    "policyVerified": args.mode == "deploy" and receipt.get("policyVerified") is True}
            args.receipt_out.parent.mkdir(parents=True, exist_ok=True)
            args.receipt_out.write_text(json.dumps(safe, indent=2) + "\n")
            print(json.dumps(safe))
        except TransportError as exc:
            args.receipt_out.parent.mkdir(parents=True, exist_ok=True)
            args.receipt_out.write_text(json.dumps({"status": "failed", "runId": args.run_id, "requestedSha": args.sha, "error": str(exc)}, indent=2) + "\n")
            raise
        finally:
            # Remove only the three names created by this invocation, never a recursive remote path.
            cleanup = f"rm -f {shlex.quote(incoming)}/home_ssh_release.py {shlex.quote(incoming)}/release.tar.gz; rmdir {shlex.quote(incoming)}"
            try:
                execute([*ssh, cleanup], "Remote temporary-file cleanup", 30)
            except TransportError:
                print("Warning: remote temporary cleanup could not be confirmed")


if __name__ == "__main__":
    try:
        main()
    except TransportError as exc:
        raise SystemExit(str(exc)) from None
