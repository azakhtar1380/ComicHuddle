// Execute actual TSX hooks/callbacks with controlled media/canvas/timer adapters.
// Real matcher code consumes actual JPEG pixels. This is not physical browser E2E.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createReporter, loadTypeScriptModule} from '../architecture/postgres/tests/runtime.mjs';
import {createScannerFixture} from './scanner-hooks.mjs';
import {decodeCover, guidedCameraFrame} from './scan-pixels.mjs';

const reporter = createReporter('Live scanner controlled client integration');
const manifest = JSON.parse(readFileSync('public/recognition/cover-index.json', 'utf8'));
const {catalog} = loadTypeScriptModule('lib/catalog.ts'), issue = catalog.find(value => value.id === 24);
const image = decodeCover('public/covers/planet-12.jpg'), cameraPixels = guidedCameraFrame(image);
const page = issues => ({issues, total: issues.length, limit: 12, offset: 0, hasMore: false, issueCount: catalog.length, scope: 'starter'});
const fetcher = async url => {
  if (url === '/recognition/cover-index.json') return Response.json(manifest);
  assert.equal(url, '/api/catalog?id=24'); return Response.json(page([issue]));
};
async function start(fixture) {
  await fixture.flush(); await fixture.click('Start camera');
  const live = fixture.stream(); fixture.calls.cameras.at(-1).resolve(live); await fixture.flush();
  return live;
}
const manualPicker = fixture => fixture.find(node => typeof node.type === 'function' && node.type.name === 'ComicPicker');

