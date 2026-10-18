#!/usr/bin/env python3
"""Verify exact HTTPS security boundary, then apply owner-approved Telegram cutover."""
import argparse
import json
import os
from pathlib import Path
import shlex
import urllib.error
import urllib.request

parser = argparse.ArgumentParser()
parser.add_argument("--switch", action="store_true")
args = parser.parse_args()
if os.geteuid() != 0: raise SystemExit("Run with sudo")
values = {}
for line in Path('/etc/aurelia-football.env').read_text().splitlines():
    if not line or line.startswith('#') or '=' not in line: continue
    k, v = line.split('=', 1)
    values[k] = shlex.split(v)[0] if v else ''
url = values['TELEGRAM_WEBHOOK_URL']
secret = values['TELEGRAM_WEBHOOK_SECRET']
token = values['TELEGRAM_BOT_TOKEN']
backup = Path(Path('/tmp/aurelia-webhook-backup-path').read_text().strip())

def request_status(target, method='GET', body=None, headers=None):
    req = urllib.request.Request(target, data=body, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=25) as response:
            return response.status
    except urllib.error.HTTPError as exc:
        return exc.code

root = 'https://136-108-33-74.nip.io'
base_headers = {'Content-Type': 'application/json'}
checks = {
    'unsigned_post': (request_status(url, 'POST', b'{}', base_headers), 403),
    'wrong_secret_post': (request_status(url, 'POST', b'{}', {**base_headers, 'X-Telegram-Bot-Api-Secret-Token': 'wrong-secret-test'}), 403),
    'signed_invalid_update': (request_status(url, 'POST', b'{}', {**base_headers, 'X-Telegram-Bot-Api-Secret-Token': secret}), 400),
    'get_disallowed': (request_status(url), 405),
    'oversized_body': (request_status(url, 'POST', b'x'*65537, base_headers), 413),
    'dashboard_still_basic_auth': (request_status(root+'/football/'), 401),
    'admin_still_basic_auth': (request_status(root+'/football/admin/configure'), 401),
    'hkjc_health_still_basic_auth': (request_status(root+'/health'), 401),
    'nonexact_sibling_still_basic_auth': (request_status(url+'/', 'POST', b'{}', base_headers), 401),
}
for name, (actual, expected) in checks.items():
    print(f'{name}: HTTP {actual}; expected {expected}')
if any(actual != expected for actual, expected in checks.values()):
    raise SystemExit('Security checks failed; webhook was NOT switched')
(backup/'https_security_checks.json').write_text(json.dumps({k:v[0] for k,v in checks.items()}, indent=2))

def telegram_call(method, payload=None):
    # Never print a urllib exception, whose URL could contain the token.
    req = urllib.request.Request('https://api.telegram.org/bot'+token+'/'+method, data=json.dumps(payload).encode() if payload is not None else None, headers={'Content-Type':'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=25) as response: data = json.load(response)
    except Exception as exc:
        raise SystemExit('Telegram request failed: '+type(exc).__name__) from None
    if not data.get('ok'): raise SystemExit('Telegram rejected '+method)
    return data.get('result')

before = telegram_call('getWebhookInfo')
if not (backup/'webhook_before.json').exists():
    (backup/'webhook_before.json').write_text(json.dumps(before, indent=2))
if args.switch:
    telegram_call('setWebhook', {'url':url, 'secret_token':secret, 'allowed_updates':['message','callback_query'], 'drop_pending_updates':False, 'max_connections':4})
    after = telegram_call('getWebhookInfo')
    if after.get('url') != url or after.get('max_connections') != 4: raise SystemExit('Telegram configuration verification failed')
    (backup/'webhook_after.json').write_text(json.dumps(after, indent=2))
    print(json.dumps({'webhook_url':after.get('url'), 'max_connections':after.get('max_connections'), 'pending_update_count':after.get('pending_update_count'), 'allowed_updates':after.get('allowed_updates'), 'last_error_present':bool(after.get('last_error_message')), 'drop_pending_updates':False}, ensure_ascii=False))
else:
    print('Security boundary verified; current webhook unchanged')
