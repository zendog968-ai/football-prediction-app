#!/usr/bin/env python3
"""驗證既有精確 HTTPS 入口，再刷新同一 Home Telegram webhook。"""
import json
import os
from pathlib import Path
import shlex
import urllib.error
import urllib.request

if os.geteuid() != 0:
    raise SystemExit('請使用 sudo，密鑰只從既有 root-only 設定讀取')
values = {}
for line in Path('/etc/aurelia-football.env').read_text().splitlines():
    if not line or line.startswith('#') or '=' not in line:
        continue
    k, v = line.split('=', 1)
    values[k] = shlex.split(v)[0] if v else ''
expected = 'https://136-108-33-74.nip.io/football/api/integrations/telegram/webhook'
url = values.get('TELEGRAM_WEBHOOK_URL', '')
secret = values.get('TELEGRAM_WEBHOOK_SECRET', '')
token = values.get('TELEGRAM_BOT_TOKEN', '')
if url != expected or not secret or not token:
    raise SystemExit('Home webhook 設定缺失或不是已批准的入口；未更新')
backup = Path(Path('/tmp/aurelia-live-source-backup').read_text().strip()) / 'evidence'

def status(target, method='GET', body=None, headers=None):
    req = urllib.request.Request(target, data=body, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=25) as response:
            return response.status
    except urllib.error.HTTPError as exc:
        return exc.code

h = {'Content-Type': 'application/json'}
root = 'https://136-108-33-74.nip.io'
checks = {
    'unsigned_post': (status(url, 'POST', b'{}', h), 403),
    'wrong_secret_post': (status(url, 'POST', b'{}', {**h, 'X-Telegram-Bot-Api-Secret-Token': 'wrong-secret-test'}), 403),
    'signed_invalid_update': (status(url, 'POST', b'{}', {**h, 'X-Telegram-Bot-Api-Secret-Token': secret}), 400),
    'get_disallowed': (status(url), 405),
    'oversized_body': (status(url, 'POST', b'x'*65537, h), 413),
    'dashboard_basic_auth': (status(root+'/football/'), 401),
    'admin_basic_auth': (status(root+'/football/admin/configure'), 401),
    'hkjc_basic_auth': (status(root+'/health'), 401),
    'nonexact_sibling_basic_auth': (status(url+'/', 'POST', b'{}', h), 401),
}
backup.joinpath('security_after.json').write_text(json.dumps(checks, indent=2))
if any(actual != expected_status for actual, expected_status in checks.values()):
    raise SystemExit('入口安全驗證失敗；Telegram webhook 未更新')

def telegram(method, payload=None):
    request = urllib.request.Request('https://api.telegram.org/bot'+token+'/'+method,
        data=json.dumps(payload).encode() if payload is not None else None,
        headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(request, timeout=25) as response:
            data = json.load(response)
    except Exception as exc:
        raise SystemExit('Telegram 呼叫失敗：'+type(exc).__name__) from None
    if not data.get('ok'):
        raise SystemExit('Telegram 拒絕 '+method)
    return data['result']

before = telegram('getWebhookInfo')
backup.joinpath('webhook_refresh_before.json').write_text(json.dumps(before, indent=2))
payload = {'url': url, 'secret_token': secret, 'allowed_updates': ['message', 'callback_query'],
           'drop_pending_updates': False, 'max_connections': 4}
accepted = telegram('setWebhook', payload)
after = telegram('getWebhookInfo')
if not accepted or after.get('url') != url or after.get('max_connections') != 4 or set(after.get('allowed_updates', [])) != {'message', 'callback_query'}:
    raise SystemExit('Telegram webhook 回讀不一致；需要保留證據並排查')
backup.joinpath('webhook_after.json').write_text(json.dumps(after, indent=2))
print(json.dumps({'accepted': True, 'webhook_url': after.get('url'), 'max_connections': after.get('max_connections'),
    'allowed_updates': after.get('allowed_updates'), 'pending_update_count': after.get('pending_update_count'),
    'last_error_present': bool(after.get('last_error_message')), 'drop_pending_updates': False,
    'security_checks_passed': len(checks)}, ensure_ascii=False))
