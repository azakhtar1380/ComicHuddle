import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';

// Execute the actual TSX handlers with isolated native surfaces. This does not
// simulate layout, browser authentication, persisted web data or a physical device.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const links = [], state = [], modules = new Map();
const refs = [];
let cursor = 0, refCursor = 0, viewport = {width: 390, height: 844}, safeInsets = {top: 0, left: 0, right: 0, bottom: 20}, linkEffect = null, catalogEffect = null, detailEffect = null, initialLink = async () => null, linkListener = null;
const hostedWindow = {location: {origin: 'https://comichuddle.aztooeasy.chatgpt.site'}};
const fetchCalls = [];
let fetchImplementation = async () => {throw new Error('No authenticated native API surface');};
const react = {
  createElement(type, props, ...children) {return {type, props: {...props, children}};},
  Fragment: 'Fragment',
  useState(initial) {
    const index = cursor++;
    if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial;
    return [state[index], value => {state[index] = typeof value === 'function' ? value(state[index]) : value;}];
  },
  useMemo(callback) {return callback();},
  useRef(initial) {const index=refCursor++; if(!(index in refs))refs[index]={current:initial};return refs[index];},
  useEffect(callback,deps) {if(deps?.length===0)linkEffect=callback;if(deps?.length===6)catalogEffect=callback;if(deps?.length===3)detailEffect=callback;},
  useId() {return 'isolated-panel';},
};
const native = Object.fromEntries(['Image', 'Modal', 'Pressable', 'ScrollView', 'Text', 'TextInput', 'View'].map(name => [name, name]));
Object.assign(native, {
  StyleSheet: {create: value => value, absoluteFill: {position: 'absolute', top: 0, left: 0, right: 0, bottom: 0}},
  Linking: {openURL: async url => {links.push(url);},getInitialURL:()=>initialLink(),addEventListener:(_name,callback)=>{linkListener=callback;return{remove:()=>{linkListener=null;}};}},
  useWindowDimensions: () => viewport,
  Platform: {OS: 'ios'},
});
const svg = {__esModule: true, default: 'Svg', Image: 'SvgImage', ...Object.fromEntries(['Circle', 'Defs', 'LinearGradient', 'Path', 'Pattern', 'Rect', 'Stop'].map(name => [name, name]))};
function load(filename) {
  if (modules.has(filename)) return modules.get(filename);
  if (filename.endsWith('.json')) return JSON.parse(fs.readFileSync(filename, 'utf8'));
  const source = fs.readFileSync(filename, 'utf8');
  const compiled = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true}}).outputText;
  const module = {exports: {}};
  modules.set(filename, module.exports);
  const context = {
    module, exports: module.exports,
    require(name) {
      if (name === 'react') return react;
      if (name === 'react-native') return native;
      if (name === 'react-native-svg') return svg;
      if (name === 'react-native-safe-area-context') return {SafeAreaProvider: 'SafeAreaProvider', SafeAreaView: 'SafeAreaView', useSafeAreaInsets: () => safeInsets};
      if (name === 'expo-status-bar') return {StatusBar: 'StatusBar'};
      assert(name.startsWith('.'), 'Unexpected external dependency: ' + name);
      const resolved = path.resolve(path.dirname(filename), name);
      if (/\.(png|jpe?g)$/.test(name)) {assert(fs.existsSync(resolved), 'Missing artwork ' + name); return resolved;}
      const target = [resolved, resolved + '.ts', resolved + '.tsx'].find(candidate => fs.existsSync(candidate));
      assert(target, 'Missing import: ' + name);
      return load(target);
    },
    setTimeout, clearTimeout, URL, URLSearchParams, AbortController, window: hostedWindow,
    fetch: (...args) => {fetchCalls.push(args);return fetchImplementation(...args);},
  };
  // The real AppBody is private; expose it only inside this isolated test runtime.
  vm.runInNewContext(compiled + (filename.endsWith('NativeApp.tsx') ? '\nexports.testBody=AppBody;' : ''), context, {filename});
  return module.exports;
}
const app = load(path.join(root, 'NativeApp.tsx'));
const styles = load(path.join(root, 'app-styles.ts')).styles;
function expand(node) {
  if (node === null || node === undefined || node === false) return null;
  if (Array.isArray(node)) return node.map(expand).filter(value => value !== null);
  if (typeof node !== 'object') return node;
  if (node.type === 'Modal' && !node.props.visible) return null;
  if (typeof node.type === 'function') return expand(node.type(node.props));
  return {type: node.type, props: {...node.props, children: expand(node.props.children)}};
}
function render() {cursor = 0; refCursor = 0; return expand(app.testBody());}
function nodes(tree, predicate) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(node => nodes(node, predicate));
  return [...(predicate(tree) ? [tree] : []), ...nodes(tree.props.children, predicate)];
}
function text(tree) {
  if (tree === null || tree === undefined || tree === false) return '';
  if (Array.isArray(tree)) return tree.map(text).join('');
  if (typeof tree !== 'object') return String(tree);
  return text(tree.props.children);
}
function control(tree, label) {
  const match = nodes(tree, node => node.type === 'Pressable' && (node.props.accessibilityLabel === label || text(node) === label));
  assert.equal(match.length, 1, 'Expected one actionable control: ' + label);
  return match[0];
}
function click(label) {control(render(), label).props.onPress();}
function resolvedStyle(node) {
  const style = typeof node.props.style === 'function' ? node.props.style({pressed: false}) : node.props.style;
  return Object.assign({}, ...[style].flat(Infinity).filter(Boolean));
}
function lastLink(expected) {
  const url = new URL(links.at(-1));
  assert.equal(url.origin, 'https://comichuddle.aztooeasy.chatgpt.site');
  for (const [key, value] of Object.entries({view: 'app', ...expected})) assert.equal(url.searchParams.get(key), String(value), 'Handoff parameter ' + key);
  return url;
}
let passed = 0;
function check(label, test) {test(); passed++; console.log('PASS ' + label);}

