#!/usr/bin/env python3
"""Capture bounded official GCD series overviews, excluding all artwork.

This produces a selected-series seed, never a full-catalog claim. Existing
response receipts are reused. Run manually; no background refresh is enabled.
"""
import argparse
import datetime as dt
import hashlib
import json
from pathlib import Path
import urllib.error
import urllib.request

ORIGIN = 'https://www.comics.org'
LICENSE = 'https://creativecommons.org/licenses/by-sa/4.0/'
SERIES = [(1570, 'series-1570', 9), (141, 'batman-1940-search', 8),
          (4611, 'spawn-1992-search', 3)]


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def capture(args):
    root = Path(args.cache)
    root.mkdir(parents=True, exist_ok=True)
    opener = urllib.request.build_opener(NoRedirect())
    requests = 0
    records = {}
    pages = []
    scopes = []
    stopped = None
    for series_id, stem, max_pages in SERIES:
        metadata = json.loads((root / (stem + '.json')).read_text())
        series = metadata['results'][0] if 'results' in metadata else metadata
        if series['api_url'] != f'{ORIGIN}/api/series/{series_id}/':
            raise ValueError('Cached series identity does not match the scope.')
        publisher_id = int(series['publisher'].rstrip('/').split('/')[-1])
        publisher = json.loads((root / f'publisher-{publisher_id}.json').read_text())
        if publisher['api_url'] != series['publisher']:
            raise ValueError('Publisher identity does not match the series.')
        issue_ids = set(series['active_issues'])
        seen = set()
        expected = None
        next_url = f'{ORIGIN}/api/series/{series_id}/overview/'
        for page in range(1, max_pages + 1):
            stem = f'series-{series_id}-overview-{page}'
            source_path = root / (stem + '.json')
            receipt_path = root / (stem + '.receipt.json')
            if not (source_path.exists() and receipt_path.exists()):
                if requests >= args.max_requests:
                    stopped = {'reason': 'local_request_budget', 'next': next_url}
                    break
                requests += 1
                try:
                    with opener.open(urllib.request.Request(next_url, headers={
                        'Accept': 'application/json',
                        'User-Agent': 'ComicHuddleCatalog/1.0'}), timeout=30) as response:
                        if response.status != 200 or not response.headers.get('Content-Type', '').startswith('application/json'):
                            raise ValueError('GCD returned unexpected content.')
                        raw = response.read(6_000_001)
                        if len(raw) > 6_000_000:
                            raise ValueError('GCD response exceeded the size bound.')
                    receipt = {'url': next_url,
                        'fetchedAt': dt.datetime.now(dt.timezone.utc).isoformat(),
                        'httpStatus': 200, 'bytes': len(raw),
                        'sha256': hashlib.sha256(raw).hexdigest()}
                    source_path.write_bytes(raw)
                    receipt_path.write_text(json.dumps(receipt))
                except urllib.error.HTTPError as error:
                    stopped = {'reason': 'provider_http_error', 'status': error.code,
                        'retryAfter': error.headers.get('Retry-After'), 'next': next_url}
                    break
            raw = source_path.read_bytes()
            receipt = json.loads(receipt_path.read_text())
            if receipt['url'] != next_url or receipt['httpStatus'] != 200:
                raise ValueError('Response receipt does not match the requested page.')
            digest = hashlib.sha256(raw).hexdigest()
            if receipt.get('sha256', digest) != digest or receipt['bytes'] != len(raw):
                raise ValueError('Cached response failed its checksum.')
            result = json.loads(raw)
            count = result['count']
            if not isinstance(count, int) or count < 0 or len(result['results']) > 50:
                raise ValueError('Invalid GCD pagination.')
            if expected is not None and expected != count:
                raise ValueError('GCD series count changed; reconcile before importing.')
            expected = count
            expected_next = f'{ORIGIN}/api/series/{series_id}/overview/?page={page + 1}'
            if result['next'] is not None and result['next'] != expected_next:
                raise ValueError('GCD pagination cannot change origin or skip a page.')
            for entry in result['results']:
                issue_id = entry['issue_id']
                identity = f'{ORIGIN}/api/issue/{issue_id}/'
                if not isinstance(issue_id, int) or issue_id < 1 or identity not in issue_ids or issue_id in seen or issue_id in records:
                    raise ValueError('Unknown or repeated provider issue identity.')
                if not isinstance(entry['number'], str) or not entry['number'].strip():
                    raise ValueError('An issue number is required.')
                seen.add(issue_id)
                # Overview explicitly excludes variants and only supplies the
                # longest comic story. Missing full-issue fields stay absent.
                api_record = {'api_url': identity,
                    'series': series['api_url'],
                    'series_name': f"{series['name']} ({series['year_began']} series)",
                    'publisher_name': publisher['name'],
                    'number': entry['number'], 'descriptor': entry['descriptor'],
                    'publication_date': entry.get('publication_date', ''),
                    'key_date': entry.get('key_date', ''),
                    'on_sale_date': entry.get('on_sale_date', ''),
                    'variant_of': None,
                    'story_set': [entry['longest_story']] if entry.get('longest_story') else [],
                    'notes': 'Official GCD series overview: base issue and longest comic story. Full issue bibliography and variant records require further enrichment.'}
                records[issue_id] = {'sourcePage': next_url,
                    'fetchedAt': receipt['fetchedAt'], 'record': api_record}
            pages.append({'url': next_url, 'seriesId': series_id,
                'page': page, 'providerCount': count,
                'rows': len(result['results']), 'fetchedAt': receipt['fetchedAt'],
                'responseSha256': digest})
            print(json.dumps({'seriesId': series_id, 'page': page,
                'savedRows': len(result['results']), 'uniqueRecords': len(records)}), flush=True)
            next_url = result['next']
            if next_url is None:
                if len(seen) != count:
                    raise ValueError('Completed series failed row-count reconciliation.')
                break
        scopes.append({'gcdSeriesId': series_id, 'title': series['name'],
            'publisher': publisher['name'], 'yearBegan': series['year_began'],
            'activeIssuesIncludingVariants': len(issue_ids),
            'expectedBaseIssues': expected, 'capturedBaseIssues': len(seen),
            'baseIssuesComplete': next_url is None and expected == len(seen),
            'nextPage': next_url, 'variantsIncluded': False})
        if stopped:
            break
    output = Path(args.output)
    manifest_path = Path(args.manifest)
    if output.exists() or manifest_path.exists() or not records:
        raise ValueError('Use new output paths and capture at least one real issue.')
    data = ''.join(json.dumps(records[key], ensure_ascii=False, separators=(',', ':')) + '\n'
                   for key in sorted(records)).encode('utf-8')
    manifest = {'schemaVersion': 'gcd-rds-seed/v1', 'provider': 'GCD',
        'scope': 'selected_series_main_story_overviews', 'catalogComplete': False,
        'license': LICENSE, 'expectedRecords': len(records),
        'datasetSha256': hashlib.sha256(data).hexdigest(),
        'sources': pages, 'series': scopes, 'newRequestsThisRun': requests,
        'remainingCheckpoint': stopped,
        'artworkImported': False, 'valuationImported': False,
        'attribution': 'Grand Comics Database. Bibliographic fields selected and formatted by ComicHuddle. CC BY-SA 4.0.',
        'fieldCoverage': 'Base issues and longest comic story; full issue fields and variants are incomplete.'}
    output.write_bytes(data)
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'records': len(records), 'requests': requests,
        'catalogComplete': False, 'checkpoint': stopped}), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--cache', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--manifest', required=True)
    parser.add_argument('--max-requests', type=int, default=15)
    arguments = parser.parse_args()
    if not 1 <= arguments.max_requests <= 26:
        parser.error('Use a request budget between 1 and 26; account for other calls this hour.')
    capture(arguments)
