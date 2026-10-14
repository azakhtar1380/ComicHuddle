#!/usr/bin/env python3
"""Generate numerical recognition features only from explicitly declared assets.

Does not download, edit, replace, or publish any cover art. Existing source and
rights attribution travel with every index entry. Run --check to verify output.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
WIDTH, HEIGHT = 18, 26
MAX_SIDE = 640


def thumbnail(image):
    """Same nine bilinear samples per cell as describeCoverPixels in TypeScript."""
    image = image.convert('RGB')
    if max(image.size) > MAX_SIDE:
        scale = MAX_SIDE / max(image.size)
        image = image.resize((max(2, math.floor(image.width * scale + .5)),
                              max(2, math.floor(image.height * scale + .5))), Image.Resampling.BOX)
    width, height = image.size
    pixels = image.load()

    def pixel(x, y, channel):
        x, y = max(0, min(width - 1, x)), max(0, min(height - 1, y))
        left, top = math.floor(x), math.floor(y)
        right, bottom = min(width - 1, left + 1), min(height - 1, top + 1)
        dx, dy = x - left, y - top
        return (pixels[left, top][channel] * (1-dx) * (1-dy)
                + pixels[right, top][channel] * dx * (1-dy)
                + pixels[left, bottom][channel] * (1-dx) * dy
                + pixels[right, bottom][channel] * dx * dy)

    values = []
    for y in range(HEIGHT):
        for x in range(WIDTH):
            for channel in range(3):
                value = sum(pixel((x+(sx+.5)/3)*width/WIDTH-.5,
                                  (y+(sy+.5)/3)*height/HEIGHT-.5, channel)
                            for sy in range(3) for sx in range(3)) / 9
                values.append(round(value, 3))
    return values


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    declared = json.loads((ROOT/'scripts/cover-recognition-references.json').read_text())
    references, seen = [], set()
    for record in declared['references']:
        identity = record['catalogId']
        if not isinstance(identity, int) or identity < 0 or identity in seen:
            raise ValueError('References require unique stable catalog IDs.')
        seen.add(identity)
        if not record['credit'] or not record['sourceUrl'].startswith('https://'):
            raise ValueError('Every reference requires an explicit source and rights credit.')
        cover = record['cover']
        if not cover.startswith('/covers/') or '..' in cover:
            raise ValueError('References must be declared local cover assets.')
        path = ROOT/'public'/cover.lstrip('/')
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        with Image.open(path) as image:
            rgb = thumbnail(image)
        references.append({**record, 'sha256':digest, 'rgb':rgb})
    index = {'version':1, 'width':WIDTH, 'height':HEIGHT, 'maxDistance':.14,
             'minMargin':.07, 'references':references}
    encoded = json.dumps(index, separators=(',', ':'), ensure_ascii=False) + '\n'
    output = ROOT/'public/recognition/cover-index.json'
    if args.check:
        if not output.exists() or output.read_text() != encoded:
            raise SystemExit('Cover index is stale. Run python scripts/build-cover-index.py.')
        print(f'Cover index verified: {len(references)} declared references.')
    else:
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(encoded)
        print(f'Cover index generated: {len(references)} declared references.')


if __name__ == '__main__':
    main()