check('Exactly six bottom tabs; each changes to one corresponding screen', () => {
  const expected = ['Home', 'Directory', 'Marketplace', 'My Profile', 'Comic Workshop', 'Upcoming'];
  const tabs = nodes(render(), node => node.props.accessibilityRole === 'tab');
  assert.deepEqual(tabs.map(node => node.props.accessibilityLabel), expected);
  assert.equal(nodes(render(), node => node.props.accessibilityLabel === 'Primary app navigation').length, 1);
  for (const tab of expected) {
    click(tab);
    assert.equal(state[0], tab);
    const active = nodes(render(), node => node.props.accessibilityRole === 'tab' && node.props.accessibilityState.selected);
    assert.equal(active.length, 1); assert.equal(active[0].props.accessibilityLabel, tab);
  }
});
check('Scan is a circular center action between three left and three right destination tabs', () => {
  const tree = render(), dock = nodes(tree, node => node.props.accessibilityLabel === 'Primary app navigation')[0];
  const groups = dock.props.children.flat(Infinity).filter(Boolean);
  assert.equal(groups.length, 3);
  assert.equal(groups[0].props.style, styles.dockSide); assert.equal(groups[2].props.style, styles.dockSide);
  assert.deepEqual(nodes(groups[0], node => node.props.accessibilityRole === 'tab').map(node => node.props.accessibilityLabel), ['Home', 'Directory', 'Marketplace']);
  assert.deepEqual(nodes(groups[2], node => node.props.accessibilityRole === 'tab').map(node => node.props.accessibilityLabel), ['My Profile', 'Comic Workshop', 'Upcoming']);
  const scan = control(groups[1], 'Scan a comic'), frame = resolvedStyle(scan);
  assert.equal(scan.props.accessibilityRole, 'button'); assert.equal(scan.props.accessibilityState, undefined);
  assert.equal(frame.width, frame.height); assert.equal(frame.borderRadius, frame.width / 2);
  assert.equal(styles.dockSide.flex, 1); assert.equal(styles.tab.flex, 1);
  const selectedBefore = state[0], linksBefore = links.length;
  render(); assert.equal(links.length, linksBefore, 'Rendering opened the scanner without a press');
  scan.props.onPress(); lastLink({section: 'Scan'});
  assert.equal(state[0], selectedBefore, 'Scan replaced the selected destination tab');
  assert.equal(new URL(links.at(-1)).searchParams.has('autostart'), false);
});
check('Upcoming has exactly three coming-soon cards without active community, guides or matching controls', () => {
  click('Upcoming');
  const copy = text(render());
  assert(copy.includes('FMV coming soon')); assert(copy.includes('Community coming soon')); assert(copy.includes('GrailMatch coming soon'));
  assert.deepEqual(Array.from(app.upcomingFeatures, feature => feature.name), ['FMV', 'Community', 'GrailMatch']);
  const actions = nodes(render(), node => node.type === 'Pressable').map(node => node.props.accessibilityLabel || text(node));
  assert(!actions.some(label => /FMV|Community|GrailMatch|GoCollect|swipe|group/i.test(label)));
});
check('Header account drawer opens My Profile using the exact showcase handoff', () => {
  click('Open account drawer and My Profile');
  click('Open My Profile showcase on website');
  assert.equal(links.at(-1), 'https://comichuddle.aztooeasy.chatgpt.site/?view=app&section=My%20Profile');
  assert.equal(state[4], false);
  assert(!text(render()).includes('Collectors'));
});
check('Home scan, profile and Directory actions use supported destinations', () => {
  click('Home'); click('Open live scanner'); lastLink({section: 'Scan'});
  assert.equal(new URL(links.at(-1)).searchParams.getAll('section').length, 1);
  assert(text(render()).includes('6 vintage covers supported today'));
  assert(text(render()).includes('Start the live camera scanner on the website'));
  click('Explore My Profile'); assert.equal(state[0], 'My Profile');
  click('Open my collector showcase'); lastLink({section: 'My Profile'});
  click('Home');
  click('Explore the comic directory'); assert.equal(state[0], 'Directory');
});
check('My Profile opens the actual showcase and collection and explains city and provider collections', () => {
  click('My Profile');
  const copy = text(render());
  assert(copy.includes('Your city. Your collecting circle.'));
  assert(copy.includes('Providers can keep a personal collection'));
  click('Open my saved comic collection'); lastLink({section: 'Account', accountTab: 'Collection'});
  click('Set up my profile on the website'); lastLink({section: 'My Profile'});
  click('Explore Comic Workshop'); assert.equal(state[0], 'Comic Workshop');
});
check('Legacy Community, FMV and GrailMatch links route to Upcoming and discard dormant actions', () => {
  for (const section of ['Community', 'FMV', 'GrailMatch']) {
    assert.equal(app.resolveNativeSection(section), 'Upcoming');
    assert.equal(app.nativeTabForLink('https://comichuddle.aztooeasy.chatgpt.site/?section=' + section), 'Upcoming');
    const url = new URL(app.websiteLink(section, {communityAction: 'create', postKind: 'discussion'}));
    assert.equal(url.searchParams.get('section'), 'Upcoming');
    assert.equal(url.searchParams.has('communityAction'), false);
  }
  assert.equal(new URL(app.communityLink({communityView: 'discover', group: 'key-hunters'})).searchParams.get('section'), 'Upcoming');
  assert.equal(app.nativeTabForLink('comichuddle://community'), 'Upcoming');
  assert.equal(app.nativeTabForLink('comichuddle:///?section=My%20Profile'), 'My Profile');
  assert.equal(app.nativeTabForLink('https://evil.example/?section=Community'), null);
  assert.equal(app.nativeTabForLink('https://user:pass@comichuddle.aztooeasy.chatgpt.site/?section=Community'), null);
});
check('The uploaded superhero logo stays bounded and vintage images retain source credits', () => {
  click('Home');
  const header = nodes(render(), node => node.type === 'Pressable' && node.props.accessibilityLabel === 'ComicHuddle home')[0];
  const art = nodes(header, node => node.type === 'SvgImage'); assert.equal(art.length, 1);
  assert.equal(art[0].props.href, path.join(root, 'assets/comichuddle-logo.jpeg'));
  const frame = nodes(header, node => node.type === 'Svg')[0]; assert(frame.props.width <= 120 && frame.props.height <= 100);
  const records = JSON.parse(fs.readFileSync(path.join(root, 'data/catalog.json'), 'utf8')).issues;
  const sourceCovers = load(path.join(root, 'covers.ts')).covers;
  for (const record of records) if (sourceCovers[record.id]) {assert(record.coverSource); assert(record.coverCredit);}
});
check('Marketplace actions preserve listing mode; no local illustrative inventory or FMV', () => {
  click('Marketplace');
  for (const [label, sell] of [['Sell a comic', 'single'], ['Sell a collection', 'collection'], ['Start an auction', 'auction']]) {
    click(label); lastLink({section: 'Marketplace', sell});
  }
  assert(!/FMV|EXAMPLE|HISTORICAL CGC/.test(text(render())));
});
check('Comic Workshop preserves studio registration intent', () => {
  click('Comic Workshop'); click('Register my pressing studio');
  lastLink({section: 'Comic Workshop', join: 'provider'});
});
check('Exact issue detail links retain identity, bibliography and bounded original artwork', () => {
  click('Directory'); const issue = JSON.parse(fs.readFileSync(path.join(root, 'data/catalog.json'), 'utf8')).issues[0];
  click('More info about ' + issue.title + ' #' + issue.number);
  const copy = text(render()); assert(copy.includes('Bibliography & cover credits')); assert(!/GoCollect|Raw FMV|Documented CGC sales/.test(copy));
  click('Find copies for sale'); lastLink({section: 'Marketplace', issue: issue.id});
  click('Add to collection on website'); lastLink({section: 'Directory', issue: issue.id});
  const close = nodes(render(), node => node.type === 'Pressable' && node.props.accessibilityLabel === 'Close comic details');
  close[0].props.onPress(); assert.equal(state[3], null);
});
check('Every Directory card contains only cover, title and number, publisher and More info', () => {
  click('Directory');
  const tree = render(), cards = nodes(tree, node => node.type === 'View' && Array.isArray(node.props.style) && node.props.style[0] === styles.card);
  const records = JSON.parse(fs.readFileSync(path.join(root, 'data/catalog.json'), 'utf8')).issues;
  assert.equal(cards.length, records.length);
  for (const [index, card] of cards.entries()) {
    const issue = records[index], copy = text(card);
    assert.equal(copy, issue.title + ' #' + issue.number + issue.publisher + 'More info');
    assert.equal(nodes(card, node => node.type === 'Pressable').length, 1);
    const info = control(card, 'More info about ' + issue.title + ' #' + issue.number);
    assert(resolvedStyle(info).minHeight >= 44);
    assert(!copy.includes(issue.note)); assert(!copy.includes(String(issue.year))); assert(!copy.includes(issue.kind));
  }
  const issue = records[0];click('More info about ' + issue.title + ' #' + issue.number);
  const details = text(render());assert(details.includes('Writer: ' + issue.writer));assert(details.includes('Type: ' + issue.kind));assert(details.includes('Characters: ' + issue.characters.join(', ')));
  nodes(render(), node => node.type === 'Pressable' && node.props.accessibilityLabel === 'Close comic details')[0].props.onPress();
});
check('Five mobile widths retain exactly two compact portrait Directory cards per row with wrapping titles', () => {
  for (const width of [320,360,390,430,760]) {
    viewport={width,height:900};safeInsets={top:0,left:0,right:0,bottom:34};click('Directory');
    const tree=render(),gallery=nodes(tree,node=>node.type==='View'&&node.props.style===styles.grid);
    assert.equal(gallery.length,1);
    const grid=resolvedStyle(gallery[0]),cards=nodes(gallery[0],node=>node.type==='View'&&Array.isArray(node.props.style)&&node.props.style[0]===styles.card);
    const pageWidth=Math.min(width,styles.content.maxWidth),gridWidth=Math.min(pageWidth-2*styles.content.paddingHorizontal,grid.maxWidth);
    assert.equal(grid.width,'100%');assert.equal(grid.alignSelf,'center');assert.equal(grid.flexDirection,'row');assert.equal(grid.flexWrap,'wrap');
    for (const card of cards) {
      const frame=resolvedStyle(card),cardWidth=gridWidth*parseFloat(frame.width)/100;
      assert.equal(frame.flexGrow,0);assert.equal(frame.flexShrink,0);assert(cardWidth<=211,'A card stretched into a wide panel');
      assert(cardWidth*2<=gridWidth&&cardWidth*3>gridWidth,'The gallery cannot fit exactly two cards per row');
      const art=nodes(card,node=>node.type==='View'&&Array.isArray(node.props.style)&&node.props.style[0]===styles.art)[0],cover=resolvedStyle(art);
      assert(cover.width<=Math.ceil(cardWidth-2*(frame.padding+frame.borderWidth)),'Cover overflows a compact card');
      assert(cover.height>cover.width);assert(cover.height<=251);assert(Math.abs(cover.width/cover.height-.74)<.01);
      const title=nodes(card,node=>node.type==='Text'&&node.props.style===styles.cardTitle)[0];
      assert.equal(title.props.numberOfLines,undefined,'A long title is truncated instead of wrapping');assert.equal(resolvedStyle(title).width,'100%');assert.equal(resolvedStyle(title).minWidth,0);
      const body=nodes(card,node=>node.type==='View'&&node.props.style===styles.cardBody)[0],info=nodes(card,node=>node.type==='Pressable')[0];
      const minHeight=2*(frame.padding+frame.borderWidth)+cover.height+styles.cardBody.paddingTop+styles.cardBody.padding+styles.cardTitle.minHeight+2*styles.cardTitle.marginVertical+styles.meta.lineHeight+resolvedStyle(info).minHeight+resolvedStyle(info).marginTop;
      assert(minHeight>cardWidth,'A card became landscape shaped');assert(cardWidth-2*(frame.padding+frame.borderWidth)-2*resolvedStyle(body).padding>=44,'More info lost its 44px touch width');
    }
    control(gallery[0],'More info about Amazing Spider-Man #300').props.onPress();assert.equal(state[3].id,0);
    nodes(render(),node=>node.type==='Pressable'&&node.props.accessibilityLabel==='Close comic details')[0].props.onPress();
  }
});
check('Native full directory uses the real website handoff and labels snapshot coverage', () => {
  click('Directory');
  const copy = text(render()); assert(copy.includes('This app snapshot contains 43 records'));assert(copy.includes('current GCD imports'));
  click('Browse full directory on website');lastLink({section:'Directory'});
  assert.equal(new URL(links.at(-1)).searchParams.has('token'),false);
  assert.equal(nodes(render(), node => node.props.accessibilityLabel === 'Next directory page').length,0);
  const requestsBefore = fetchCalls.length, stop = catalogEffect();assert.equal(stop,undefined);assert.equal(fetchCalls.length,requestsBefore);
  const locationBefore=hostedWindow.location;hostedWindow.location=undefined;render();assert.equal(catalogEffect(),undefined);assert.equal(fetchCalls.length,requestsBefore);hostedWindow.location=locationBefore;
});
check('Shared catalog requests are origin gated, paginated and preserve exact GCD identities without importing covers', () => {
  assert.equal(app.canLoadSharedDirectory('web',hostedWindow.location.origin),true);
  for (const [platform,origin] of [['ios',hostedWindow.location.origin],['android',hostedWindow.location.origin],['web','https://evil.example'],['web',undefined]]) assert.equal(app.canLoadSharedDirectory(platform,origin),false);
  const url = new URL(app.sharedDirectoryRequest('  Amazing Spider-Man #300  ','Marvel & friends',12),hostedWindow.location.origin);
  assert.equal(url.pathname,'/api/catalog');assert.equal(url.searchParams.get('q'),'Amazing Spider-Man #300');assert.equal(url.searchParams.get('publisher'),'Marvel & friends');assert.equal(url.searchParams.get('limit'),'12');assert.equal(url.searchParams.get('offset'),'12');
  const record = JSON.parse(fs.readFileSync(path.join(root,'data/catalog.json'),'utf8')).issues[0];
  const fixture = {issues:[{...record,id:4000000045,gcdId:45,cover:'https://unlicensed.example/cover.jpg'}],total:1,issueCount:100,gcdIssueCount:57,syncedIssueCount:0,offset:0,hasMore:false,publishers:['Marvel']};
  const parsed = app.parseSharedDirectory(fixture,0);assert.equal(parsed.issues[0].id,4000000045);assert.equal(parsed.issues[0].gcdId,45);assert.equal(parsed.issues[0].cover,undefined);assert.equal(app.authorizedCover(parsed.issues[0]),undefined);
  assert.equal(new URL(app.websiteLink('Directory',{issue:parsed.issues[0].id})).searchParams.get('issue'),'4000000045');
  assert.throws(()=>app.parseSharedDirectory({...fixture,offset:12},0));assert.throws(()=>app.parseSharedDirectory({...fixture,issues:Array(13).fill(record)},0));assert.throws(()=>app.parseSharedDirectory({...fixture,issues:[{...record,id:'bad'}]},0));
  assert.equal(app.authorizedCover({...record,id:24}),undefined,'A colliding ID reused another issue’s cover');
});
check('Multiword issue searches tolerate punctuation without assigning new catalog IDs', () => {
  const input = nodes(render(), node => node.type === 'TextInput' && node.props.accessibilityLabel === 'Search comic directory')[0];
  input.props.onChangeText('  Amazing Spider-Man #300  ');
  const found = nodes(render(), node => node.type === 'Pressable' && /^More info about .+ #/.test(node.props.accessibilityLabel || ''));
  assert.equal(found.length, 1); assert.equal(found[0].props.accessibilityLabel, 'More info about Amazing Spider-Man #300');
  input.props.onChangeText('');
});
check('Handoffs encode values and cannot overwrite section or app mode', () => {
  const url = new URL(app.websiteLink('Directory', {group: 'space & punctuation', section: 'FMV', view: 'desktop', omitted: undefined}));
  assert.equal(url.searchParams.get('group'), 'space & punctuation'); assert.equal(url.searchParams.get('section'), 'Directory');
  assert.equal(url.searchParams.get('view'), 'app'); assert.equal(url.searchParams.has('omitted'), false);
  assert.equal(url.searchParams.getAll('section').length, 1);
});
check('Seven viewports retain centered Scan, 44px destination targets, bottom safe area and proportional covers', () => {
  for (const [width, height] of [[320, 568], [375, 667], [390, 844], [430, 932], [768, 1024], [1024, 768], [844, 390]]) {
    viewport = {width, height};
    safeInsets = {top: 0, left: height < width ? 47 : 0, right: height < width ? 47 : 0, bottom: width === 320 ? 0 : 34};
    assert(styles.tab.minHeight >= 44); assert(styles.headerButton.width >= 44); assert(styles.close.height >= 44);
    for (const tab of app.bottomTabs) {
      click(tab);
      const tree = render(), docks = nodes(tree, node => node.props.accessibilityLabel === 'Primary app navigation');
      assert.equal(docks.length, 1); assert.equal(nodes(tree, node => node.props.accessibilityRole === 'tab').length, 6);
      const dock = resolvedStyle(docks[0]), scan = resolvedStyle(control(docks[0], 'Scan a comic'));
      assert.equal(dock.bottom, safeInsets.bottom + 12);
      assert(dock.width <= width - safeInsets.left - safeInsets.right);
      const edge = dock.paddingHorizontal + dock.borderWidth, sideWidth = (dock.width - 2 * edge - scan.width) / 2;
      assert(sideWidth / 3 >= 44); assert(scan.width >= 44 && scan.height >= 44);
      assert.equal(edge + sideWidth + scan.width / 2, dock.width / 2, 'Scan drifted from the rail center');
      if (width === 320) {assert.equal(scan.width, 48); assert.equal(sideWidth / 3, 44);}
      const frames = nodes(tree, node => node.type === 'View' && Array.isArray(node.props.style) && node.props.style[0] === styles.art);
      for (const frame of frames) {
        const size = frame.props.style[1];
        assert(size.width <= width - 40); assert(size.height <= 251); assert(Math.abs(size.width / size.height - .74) < .01);
      }
    }
  }
});
await (async () => {
  click('Home'); let resolve;
  initialLink=()=>new Promise(done=>resolve=done);
  render(); const cleanup=linkEffect();
  click('Directory');
  resolve('comichuddle://community'); await Promise.resolve(); await Promise.resolve();
  assert.equal(state[0],'Directory','A late startup link overrode the collector’s chosen tab');
  linkListener({url:'comichuddle://community'});assert.equal(state[0],'Upcoming');
  cleanup();assert.equal(linkListener,null);
  click('Home'); let resolveAfterUnmount;
  initialLink=()=>new Promise(done=>resolveAfterUnmount=done);
  render(); const unmount=linkEffect();unmount();resolveAfterUnmount('comichuddle://community');await Promise.resolve();await Promise.resolve();assert.equal(state[0],'Home');
  passed++;console.log('PASS Delayed startup links and unmounted callbacks cannot replace the chosen screen');
  click('Home'); let resolveScan;
  initialLink=()=>new Promise(done=>resolveScan=done);
  render(); const stopScanLink=linkEffect(), beforeScanLinks=links.length;
  click('Scan a comic'); lastLink({section:'Scan'});
  assert.equal(links.length,beforeScanLinks+1);
  resolveScan('comichuddle://community');await Promise.resolve();await Promise.resolve();assert.equal(state[0],'Home','A late startup link replaced the scanner launch');
  const beforeIncomingScan=links.length;linkListener({url:'comichuddle://Scan'});assert.equal(links.length,beforeIncomingScan,'A Scan deep link opened the camera handoff without a press');
  assert.equal(app.nativeTabForLink('comichuddle://Scan'),'Home');stopScanLink();
  passed++;console.log('PASS Scan launches only on explicit press and defeats late startup navigation');
})();
await (async () => {
  // Response fixtures verify the actual web-preview request and state handlers;
  // they are not hosted GCD coverage or authenticated browser evidence.
  native.Platform.OS='web';click('Directory');render();
  const records=JSON.parse(fs.readFileSync(path.join(root,'data/catalog.json'),'utf8')).issues;
  fetchImplementation=async (request,options)=>{
    assert(request.startsWith('/api/catalog?'));assert.equal(options.credentials,'same-origin');assert.equal(options.mode,'same-origin');assert.equal(options.cache,'no-store');assert(options.signal instanceof AbortSignal);assert.equal(options.headers,undefined);
    const url=new URL(request,hostedWindow.location.origin),offset=Number(url.searchParams.get('offset')),search=url.searchParams.get('q'),publisher=url.searchParams.get('publisher');
    if(url.searchParams.has('id'))return new Response(JSON.stringify({issues:[{...records.find(record=>record.id===Number(url.searchParams.get('id'))),bibliography:{publicationDate:'March 1988',originalCoverPrice:{kind:'ORIGINAL_COVER_PRICE',text:'$1.50'},pageCount:48,isbn:'fixture-isbn',seriesProviderId:123,indiciaFrequency:'Monthly',stories:[{title:'Bibliography fixture',script:'Fixture writer',pageCount:40,sequenceNumber:0,jobNumber:'Fixture job',genre:'Adventure',firstLine:'Fixture first line',keywords:'Fixture keyword'}]}}],total:1,issueCount:43,gcdIssueCount:19,syncedIssueCount:0,offset:0,hasMore:false,publishers:['Marvel','DC','Image']}),{headers:{'Content-Type':'application/json'}});
    const matches=search||publisher?[records[0]]:offset?records.slice(12,24):records.slice(0,12);
    return new Response(JSON.stringify({issues:matches,total:search||publisher?1:43,issueCount:43,gcdIssueCount:19,syncedIssueCount:0,offset,hasMore:!search&&!publisher&&offset<36,publishers:['Marvel','DC','Image']}),{headers:{'Content-Type':'application/json'}});
  };
  let stop=catalogEffect();assert(text(render()).includes('Loading the shared directory'));await new Promise(done=>setTimeout(done,30));
  assert.equal(state[7],false);assert.equal(state[6].issues.length,12);assert(text(render()).includes('43 matching issue records'));assert(text(render()).includes('including 19 GCD records'));
  click('Next directory page');stop();render();stop=catalogEffect();await new Promise(done=>setTimeout(done,30));assert.equal(state[9],12);assert.equal(state[6].issues[0].id,records[12].id);assert(text(render()).includes('Page 2'));
  click('Previous directory page');stop();render();stop=catalogEffect();await new Promise(done=>setTimeout(done,30));assert.equal(state[9],0);
  const input=nodes(render(),node=>node.type==='TextInput'&&node.props.accessibilityLabel==='Search comic directory')[0];input.props.onChangeText('Amazing Spider-Man #300');stop();render();stop=catalogEffect();await new Promise(done=>setTimeout(done,280));
  assert.equal(state[6].total,1);assert.equal(state[6].issues[0].id,0);assert.equal(control(render(),'Next directory page').props.disabled,true);
  click('More info about Amazing Spider-Man #300');render();const stopDetails=detailEffect();assert(text(render()).includes('Loading the full issue bibliography'));await new Promise(done=>setTimeout(done,30));
  const detailUrl=new URL(fetchCalls.at(-1)[0],hostedWindow.location.origin);assert.equal(detailUrl.searchParams.get('id'),'0');assert.equal(state[3].id,0);assert.equal(state[11],false);const detailCopy=text(render());assert(detailCopy.includes('Original cover price: $1.50 · printed publication price'));assert(detailCopy.includes('Publication date: March 1988'));assert(detailCopy.includes('Bibliography fixture'));assert(detailCopy.includes('Writer: Fixture writer'));assert(detailCopy.includes('Sequence: 0'));assert(detailCopy.includes('Job number: Fixture job'));assert(detailCopy.includes('Keywords: Fixture keyword'));assert(detailCopy.includes('GCD series ID: 123'));assert(detailCopy.includes('Indicia frequency: Monthly'));
  click('Add to collection on website');lastLink({section:'Directory',issue:0});click('Open full issue on website');lastLink({section:'Directory',issue:0});stopDetails();
  nodes(render(),node=>node.type==='Pressable'&&node.props.accessibilityLabel==='Close comic details')[0].props.onPress();
  click('Marvel');stop();render();stop=catalogEffect();await new Promise(done=>setTimeout(done,280));assert.equal(new URL(fetchCalls.at(-1)[0],hostedWindow.location.origin).searchParams.get('publisher'),'Marvel');assert.equal(state[9],0);
  stop();passed++;console.log('PASS Hosted preview loads shared pages, searches and publisher filters using same-origin cookies only');
  passed++;console.log('PASS More info loads exact issue bibliography and labels original cover price as publication data');
  click('Home');click('Directory');render();
  let settle;fetchImplementation=async()=>new Promise(done=>{settle=done;});stop=catalogEffect();await new Promise(done=>setTimeout(done,30));const requestSignal=fetchCalls.at(-1)[1].signal;
  stop();assert.equal(requestSignal.aborted,true);const pageBefore=state[6];
  settle(new Response(JSON.stringify({issues:[records[2]],total:1,issueCount:43,gcdIssueCount:19,syncedIssueCount:0,offset:0,hasMore:false,publishers:['Image']}),{headers:{'Content-Type':'application/json'}}));await new Promise(done=>setTimeout(done,10));assert.equal(state[6],pageBefore,'A canceled directory response replaced the current page');
  fetchImplementation=async()=>new Response('Sign in',{status:401,headers:{'Content-Type':'text/html'}});render();stop=catalogEffect();await new Promise(done=>setTimeout(done,30));assert(text(render()).includes('The shared directory could not load'));
  assert.equal(nodes(render(),node=>node.type==='View'&&Array.isArray(node.props.style)&&node.props.style[0]===styles.card).length,0,'Failed live loading silently fell back to the snapshot');
  click('Browse full directory on website');lastLink({section:'Directory'});const retryBefore=state[10];click('Try directory again');assert.equal(state[10],retryBefore+1);stop();
  native.Platform.OS='ios';click('Home');click('Directory');state[7]=false;state[8]='';render();
  hostedWindow.location.origin='https://evil.example';native.Platform.OS='web';render();const callsBefore=fetchCalls.length;assert.equal(catalogEffect(),undefined);assert.equal(fetchCalls.length,callsBefore);native.Platform.OS='ios';hostedWindow.location.origin='https://comichuddle.aztooeasy.chatgpt.site';
  passed++;console.log('PASS Canceled, unauthenticated and cross-origin loads cannot overwrite results or silently display a live snapshot');
})();
assert(links.every(link => !/[?&]section=(FMV|GrailMatch)(?:&|$)/.test(link)));
console.log(`Native handler checks: ${passed} groups passed; browser/device/persistence journeys remain unverified.`);
