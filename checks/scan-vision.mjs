// Real JPEG pixels + actual on-device matcher. No browser/hardware is exercised.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createReporter, loadTypeScriptModule, plain} from '../architecture/postgres/tests/runtime.mjs';
import {decodeCover, guidedCameraFrame} from './scan-pixels.mjs';

const root = process.cwd(), vision = loadTypeScriptModule('lib/cover-recognition.ts');
const {catalog} = loadTypeScriptModule('lib/catalog.ts');
const sourceIndex = JSON.parse(readFileSync('public/recognition/cover-index.json', 'utf8'));
const index = vision.parseCoverIndex(sourceIndex), reporter = createReporter('Scanner pixels and directory states');
const images = new Map(index.references.map(ref => [ref.catalogId, decodeCover(path.join(root, 'public', ref.cover))]));
function page(issues, total = issues.length, hasMore = false) {
  return {issues, total, limit: 12, offset: 0, hasMore, issueCount: catalog.length, scope: 'starter'};
}
const response = value => Response.json(value);
const issueFor = ref => catalog.find(issue => issue.id === ref.catalogId);
const first = index.references[0];
let providerCalls = 0;

await reporter.test('Six finite references match declared catalog identity, source and current asset digest', async () => {
  assert.equal(index.references.length, 6);
  for (const ref of index.references) {
    const issue = issueFor(ref); assert.ok(issue);
    assert.equal(issue.title, ref.title); assert.equal(issue.number, ref.number);
    assert.equal(issue.publisher, ref.publisher); assert.equal(issue.year, ref.year);
    assert.equal(issue.cover, ref.cover); assert.equal(issue.coverSource, ref.sourceUrl);
    assert.equal(ref.sha256, createHash('sha256').update(readFileSync(path.join(root, 'public', ref.cover))).digest('hex'));
  }
});
for (const ref of index.references) await reporter.test('Actual cover JPEG identifies exact #' + ref.number + ' with no manual label', async () => {
  const result = vision.recognizeCoverPixels(images.get(ref.catalogId), index, {mode: 'upload'});
  assert.equal(result.status, 'matched', JSON.stringify(result));
  assert.equal(result.suggestion.reference.catalogId, ref.catalogId);
  assert.ok(result.suggestion.distance <= index.maxDistance);
  assert.ok(result.suggestion.margin >= index.minMargin);
  console.log('PIXEL_EVIDENCE ' + JSON.stringify({catalogId: ref.catalogId, number: ref.number, distance: result.suggestion.distance, margin: result.suggestion.margin}));
});
await reporter.test('Guided camera crop agrees with independently computed object-fit geometry', async () => {
  const crop = vision.comicGuideCrop(480, 640, 320, 420);
  for (const [key, expected] of Object.entries({x: 59.19, y: 61.7, width: 361.62, height: 516.6})) assert.ok(Math.abs(crop[key] - expected) < .001, key);
  const result = vision.recognizeCoverPixels(guidedCameraFrame(images.get(first.catalogId)), index, {mode: 'camera', viewportWidth: 320, viewportHeight: 420});
  assert.equal(result.status, 'matched'); assert.equal(result.suggestion.reference.catalogId, first.catalogId);
});
await reporter.test('Moderate exposure change preserves the exact local identity without a probability claim', async () => {
  const image = images.get(first.catalogId), data = Uint8ClampedArray.from(image.data, (value, i) => i % 4 === 3 ? value : value * .8 + 18);
  const result = vision.recognizeCoverPixels({...image, data}, index, {mode: 'upload'});
  assert.equal(result.status, 'matched'); assert.equal(result.suggestion.reference.catalogId, first.catalogId);
  assert.equal(result.suggestion.confidence, undefined);
});
await reporter.test('Flat, noisy and invalid frames cannot be assigned to a reference', async () => {
  const width = 120, height = 180, flat = new Uint8ClampedArray(width * height * 4).fill(120);
  assert.equal(vision.recognizeCoverPixels({width, height, data: flat}, index, {mode: 'upload'}).status, 'unknown');
  const noise = Uint8ClampedArray.from(flat, (_, i) => i % 4 === 3 ? 255 : (i * 1103515245 + 12345) % 256);
  assert.equal(vision.recognizeCoverPixels({width, height, data: noise}, index, {mode: 'upload'}).status, 'unknown');
  assert.throws(() => vision.describeCoverPixels({width: 0, height: 0, data: []}));
  assert.throws(() => vision.describeCoverPixels({width: 2, height: 2, data: [1]}));
});
await reporter.test('Ambiguous references, missing index and malformed provenance do not qualify', async () => {
  const ambiguous = {...index, references: [index.references[0], {...index.references[0], catalogId: 9999}]};
  assert.equal(vision.recognizeCoverPixels(images.get(first.catalogId), ambiguous, {mode: 'upload'}).status, 'unknown');
  assert.equal(vision.recognizeCoverPixels(images.get(first.catalogId), {...index, references: []}, {mode: 'upload'}).status, 'index_unavailable');
  for (const bad of [{...sourceIndex, references: []}, {...sourceIndex, maxDistance: .9}, {...sourceIndex, minMargin: 0},
    {...sourceIndex, references: [{...sourceIndex.references[0], sourceUrl: 'http://bad.test'}]},
    {...sourceIndex, references: [{...sourceIndex.references[0], cover: '/covers/../private.jpg'}]}]) assert.throws(() => vision.parseCoverIndex(bad));
});
await reporter.test('Consensus requires separated stable frames and resets on identity change, uncertainty and timeout', async () => {
  const matched = vision.recognizeCoverPixels(images.get(first.catalogId), index, {mode: 'upload'});
  const other = vision.recognizeCoverPixels(images.get(index.references[1].catalogId), index, {mode: 'upload'});
  const consensus = vision.createCoverConsensus();
  assert.equal(consensus.push(matched, 0), null); assert.equal(consensus.push(matched, 50), null);
  assert.equal(consensus.push(matched, 450), null);
  assert.equal(consensus.push(matched, 900).reference.catalogId, first.catalogId);
  assert.equal(consensus.push(other, 1350), null); assert.equal(consensus.push({status: 'unknown'}, 1800), null);
  assert.equal(consensus.push(matched, 2250), null); assert.equal(consensus.push(matched, 2700), null);
  assert.equal(consensus.push(matched, 3150).reference.catalogId, first.catalogId);
  assert.equal(consensus.push(matched, 6000), null); consensus.reset();
  assert.equal(consensus.push(matched, Infinity), null); assert.equal(consensus.push(matched, 6500), null);
});
await reporter.test('Recognized ID is resolved exactly against directory; stale cover identity never proves absence', async () => {
  const requests = [], fetcher = async (url, options) => {requests.push({url, options}); return response(page([issueFor(first)]));};
  const result = await vision.resolveRecognizedIssue(first, fetcher);
  assert.equal(result.status, 'matched'); assert.equal(result.issue.id, first.catalogId);
  assert.equal(requests[0].url, '/api/catalog?id=' + first.catalogId); assert.equal(requests[0].options.cache, 'no-store');
  for (const fetcher of [async () => new Response('', {status: 404}), async () => new Response('', {status: 503}),
    async () => response(page([])), async () => response(page([{...issueFor(first), year: 2026}])),
    async () => response({issues: [issueFor(first)]}), async () => {throw Error('connection lost');}]) {
    assert.equal((await vision.resolveRecognizedIssue(first, fetcher)).status, 'index_unavailable');
  }
});
await reporter.test('Only a successful complete exact-identity empty search permits not-in-directory', async () => {
  assert.deepEqual(plain(vision.parseExactComicText('Planet Comics #12 (1941)')), {title: 'Planet Comics', number: '12', year: 1941});
  for (const text of ['012345678901', 'Planet Comics 12', 'blurred Planet #12 text', '', 'just a photo']) assert.equal(vision.parseExactComicText(text), null);
  const identity = {title: 'Missing Exact Title', number: '177', year: 1941};
  assert.equal((await vision.lookupExactComicText(identity, async () => response(page([])))).status, 'not_in_directory');
  assert.equal((await vision.lookupExactComicText(identity, async () => response(page([issueFor(first)])))).status, 'unknown');
  assert.equal((await vision.lookupExactComicText(identity, async () => new Response('', {status: 503}))).status, 'index_unavailable');
  assert.equal((await vision.lookupExactComicText(identity, async () => response({issues: [], total: 0}))).status, 'index_unavailable');
});
await reporter.test('Cancellation suppresses positive identity and absence even when fetch ignores abort', async () => {
  const controller = new AbortController(); controller.abort();
  assert.equal((await vision.resolveRecognizedIssue(first, async () => response(page([issueFor(first)])), controller.signal)).status, 'unknown');
  assert.equal((await vision.lookupExactComicText({title: 'Missing', number: '1'}, async () => response(page([])), controller.signal)).status, 'unknown');
});
reporter.finish({references: index.references.length, genuineProviderCalls: providerCalls, paymentExecutions: 0,
  browserE2E: 'NOT EXECUTED', hardwareCamera: 'NOT EXECUTED', corpus: 'Six declared local covers and synthetic controlled pixel conditions'});
