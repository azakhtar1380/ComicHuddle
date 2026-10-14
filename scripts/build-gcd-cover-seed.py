#!/usr/bin/env python3
"""Retain exact official cover-reference source witnesses; no artwork download."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil

def build(cache, root):
    sources, ids = [], set()
    target = root / 'db/gcd-cover-sources'
    target.mkdir(parents=True, exist_ok=True)
    for path in sorted(cache.glob('series-*-overview-*.json')):
        if '.receipt.' in path.name:
            continue
        receipt = json.loads(path.with_name(path.stem + '.receipt.json').read_text())
        raw = path.read_bytes()
        digest = hashlib.sha256(raw).hexdigest()
        if receipt['httpStatus'] != 200 or receipt['bytes'] != len(raw) or receipt.get('sha256', digest) != digest:
            raise ValueError('Invalid original response receipt.')
        response = json.loads(raw)
        series_id = int(path.name.split('-')[1])
        for row in response['results']:
            if row.get('cover_url'):
                if row['issue_id'] in ids:
                    raise ValueError('Repeated exact cover issue identity.')
                ids.add(row['issue_id'])
        shutil.copyfile(path, target / path.name)
        sources.append({'file': path.name, 'url': receipt['url'], 'seriesId': series_id,
                        'sha256': digest, 'fetchedAt': receipt['fetchedAt'], 'rows': len(response['results'])})
    checkpoint = json.loads((cache / 'cover-reference-checkpoint.json').read_text())
    manifest = {'schemaVersion': 'gcd-cover-references/v1', 'scope': 'selected_series_base_issue_thumbnails',
                'expectedReferences': len(ids), 'sources': sources, 'catalogComplete': False,
                'artworkBinariesCopied': False, 'coversLicensedByMetadata': False,
                'remainingCheckpoint': checkpoint,
                'displayPurpose': 'Reduced thumbnails identify indexed editions. Artwork copyright remains with publishers/artists; metadata CC licensing does not cover artwork.',
                'rightsSources': ['https://www.comics.org/', 'https://www.copyright.gov/fair-use/']}
    (root / 'db/gcd-cover-references.manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(json.dumps({'exactCoverReferences': len(ids), 'sourcePages': len(sources), 'artworkBinariesCopied': False}))

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--cache', type=Path, required=True)
    parser.add_argument('--root', type=Path, default=Path.cwd())
    args = parser.parse_args()
    build(args.cache, args.root)