await reporter.test('Initial screen explains finite coverage, private pixels and explicit confirmation', async () => {
  const fixture = createScannerFixture(); await fixture.flush();
  assert.match(fixture.snapshot(), /match appears automatically/);
  assert.match(fixture.snapshot(), /6 covers/); assert.match(fixture.snapshot(), /stay on your device/);
  assert.match(fixture.snapshot(), /unknown/); assert.equal(fixture.calls.cameras.length, 0);
  assert.equal(fixture.find(node => node.type === 'button' && fixture.text(node).includes('Confirm & add')), undefined);
  fixture.unmount();
});
await reporter.test('Permission denial is actionable and triggers no recognition request', async () => {
  const fixture = createScannerFixture(); await fixture.flush(); await fixture.click('Start camera');
  const error = Error('Permission denied'); error.name = 'NotAllowedError'; fixture.calls.cameras[0].reject(error); await fixture.flush();
  assert.match(fixture.status(), /permission was not granted/); assert.ok(fixture.button('Start camera'));
  assert.equal(fixture.calls.requests.length, 0); assert.equal(fixture.calls.collected.length, 0); fixture.unmount();
});
await reporter.test('Explicit center Scan opt-in requests the camera once without another start click', async () => {
  const fixture = createScannerFixture({props:{startOnOpen:true}}); await fixture.flush();
  assert.equal(fixture.calls.cameras.length,1); assert.equal(fixture.calls.cameras[0].options.audio,false);
  assert.equal(fixture.calls.requests.length,0); const live=fixture.stream();
  fixture.calls.cameras[0].resolve(live); await fixture.flush(); assert.ok(fixture.find(node=>node.type==='video'));
  fixture.unmount(); assert.equal(live.track.stops,1);
});
await reporter.test('Discarded opt-in effect cannot prompt after cleanup and late permission stops its tracks', async () => {
  const cancelled = createScannerFixture({props:{startOnOpen:true}}); cancelled.commitEffects(); cancelled.unmount(); await cancelled.flush();
  assert.equal(cancelled.calls.cameras.length,0);
  const pending=createScannerFixture({props:{startOnOpen:true}}); await pending.flush(); assert.equal(pending.calls.cameras.length,1);
  pending.unmount(); const live=pending.stream(); pending.calls.cameras[0].resolve(live); await pending.flush();
  assert.equal(live.track.stops,1); assert.equal(pending.calls.collected.length,0);
});
await reporter.test('Late camera permission is stopped when a photo supersedes it', async () => {
  const fixture = createScannerFixture({fetcher}); await fixture.flush(); await fixture.click('Start camera');
  await fixture.upload({type: 'image/jpeg', size: 500}); const preview = fixture.calls.urls.at(-1).url;
  const stale = fixture.stream(); fixture.calls.cameras[0].resolve(stale); await fixture.flush();
  assert.equal(stale.track.stops, 1); assert.equal(fixture.find(node => node.type === 'video'), undefined);
  assert.equal(fixture.find(node => node.type === 'img' && node.props.src === preview)?.props.src, preview);
  assert.equal(fixture.calls.collected.length, 0); fixture.unmount();
});
await reporter.test('Three qualified live frames automatically resolve one exact directory candidate without Capture', async () => {
  const fixture = createScannerFixture({pixels: cameraPixels, fetcher}), live = await start(fixture);
  assert.equal(fixture.calls.cameras[0].options.audio, false);
  assert.equal(fixture.calls.cameras[0].options.video.facingMode.ideal, 'environment');
  await fixture.advance(0); assert.equal(fixture.calls.requests.filter(value => value.url.includes('/api/catalog')).length, 0);
  await fixture.advance(450); assert.equal(fixture.calls.requests.filter(value => value.url.includes('/api/catalog')).length, 0);
  await fixture.advance(450);
  assert.equal(fixture.calls.requests.filter(value => value.url === '/api/catalog?id=24').length, 1);
  assert.match(fixture.status(), /Recognized Planet Comics #12/); assert.ok(fixture.button('Confirm & add'));
  assert.equal(live.track.stops, 1); assert.equal(fixture.calls.collected.length, 0);
  await fixture.click('Confirm & add'); assert.equal(fixture.calls.collected.length, 1);
  assert.equal(fixture.calls.collected[0].id, 24); assert.equal(fixture.calls.closed, 1);
  assert.equal(fixture.calls.requests.filter(value => value.url === '/api/catalog?id=24').length, 2);
  for (const request of fixture.calls.requests) {assert.ok(request.url.startsWith('/')); assert.equal(request.options.body, undefined); assert.notEqual(request.options.method, 'POST');}
  fixture.unmount();
});
await reporter.test('One pending frame/index request cannot overlap another and stop aborts it', async () => {
  const fixture = createScannerFixture({pixels: cameraPixels}), live = await start(fixture);
  await fixture.advance(0); assert.equal(fixture.calls.requests.length, 1);
  await fixture.advance(900); await fixture.advance(900); assert.equal(fixture.calls.requests.length, 1);
  assert.equal(fixture.calls.drawn.length, 0); await fixture.click('Stop camera');
  assert.equal(fixture.calls.requests[0].options.signal.aborted, true); assert.equal(live.track.stops, 1);
  fixture.calls.requests[0].resolve(Response.json(manifest)); await fixture.flush(); await fixture.advance(900);
  assert.equal(fixture.calls.requests.length, 1); assert.match(fixture.status(), /Camera stopped/); fixture.unmount();
});
await reporter.test('New manual issue survives an old cover-to-directory result when fetch ignores abort', async () => {
  const fixture = createScannerFixture({pixels: image}); await fixture.flush(); await fixture.upload({type: 'image/jpeg', size: 500});
  fixture.calls.requests[0].resolve(Response.json(manifest)); await fixture.flush();
  assert.equal(fixture.calls.requests[1].url, '/api/catalog?id=24'); await fixture.click('Search directory manually');
  assert.ok(manualPicker(fixture)); manualPicker(fixture).props.onChange(catalog[10]); await fixture.flush();
  assert.equal(fixture.calls.requests[1].options.signal.aborted, true);
  fixture.calls.requests[1].resolve(Response.json(page([issue]))); await fixture.flush();
  assert.match(fixture.snapshot(), new RegExp(catalog[10].title));
  assert.equal(fixture.calls.collected.length, 0); fixture.unmount();
});
await reporter.test('Unknown camera frames stay unknown and index failure cannot claim not-in-directory', async () => {
  const fixture = createScannerFixture({fetcher}), live = await start(fixture);
  await fixture.advance(0); await fixture.advance(4500);
  assert.match(fixture.status(), /No confident match yet/);
  assert.equal(fixture.calls.requests.filter(value => value.url.includes('/api/catalog')).length, 0);
  assert.equal(fixture.find(node => node.type === 'button' && fixture.text(node).includes('Confirm & add')), undefined);
  assert.equal(live.track.stops, 0); fixture.unmount(); assert.equal(live.track.stops, 1);
  const unavailable = createScannerFixture({fetcher: async () => new Response('', {status: 503})});
  const rejected = await start(unavailable); await unavailable.advance(0);
  assert.match(unavailable.status(), /index could not be loaded/); assert.equal(rejected.track.stops, 1);
  assert.ok(!unavailable.snapshot().includes('EXACT SEARCH NOT IN DIRECTORY')); unavailable.unmount();
});
await reporter.test('Hidden tab disables tracks, clears work and resumes a fresh consensus on visibility', async () => {
  const fixture = createScannerFixture({pixels: cameraPixels, fetcher}), live = await start(fixture);
  await fixture.advance(0); await fixture.advance(450); await fixture.visibility(true);
  assert.equal(live.track.enabled, false); await fixture.advance(900);
  assert.equal(fixture.calls.requests.filter(value => value.url.includes('/api/catalog')).length, 0);
  await fixture.visibility(false); assert.equal(live.track.enabled, true);
  await fixture.advance(0); await fixture.advance(450);
  assert.equal(fixture.calls.requests.filter(value => value.url.includes('/api/catalog')).length, 0);
  await fixture.advance(450); assert.ok(fixture.button('Confirm & add')); fixture.unmount();
});
await reporter.test('Unmount stops tracks, cancels timers/requests, revokes preview and ignores late errors', async () => {
  const fixture = createScannerFixture({pixels: image}); await fixture.flush(); await fixture.upload({type: 'image/jpeg', size: 500});
  const preview = fixture.calls.urls.at(-1).url; assert.equal(fixture.calls.requests.length, 1);
  const snapshot = fixture.snapshot(); fixture.unmount(); fixture.calls.requests[0].reject(Error('late unmounted request')); await fixture.flush();
  assert.equal(fixture.calls.requests[0].options.signal.aborted, true); assert.ok(fixture.calls.revoked.includes(preview));
  assert.equal(fixture.snapshot(), snapshot); assert.equal(fixture.calls.collected.length, 0);
  const camera = createScannerFixture(), live = await start(camera); camera.unmount(); assert.equal(live.track.stops, 1);
  assert.equal(camera.calls.timers.filter(value => !value.cancelled).length, 0);
});
await reporter.test('Final confirmation rechecks canonical identity and refuses an unavailable directory', async () => {
  let exactCalls = 0;
  const fixture = createScannerFixture({pixels: image, fetcher: async url => {
    if (url === '/recognition/cover-index.json') return Response.json(manifest);
    exactCalls++; return exactCalls === 1 ? Response.json(page([issue])) : new Response('', {status: 404});
  }});
  await fixture.flush(); await fixture.upload({type: 'image/jpeg', size: 500}); assert.ok(fixture.button('Confirm & add'));
  await fixture.click('Confirm & add'); assert.equal(fixture.calls.collected.length, 0); assert.equal(fixture.calls.closed, 0);
  assert.match(fixture.status(), /directory record could not be verified/); fixture.unmount();
});
reporter.finish({genuineProviderCalls: 0, paymentExecutions: 0, browserE2E: 'NOT EXECUTED', hardwareCamera: 'NOT EXECUTED'});
