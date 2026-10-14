#!/usr/bin/env python3
"""Manually capture official issue-specific thumbnail references, not artwork.

This bounded run never changes the old bibliography datasets, schedules a job,
downloads image binaries or works around authentication/provider limits.
"""
import argparse
import datetime as dt
import hashlib
import json
from pathlib import Path
import urllib.error
import urllib.request

ORIGIN = 'https://www.comics.org'
# Prioritize coverage across the eight stored series, then fill their base issues.
PAGES = [(5109, 1), (141, 9), (4254, 1), (1482, 1), (1571, 1), (87, 1),
         (4611, 4), (4254, 2), (1482, 2), (1571, 2), (87, 2), (141, 10),
         (4611, 5), (4254, 3), (1482, 3), (1571, 3), (87, 3), (141, 11),
         (4611, 6), (141, 12), (4611, 7), (141, 13), (4611, 8), (141, 14),
         (141, 15), (1482, 4), (1571, 4), (87, 4)]


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def capture(root, budget):
    root.mkdir(parents=True, exist_ok=True)
    opener = urllib.request.build_opener(NoRedirect())
    requests, checkpoint = 0, None
    for series_id, page in PAGES:
        stem = f'series-{series_id}-overview-{page}'
        path, receipt_path = root / (stem + '.json'), root / (stem + '.receipt.json')
        if path.exists() and receipt_path.exists():
            continue
        url = f'{ORIGIN}/api/series/{series_id}/overview/' + (f'?page={page}' if page > 1 else '')
        if requests >= budget:
            checkpoint = {'reason': 'local_request_budget', 'next': url}
            break
        requests += 1
        try:
            with opener.open(urllib.request.Request(url, headers={
                    'Accept': 'application/json', 'User-Agent': 'ComicHuddleCatalog/1.0'}), timeout=25) as response:
                if response.status != 200 or not response.headers.get('Content-Type', '').startswith('application/json'):
                    raise ValueError('Unexpected provider content; stopped.')
                raw = response.read(6_000_001)
                if len(raw) > 6_000_000:
                    raise ValueError('Provider response exceeded the bound.')
                payload = json.loads(raw)
                if not isinstance(payload.get('results'), list) or len(payload['results']) > 50:
                    raise ValueError('Invalid official pagination.')
            receipt = {'url': url, 'fetchedAt': dt.datetime.now(dt.timezone.utc).isoformat(),
                       'httpStatus': 200, 'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest()}
            path.write_bytes(raw)
            receipt_path.write_text(json.dumps(receipt))
            print(json.dumps({'seriesId': series_id, 'page': page, 'rows': len(payload['results']),
                              'covers': sum(bool(row.get('cover_url')) for row in payload['results'])}), flush=True)
        except urllib.error.HTTPError as error:
            checkpoint = {'reason': 'provider_http_error', 'status': error.code,
                          'retryAfter': error.headers.get('Retry-After'), 'next': url}
            break
    (root / 'cover-reference-checkpoint.json').write_text(json.dumps(checkpoint, indent=2))
    print(json.dumps({'requests': requests, 'remainingCheckpoint': checkpoint}), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--cache', required=True)
    parser.add_argument('--max-requests', type=int, default=16)
    args = parser.parse_args()
    if not 1 <= args.max_requests <= 26:
        parser.error('Choose a budget of 1–26, allowing for other requests this hour.')
    capture(Path(args.cache), args.max_requests)
