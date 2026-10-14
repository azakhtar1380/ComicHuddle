// Controlled React hooks execute the actual scanner component and callbacks.
// These are not a browser, DOM, hardware, camera permission or device decode test.
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';

export function createScannerFixture(options = {}) {
  const root = process.cwd(), require = createRequire(path.join(root, 'package.json'));
  const states = [], refs = [], slots = [], effects = [], modules = new Map();
  const calls = {cameras: [], requests: [], detections: [], blobs: [], urls: [], revoked: [],
    collected: [], opened: [], closed: 0, timers: [], visibility: new Set(), drawn: [], modalOpened:0, modalClosed:0, focused:0};
  let cursor = 0, currentTime = 0, dirty = false, tree, mounted = false, disposed = false;
  let pixels = options.pixels || {width: 32, height: 48,
    data: new Uint8ClampedArray(32 * 48 * 4).fill(120)};
  function state(initial) {
    const key = cursor++;
    if (!(key in states)) states[key] = typeof initial === 'function' ? initial() : initial;
    return [states[key], next => {states[key] = typeof next === 'function' ? next(states[key]) : next; dirty = true;}];
  }
  function ref(initial) {const key = cursor++; if (!(key in refs)) refs[key] = {current: initial}; return refs[key];}
  function effect(callback, dependencies) {
    const key = cursor++, old = slots[key];
    const changed = !old || !dependencies || dependencies.length !== old.dependencies?.length
      || dependencies.some((value, index) => !Object.is(value, old.dependencies[index]));
    if (changed) effects.push(() => {old?.cleanup?.(); const cleanup = callback();
      slots[key] = {dependencies, cleanup: typeof cleanup === 'function' ? cleanup : null};});
  }
  const hookReact = {useState: state, useRef: ref, useEffect: effect, useId:()=> 'qa-title-' + cursor++,
    useMemo: (callback,dependencies) => {const key=cursor++,old=slots[key];if(!old||!dependencies||dependencies.some((value,index)=>!Object.is(value,old.dependencies?.[index]))){slots[key]={dependencies,value:callback()}}return slots[key].value;}, useCallback: (callback,dependencies) => {const key=cursor++,old=slots[key];if(!old||!dependencies||dependencies.some((value,index)=>!Object.is(value,old.dependencies?.[index]))){slots[key]={dependencies,value:callback}}return slots[key].value;}};
  const jsx = (type, props, key) => ({type, props: {...props, key}});
  const requests = (url, requestOptions = {}) => new Promise((resolve, reject) => {
    const request = {url, options: requestOptions, resolve, reject};
    calls.requests.push(request);
    if (options.fetcher) Promise.resolve(options.fetcher(url, requestOptions)).then(resolve, reject);
  });
  function makeTimer(callback, delay) {const timer = {callback, delay, at: currentTime + (delay || 0), cancelled: false}; calls.timers.push(timer); return timer;}
  const viewport = {clientWidth: 320, clientHeight: 420, getBoundingClientRect: () => ({width: 320, height: 420})};
  const video = {videoWidth: pixels.width, videoHeight: pixels.height, readyState: 4,
    ...viewport, srcObject: null, play: () => Promise.resolve(), pause() {}};
  const dialog = {showModal(){calls.modalOpened++;},close(){calls.modalClosed++;},focus(){calls.focused++;}};
  const document = {visibilityState: 'visible', hidden: false,
    addEventListener(name, callback) {assert.equal(name, 'visibilitychange'); calls.visibility.add(callback);},
    removeEventListener(name, callback) {assert.equal(name, 'visibilitychange'); calls.visibility.delete(callback);},
    createElement(type) {
      assert.equal(type, 'canvas');
      const canvas = {width: pixels.width, height: pixels.height,
        getContext() {return {drawImage(...args) {calls.drawn.push(args);},
          getImageData() {return pixels;}};},
        toBlob(callback, mime, quality) {calls.blobs.push({canvas, callback, mime, quality});
          if (!options.deferBlob) callback({type: mime, size: 500});}};
      return canvas;
    }};
  class FixtureImage {
    width = pixels.width; height = pixels.height;
    naturalWidth = pixels.width; naturalHeight = pixels.height;
    decode() {return options.decode ? options.decode(this) : Promise.resolve();}
  }
  const initialNow=options.now;
  const ClockDate=typeof initialNow==='number'?class extends Date{
    constructor(...args){if(args.length)super(...args);else super(initialNow+currentTime);}
    static now(){return initialNow+currentTime;}
  }:Date;
  const globals = {console, Request, Response, Headers, URLSearchParams, AbortController,
    TextEncoder, TextDecoder, Uint8Array, Uint8ClampedArray, ArrayBuffer, Promise,
    Date:ClockDate, Error, TypeError, Object, Math, Number, crypto:globalThis.crypto,
    FormData:class {constructor(record){this.record=record;}get(key){return this.record[key]??null;}},
    performance: {now: () => currentTime},
    setTimeout: makeTimer, clearTimeout: timer => {if (timer) timer.cancelled = true;},
    requestAnimationFrame: callback => makeTimer(callback, 16), cancelAnimationFrame: timer => {if (timer) timer.cancelled = true;},
    document, navigator: {mediaDevices: {getUserMedia: settings => new Promise((resolve, reject) => calls.cameras.push({options: settings, resolve, reject}))}},
    window: {addEventListener() {}, removeEventListener() {}}, Image: FixtureImage, fetch: requests,
    URL: {createObjectURL(value) {const url = 'blob:qa-' + calls.urls.length; calls.urls.push({url, value}); return url;},
      revokeObjectURL(value) {calls.revoked.push(value);}}};
  const context = vm.createContext({...globals,...options.globals});
  const componentFile = path.join(root, options.componentFile || 'app/scan-comic.tsx');
  if (options.componentLocal) assert.match(options.componentLocal, /^[A-Za-z_$][A-Za-z0-9_$]*$/,
    'QA local component must be an identifier');
  function load(file) {
    const resolved = ['', '.ts', '.tsx', '.js', '/index.ts'].map(suffix => file + suffix).find(existsSync);
    if (!resolved) throw Error('Cannot resolve scanner dependency: ' + file);
    if (resolved.endsWith('.css')) return {};
    if (modules.has(resolved)) return modules.get(resolved).exports;
    const module = {exports: {}}; modules.set(resolved, module);
    const localRequire = specifier => {
      if (specifier === 'react') return hookReact;
      if (specifier === 'react/jsx-runtime') return {jsx, jsxs: jsx, Fragment: 'fragment'};
      if (specifier === 'lucide-react') return new Proxy({}, {get: (_, name) => function Icon() {return jsx(String(name), {});}});
      if (specifier.startsWith('.')) return load(path.resolve(path.dirname(resolved), specifier));
      return require(specifier);
    };
    let code = ts.transpileModule(readFileSync(resolved, 'utf8'), {fileName: resolved,
      compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX}}).outputText;
    // Expose an existing local component only in this controlled test module.
    // No application exports or nested React lifecycle are inferred by the fixture.
    if (resolved === componentFile && options.componentLocal)
      code += '\nmodule.exports.__qaComponent=' + options.componentLocal + ';';
    new vm.Script('(function(exports,require,module){' + code + '\n})', {filename: resolved})
      .runInContext(context)(module.exports, localRequire, module);
    return module.exports;
  }
  const scanner = load(componentFile)[options.componentLocal ? '__qaComponent' : options.componentExport || 'default'];
  const props = {onCollect: value => calls.collected.push(value), onOpen: value => calls.opened.push(value),
    onClose: () => {calls.closed++;}, ...options.props};
  function nodes(node) {
    if (arguments.length === 0) node = tree;
    if (!node || typeof node !== 'object') return [];
    if (Array.isArray(node)) return node.flatMap(nodes);
    return [node, ...nodes(node.props?.children)];
  }
  function text(node) {
    if (node === null || node === undefined || typeof node === 'boolean') return '';
    if (Array.isArray(node)) return node.map(text).join('');
    if (typeof node === 'object') return text(node.props?.children);
    return String(node);
  }
  function render() {
    cursor = 0; dirty = false; tree = scanner(props);
    for (const node of nodes()) if (node.props?.ref) {
      if (node.type === 'video') node.props.ref.current = video;
      else if (node.type === 'dialog'||node.type === 'button') node.props.ref.current = dialog;
      else if (node.type === 'form') node.props.ref.current = options.formElement || {querySelector:()=>null};
      else if (node.type === 'canvas') node.props.ref.current = document.createElement('canvas');
      else if (typeof node.type === 'string') node.props.ref.current = viewport;
    }
    mounted = true;
    return tree;
  }
  async function flush() {
    for (let round = 0; round < 32; round++) {
      if (disposed) {await Promise.resolve(); continue;}
      if (!mounted || dirty) render();
      for (const run of effects.splice(0)) run();
      await Promise.resolve();
    }
    if (dirty && !disposed) render();
  }
  function find(predicate) {return nodes().find(predicate);}
  function button(label) {
    const result = find(node => node.type === 'button' && text(node).includes(label));
    assert.ok(result, 'Actual scanner button missing: ' + label + '; available: ' + nodes().filter(node => node.type === 'button').map(text).join(', '));
    return result;
  }
  function stream() {
    const track = {enabled: true, stops: 0, stop() {this.stops++;}};
    return {track, getTracks: () => [track], getVideoTracks: () => [track]};
  }
  render();
  return {calls, context, nodes, text, button, find, video, props, states, refs, stream, render, flush,
    setProps(values){Object.assign(props,values);dirty=true;},
    commitEffects() {for (const run of effects.splice(0)) run();},
    async waitFor(predicate, label = 'Actual scanner completion') {
      for (let turn = 0; turn < 40; turn++) {
        await flush(); if (predicate()) return;
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      assert.fail(label + ' did not settle; status: ' + this.status());
    },
    setPixels(value) {pixels = value; video.videoWidth = value.width; video.videoHeight = value.height;},
    async click(label) {const result = button(label).props.onClick(); await flush(); return result;},
    async upload(file) {const input = find(node => node.type === 'input' && node.props.type === 'file'); assert.ok(input); const result = input.props.onChange({target: {files: [file], value: 'local-only'}}); await flush(); return result;},
    async advance(milliseconds) {currentTime += milliseconds;
      const due = calls.timers.filter(timer => !timer.cancelled && timer.at <= currentTime);
      for (const timer of due) {timer.cancelled = true; timer.callback(currentTime);} await flush();},
    async visibility(hidden) {document.hidden = hidden; document.visibilityState = hidden ? 'hidden' : 'visible';
      for (const callback of [...calls.visibility]) callback(); await flush();},
    unmount() {for (const slot of slots) slot?.cleanup?.(); effects.length = 0; mounted = false; disposed = true;},
    status() {return nodes().filter(node => ['status','alert'].includes(node.props?.role)).map(text).join(' ');},
    snapshot() {return text(tree);}
  };
}
