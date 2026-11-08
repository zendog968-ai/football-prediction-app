#!/usr/bin/env python3
"""Owner-authorized installation. Run as root; no Nginx/UFW/other app changes."""
from pathlib import Path
import os, shutil, subprocess, grp
SOURCE=Path(__file__).resolve().parents[1]
DEST=Path('/opt/aurelia-football-operations')
assert os.geteuid()==0
DEST.mkdir(mode=0o755,exist_ok=True)
shutil.copy2(SOURCE/'deploy/football_operations.py',DEST/'football_operations.py')
shutil.copytree(SOURCE/'supabase-sync/football_sync',DEST/'football_sync',dirs_exist_ok=True,ignore=shutil.ignore_patterns('__pycache__','*.pyc'))
if not (DEST/'venv/bin/python').exists():shutil.copytree('/home/ubuntu/aurelia-quality-test-venv',DEST/'venv',symlinks=True)
for p in [DEST,*DEST.rglob('*')]:
 if not p.is_symlink(): os.chown(p,0,0)
STATE=Path('/var/lib/aurelia-operations');STATE.mkdir(mode=0o2750,exist_ok=True);os.chown(STATE,0,grp.getgrnam('ubuntu').gr_gid);os.chmod(STATE,0o2750)
for p in STATE.glob('*.json'):os.chown(p,0,grp.getgrnam('ubuntu').gr_gid);os.chmod(p,0o640)
service='''[Unit]
Description=Aurelia read-only model research operations (%i)
After=network-online.target aurelia-football.service mariadb.service
Wants=network-online.target
[Service]
Type=oneshot
User=root
Group=ubuntu
WorkingDirectory=/opt/aurelia-football-operations
Environment=FOOTBALL_PROJECT_ROOT=/home/ubuntu/aurelia-football
Environment=FOOTBALL_OPERATIONS_DIR=/var/lib/aurelia-operations
Environment=PYTHONDONTWRITEBYTECODE=1
ExecStart=/opt/aurelia-football-operations/venv/bin/python -B /opt/aurelia-football-operations/football_operations.py --mode %i
TimeoutStartSec=8min
Nice=10
CPUQuota=50%
MemoryMax=500M
UMask=0027
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=/var/lib/aurelia-operations
PrivateTmp=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
'''
Path('/etc/systemd/system/aurelia-operations@.service').write_text(service)
for mode,schedule in [('refresh','*-*-* *:00/15:00 Asia/Hong_Kong'),('day','*-*-* 09:10:00 Asia/Hong_Kong'),('evening','*-*-* 17:10:00 Asia/Hong_Kong'),('weekly','Mon *-*-* 09:20:00 Asia/Hong_Kong')]:
 timer=f'''[Unit]
Description=Aurelia Football {mode} schedule
[Timer]
OnCalendar={schedule}
Unit=aurelia-operations@{mode}.service
Persistent=true
AccuracySec=20s
[Install]
WantedBy=timers.target
'''
 Path('/etc/systemd/system/aurelia-operations-'+mode+'.timer').write_text(timer)
# Set a non-secret owner flag without touching or printing the root credential file.
Path('/etc/systemd/system/aurelia-football.service.d').mkdir(exist_ok=True)
Path('/etc/systemd/system/aurelia-football.service.d/40-operations-owner.conf').write_text('[Service]\nEnvironment=FOOTBALL_OPERATIONS_OWNER=home\nEnvironment=FOOTBALL_OPERATIONS_STATE_PATH=/var/lib/aurelia-operations/latest.json\nEnvironment=HOST=127.0.0.1\n')
subprocess.run(['systemctl','daemon-reload'],check=True)
print('Installed root-owned operations scripts and units; timers NOT enabled until parent validation')
