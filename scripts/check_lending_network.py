"""Read-only live diagnostics. Does not create wallets, sign, or submit transactions.

python scripts/check_lending_network.py [--account r...] [--output /tmp/report.json]
Exit 2 means live prerequisites are not satisfied; it is not a passing E2E test.
"""
import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'services' / 'api'))
from dotenv import load_dotenv
from lending_pool import create_app
from lending_pool.lending import LedgerError, inspect_network, paged, validated


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--account', help='Public classic address only; never provide a seed.')
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    load_dotenv()
    with create_app().app_context():
        report = dict(checked_at=datetime.now(timezone.utc).isoformat(),
                      evidence='live_read_only_RPC', transactions_submitted=0,
                      status=inspect_network())
        if args.account:
            try:
                report['account'] = validated('account_info', account=args.account)
                report['trustlines'] = paged('account_lines', 'lines', account=args.account)
            except LedgerError as error:
                report['account_error'] = str(error)
    output = json.dumps(report, indent=2) + '\n'
    if args.output:
        args.output.write_text(output)
    print(output)
    return 0 if report['status']['native_lending_ready'] else 2


if __name__ == '__main__':
    raise SystemExit(main())
