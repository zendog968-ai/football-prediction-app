#!/usr/bin/env python3
"""Root-only Home deployment; no credentials are printed or embedded in URLs."""
import os
from pathlib import Path
import re
import secrets
import tempfile

if os.geteuid() != 0:
    raise SystemExit("Run with sudo")
url = "https://136-108-33-74.nip.io/football/api/integrations/telegram/webhook"
env_path = Path("/etc/aurelia-football.env")
text = env_path.read_text()
secret_match = re.search(r"^TELEGRAM_WEBHOOK_SECRET=([^\n]*)$", text, re.M)
secret = secret_match.group(1).strip().strip("\"'") if secret_match else ""
if not re.fullmatch(r"[A-Za-z0-9_-]{32,256}", secret):
    secret = secrets.token_urlsafe(48)
for key, value in {"TELEGRAM_WEBHOOK_SECRET": secret, "TELEGRAM_WEBHOOK_URL": url, "TELEGRAM_RUNTIME_LABEL": "Home"}.items():
    if re.search(rf"^{key}=", text, re.M):
        text = re.sub(rf"^{key}=[^\n]*", f"{key}={value}", text, flags=re.M)
    else:
        text = text.rstrip() + f"\n{key}={value}\n"
fd, temp = tempfile.mkstemp(prefix=".aurelia-webhook-", dir=env_path.parent)
try:
    os.fchmod(fd, 0o600)
    with os.fdopen(fd, "w") as handle:
        handle.write(text)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temp, env_path)
finally:
    if os.path.exists(temp): os.unlink(temp)
zone = Path("/etc/nginx/conf.d/aurelia-telegram-rate-limit.conf")
zone_text = "# Telegram-only rate guard; no secrets are stored here.\nlimit_req_zone $binary_remote_addr zone=aurelia_telegram_webhook:1m rate=5r/s;\n"
if zone.exists() and zone.read_text() != zone_text:
    raise SystemExit("Existing rate-zone file differs; manual review required")
zone.write_text(zone_text)
zone.chmod(0o644)
site = Path("/etc/nginx/sites-available/hkjc-api")
config = site.read_text()
marker = "    # Aurelia Telegram exact POST endpoint (owner-approved secret-token auth)."
route = '''    # Aurelia Telegram exact POST endpoint (owner-approved secret-token auth).
    location = /football/api/integrations/telegram/webhook {
        auth_basic off;
        if ($request_method != POST) { return 405; }
        client_max_body_size 64k;
        limit_req zone=aurelia_telegram_webhook burst=10 nodelay;
        limit_req_status 429;
        proxy_pass http://127.0.0.1:3100/api/integrations/telegram/webhook;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Prefix /football;
        proxy_set_header X-Telegram-Bot-Api-Secret-Token $http_x_telegram_bot_api_secret_token;
        proxy_set_header Authorization "";
        proxy_connect_timeout 5s;
        proxy_send_timeout 30s;
        proxy_read_timeout 90s;
    }
'''
if marker not in config:
    anchor = "    location ^~ /football/ {"
    if config.count(anchor) != 1: raise SystemExit("Football route anchor is not unique")
    site.write_text(config.replace(anchor, route + anchor, 1))
print("Home secret configured root-only; exact POST route prepared; no token printed")
