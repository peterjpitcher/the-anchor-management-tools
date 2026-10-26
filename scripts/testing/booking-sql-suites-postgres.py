#!/usr/bin/env python3
"""Run the booking SQL suites that used to need a hand-started database, each in its own
isolated socket-only PostgreSQL cluster, so CI runs them on every change (BK-126, customer
bookings review of 24 October 2026).

Each file builds its own fixture and asserts with ON_ERROR_STOP, so a failed assertion makes
psql exit non-zero. A fresh cluster per file keeps their CREATE ROLE statements apart. Nothing
here connects to a linked or production database.
"""
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
PG = Path(os.environ.get('PG_BIN', '/opt/homebrew/bin'))
SUITES = [
    # Christmas course snapshot on table bookings and its activation switch.
    'tests/db/christmas-course-snapshot.sql',
    'tests/db/christmas-course-activation.sql',
    # Walk-ins pass the service-window guard and nothing else does (applies the real migrations).
    'tests/db/service-window-walk-ins.sql',
    # Event bookings with dining requests (create_event_booking_with_requests_v01).
    'tests/database/event-booking-dining-requests.sql',
]


def run_suite(relative):
    path = ROOT / relative
    with tempfile.TemporaryDirectory(prefix='booking-sql-') as folder:
        work = Path(folder); socket = work / 'socket'; socket.mkdir(); cluster = work / 'db'
        subprocess.run([str(PG / 'initdb'), '-D', str(cluster), '-A', 'trust', '--no-locale'], check=True, capture_output=True)
        subprocess.run([str(PG / 'pg_ctl'), '-D', str(cluster), '-l', str(work / 'log'), '-o', f"-k {socket} -c listen_addresses=''", '-w', 'start'],
                       check=True, capture_output=True)
        try:
            result = subprocess.run([str(PG / 'psql'), '-h', str(socket), '-d', 'postgres', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-f', str(path)],
                                    text=True, capture_output=True, cwd=str(path.parent))
            if result.returncode:
                raise RuntimeError(f'FAIL {relative}\n{result.stderr}')
            print(f'PASS {relative}')
        finally:
            subprocess.run([str(PG / 'pg_ctl'), '-D', str(cluster), '-m', 'immediate', '-w', 'stop'], check=True, capture_output=True)


def main():
    for suite in SUITES:
        run_suite(suite)


if __name__ == '__main__': main()
