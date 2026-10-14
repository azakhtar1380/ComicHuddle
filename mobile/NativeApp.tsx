import React, {useEffect, useMemo, useRef, useState} from 'react';
import {Image, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions} from 'react-native';
import {SafeAreaProvider, SafeAreaView, useSafeAreaInsets} from 'react-native-safe-area-context';
import Svg, {Circle, Path, Image as SvgImage} from 'react-native-svg';
import {StatusBar} from 'expo-status-bar';
import snapshot from './data/catalog.json';
import {covers} from './covers';
import {Atmosphere, color as C, Icon, type IconName} from './app-design';
import {styles as s} from './app-styles';
import {coverFrame, dockFrame, type ArtVariant} from './art-layout';

type Issue = {
  id: number; title: string; number: string; publisher: string; year: number; era: string;
  note: string; writer: string; artist: string; characters: string[]; kind: string;
  variant: string; source: string; dataCredit?: string; dataLicense?: string;
  coverCredit?: string; coverSource?: string; coverArtist?: string; gcdId?: number; metronId?: number; bibliography?: Record<string, unknown>;
};
type SharedCatalog = {issues: Issue[]; total: number; issueCount: number; gcdIssueCount: number; syncedIssueCount: number; offset: number; hasMore: boolean; publishers: string[]};
type CatalogPage = SharedCatalog & {query: string; publisher: string};
export const bottomTabs = ['Home', 'Directory', 'Marketplace', 'My Profile', 'Comic Workshop', 'Upcoming'] as const;
type Tab = typeof bottomTabs[number];
type WebSection = 'Directory' | 'Marketplace' | 'Community' | 'FMV' | 'GrailMatch' | 'Upcoming' | 'Scan' | 'Comic Workshop' | 'My Profile' | 'Account' | 'Messages';
type CommunityView = 'feed' | 'discover' | 'groups';
type PostKind = 'discussion' | 'question' | 'showcase' | 'find';
type CommunityIntent = {communityView: CommunityView; communityAction?: 'create' | 'compose'; postKind?: PostKind; group?: string};
const {issues, asOf} = snapshot as {issues: Issue[]; asOf: string};
const SITE = 'https://comichuddle.aztooeasy.chatgpt.site';
const PAGE_SIZE = 12;
const tabIcons: Record<Exclude<Tab, 'Upcoming'>, IconName> = {
  Home: 'Home', Directory: 'Directory', Marketplace: 'Marketplace', 'My Profile': 'User', 'Comic Workshop': 'Pressing',
};

export function resolveNativeSection(value: unknown): Tab {
  if (typeof value !== 'string') return 'Home';
  const key = value.trim().toLowerCase().replace(/[\s_-]+/g, '');
  if (['fmv', 'community', 'grailmatch', 'swapfinder'].includes(key)) return 'Upcoming';
  if (['myprofile', 'profile', 'collectors', 'account', 'mycollection', 'collection'].includes(key)) return 'My Profile';
  if (['comicworkshop', 'pressing', 'workshop'].includes(key)) return 'Comic Workshop';
  return ({home: 'Home', directory: 'Directory', marketplace: 'Marketplace', upcoming: 'Upcoming'} as Record<string, Tab>)[key] || 'Home';
}
export function nativeTabForLink(value: string): Tab | null {
  try {
    const url = new URL(value);
    if (url.username || url.password) return null;
    if (url.protocol === 'comichuddle:') return resolveNativeSection(url.searchParams.get('section') || decodeURIComponent(url.hostname || url.pathname.replace(/^\/+/, '')));
    if (url.origin !== SITE || url.username || url.password) return null;
    const section = url.searchParams.get('section');
    return section ? resolveNativeSection(section) : null;
  } catch {return null;}
}

// Account actions open the shared website; the app never simulates saved account activity.
export function websiteLink(section: WebSection, params: Record<string, string | number | undefined> = {}) {
  const deferred = ['Community', 'FMV', 'GrailMatch'].includes(section), target = deferred ? 'Upcoming' : section;
  const query = [...Object.entries({view: 'app', section: target}), ...Object.entries(deferred ? {} : params).filter(([key]) => key !== 'view' && key !== 'section')]
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => encodeURIComponent(key) + '=' + encodeURIComponent(String(value)))
    .join('&');
  return SITE + '/?' + query;
}
export function communityLink(intent: CommunityIntent) {
  void intent;
  return websiteLink('Upcoming');
}
export const upcomingFeatures = [
  {name: 'FMV', icon: 'FMV' as IconName, tone: 'mint' as const, description: 'An issue and grade-specific value guide with sources and clear data coverage. Current values need permission-cleared sales data.', boundary: 'NO LIVE VALUE GUIDE'},
  {name: 'Community', icon: 'Community' as IconName, tone: 'gold' as const, description: 'A future home for collector groups, shared longboxes, questions and conversations around the stories you love.', boundary: 'NO ACTIVE GROUPS OR POSTING'},
  {name: 'GrailMatch', icon: 'GrailMatch' as IconName, tone: 'peach' as const, description: 'A future way to swipe through wanted comics and discover collectors with a reciprocal trade.', boundary: 'NO ACTIVE SWIPING OR MATCHES'},
];
export function normalizedWords(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
}
export function canLoadSharedDirectory(platform: string, origin: unknown) {
  return platform === 'web' && origin === SITE;
}
export function sharedDirectoryRequest(query: string, publisher: string, offset: number) {
  const params = new URLSearchParams({limit: String(PAGE_SIZE), offset: String(offset), sort: 'featured'});
  if (query.trim()) params.set('q', query.trim());
  if (publisher !== 'All') params.set('publisher', publisher);
  return '/api/catalog?' + params.toString();
}
export function parseSharedDirectory(value: unknown, offset: number): SharedCatalog {
  if (!value || typeof value !== 'object') throw new Error('Invalid directory response');
  const page = value as Record<string, unknown>, count = (key: string) => {
    const value = page[key];
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('Invalid directory count');
    return value;
  };
  if (!Array.isArray(page.issues) || page.issues.length > PAGE_SIZE || page.offset !== offset || typeof page.hasMore !== 'boolean') throw new Error('Invalid directory page');
  const text = (value: unknown) => typeof value === 'string' ? value : '';
  const records = page.issues.map(value => {
    if (!value || typeof value !== 'object') throw new Error('Invalid issue record');
    const item = value as Record<string, unknown>;
    if (typeof item.id !== 'number' || !Number.isSafeInteger(item.id) || item.id < 0 || !text(item.title) || !text(item.number) || !text(item.publisher)) throw new Error('Invalid issue identity');
    return {
      id: item.id, title: text(item.title), number: text(item.number), publisher: text(item.publisher),
      year: typeof item.year === 'number' && Number.isInteger(item.year) ? item.year : 0,
      era: text(item.era), note: text(item.note), writer: text(item.writer), artist: text(item.artist),
      characters: Array.isArray(item.characters) ? item.characters.filter((value): value is string => typeof value === 'string') : [],
      kind: text(item.kind), variant: text(item.variant), source: text(item.source),
      coverArtist: text(item.coverArtist), coverCredit: text(item.coverCredit), coverSource: text(item.coverSource),
      dataCredit: text(item.dataCredit), dataLicense: text(item.dataLicense),
      gcdId: typeof item.gcdId === 'number' ? item.gcdId : undefined, metronId: typeof item.metronId === 'number' ? item.metronId : undefined,
      bibliography: item.bibliography && typeof item.bibliography === 'object' && !Array.isArray(item.bibliography) ? item.bibliography as Record<string, unknown> : undefined,
    };
  });
  return {issues: records, total: count('total'), issueCount: count('issueCount'), gcdIssueCount: count('gcdIssueCount'), syncedIssueCount: count('syncedIssueCount'), offset, hasMore: page.hasMore,
    publishers: Array.isArray(page.publishers) ? page.publishers.filter((value): value is string => typeof value === 'string' && !!value) : []};
}
async function fetchSharedDirectory(request: string, offset: number, signal: AbortSignal) {
  const response = await fetch(request, {credentials: 'same-origin', mode: 'same-origin', cache: 'no-store', signal});
  if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw new Error('Directory is unavailable');
  const body = await response.text();
  if (body.length > 2000000) throw new Error('Directory response is too large');
  return parseSharedDirectory(JSON.parse(body), offset);
}
export function authorizedCover(issue: Issue) {
  const original = issues.find(item => item.id === issue.id);
  return original && original.title === issue.title && original.number === issue.number && original.publisher === issue.publisher ? covers[issue.id] : undefined;
}
function bibliographyValue(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(bibliographyValue).filter(Boolean).join(', ');
  if (value && typeof value === 'object') {
    const item = value as Record<string, unknown>;
    return bibliographyValue(item.name || item.title || item.text || item.id);
  }
  return '';
}
function Bibliography({value}: {value?: Record<string, unknown>}) {
  if (!value) return null;
  const fields = [['Issue title', 'issueTitle'], ['Publication date', 'publicationDate'], ['Key date', 'keyDate'], ['On-sale date', 'onSaleDate'], ['Pages', 'pageCount'], ['ISBN', 'isbn'], ['Barcode', 'barcode'], ['Volume', 'volume'], ['GCD series ID', 'seriesProviderId'], ['Variant of', 'variantOf'], ['Indicia publisher', 'indiciaPublisher'], ['Indicia frequency', 'indiciaFrequency'], ['Indicia printer', 'indiciaPrinter'], ['Brand emblem', 'brandEmblem'], ['Rating', 'rating'], ['Editing', 'editing'], ['Keywords', 'keywords']];
  const price = value.originalCoverPrice && typeof value.originalCoverPrice === 'object' ? value.originalCoverPrice as Record<string, unknown> : null;
  const stories = Array.isArray(value.stories) ? value.stories.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object') : [];
  const storyFields = [['Feature', 'feature'], ['Type', 'type'], ['Sequence', 'sequenceNumber'], ['Pages', 'pageCount'], ['Writer', 'script'], ['Pencils', 'pencils'], ['Inks', 'inks'], ['Colors', 'colors'], ['Letters', 'letters'], ['Editing', 'editing'], ['Job number', 'jobNumber'], ['Genre', 'genre'], ['First line', 'firstLine'], ['Characters', 'characters'], ['Synopsis', 'synopsis'], ['Notes', 'notes'], ['Keywords', 'keywords']];
  return <>
    <Text style={s.sectionTitle}>Issue bibliography</Text><View style={s.recordFields}>
      {fields.map(([label, key]) => bibliographyValue(value[key]) ? <Text key={key} style={s.small}>{label}: {bibliographyValue(value[key])}</Text> : null)}
      {price?.kind === 'ORIGINAL_COVER_PRICE' && bibliographyValue(price.text) && <Text style={s.small}>Original cover price: {bibliographyValue(price.text)} · printed publication price</Text>}
    </View>
    {!!stories.length && <><Text style={s.sectionTitle}>Stories & credits</Text>{stories.map((story, index) => <View key={index} style={s.recordFields}><Text style={s.rowTitle}>{bibliographyValue(story.title) || 'Story ' + (index + 1)}</Text>{storyFields.map(([label, key]) => bibliographyValue(story[key]) ? <Text key={key} style={s.small}>{label}: {bibliographyValue(story[key])}</Text> : null)}</View>)}</>}
  </>;
}

function Action({label, onPress, light = false, role = 'button'}: {label: string; onPress: () => void; light?: boolean; role?: 'button' | 'link'}) {
  return <Pressable accessibilityRole={role} onPress={onPress} style={({pressed}) => [s.action, light && s.actionLight, pressed && s.pressed]}>
    <Text style={[s.actionText, {flexShrink: 1}, light && {color: C.ink}]}>{label}</Text>
    <Icon name="Arrow" size={17} tint={light ? C.ink : C.white}/>
  </Pressable>;
}
function UpcomingIcon({tint = C.ink, size = 22}: {tint?: string; size?: number}) {
  return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Circle cx={12} cy={12} r={9} stroke={tint} strokeWidth={1.8}/>
    <Path d="M12 7v5l3 2" stroke={tint} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"/>
  </Svg>;
}
function Art({issue, variant = 'grid', simple = false}: {issue: Issue; variant?: ArtVariant; simple?: boolean}) {
  const viewport = useWindowDimensions(), frame = coverFrame(variant, viewport.width, viewport.height), compact = frame.width < 120;
  const cover = authorizedCover(issue);
  const tones: Record<string, string> = {Marvel: C.peach, DC: C.blue, Image: C.lilacLight, Mirage: C.mint};
  return <View style={[s.art, frame, !cover && {backgroundColor: tones[issue.publisher] || C.lilacLight}]}>
    {cover
      ? <Image source={cover} accessibilityLabel={issue.title + ' #' + issue.number + ' vintage cover'} resizeMode="contain" style={s.artImage}/>
      : simple
        ? <View style={[s.artImage, s.noCoverArt]} accessibilityLabel="No authorized cover image"><Icon name="Directory" size={32} tint={C.muted}/></View>
        : variant === 'thumbnail'
        ? <View style={[s.artImage, s.thumbnailArt]} accessibilityLabel={issue.title + ' #' + issue.number + ' issue record'}><Text numberOfLines={1} adjustsFontSizeToFit style={s.thumbnailNumber}>#{issue.number}</Text></View>
        : <View style={[s.artImage, s.metadataArt, compact && s.compactArt]}>
          <View style={s.coverOrb}/><View style={s.coverLines}/>
          <View style={s.artTop}><Text style={s.artMicro}>{issue.publisher.toUpperCase()}</Text><Text style={s.artMicro}>{issue.year}</Text></View>
          <Text numberOfLines={compact ? 2 : 3} style={[s.artTitle, compact && s.miniArtTitle]}>{issue.title}</Text>
          <Text style={[s.artNumber, compact && s.miniArtNumber]}>#{issue.number}</Text><Text style={s.artMicro}>ISSUE RECORD</Text>
        </View>}
  </View>;
}

function AppBody() {
  const insets = useSafeAreaInsets();
  const viewport = useWindowDimensions(), dock = dockFrame(viewport.width, insets.left + insets.right);
  const [screen, setScreen] = useState<Tab>('Home');
  const [query, setQuery] = useState(''), [publisher, setPublisher] = useState('All');
  const [selected, setSelected] = useState<Issue | null>(null), [more, setMore] = useState(false), [toast, setToast] = useState('');
  const [sharedCatalog, setSharedCatalog] = useState<CatalogPage | null>(null), [catalogLoading, setCatalogLoading] = useState(false), [catalogError, setCatalogError] = useState('');
  const [catalogOffset, setCatalogOffset] = useState(0), [catalogAttempt, setCatalogAttempt] = useState(0);
  const [detailLoading, setDetailLoading] = useState(false), [detailError, setDetailError] = useState(''), [detailAttempt, setDetailAttempt] = useState(0);
  const sharedDirectory = canLoadSharedDirectory(Platform.OS, typeof window === 'undefined' ? undefined : window.location?.origin);
  const navigationVersion = useRef(0);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 7000);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    let mounted = true; const version = navigationVersion.current;
    function incoming(url: string) {const next = nativeTabForLink(url); if (mounted && next) go(next);}
    void Linking.getInitialURL().then(url => {if (url && navigationVersion.current === version) incoming(url);}).catch(() => undefined);
    const subscription = Linking.addEventListener('url', event => incoming(event.url));
    return () => {mounted = false; subscription.remove();};
  }, []);
  useEffect(() => {
    if (!sharedDirectory || screen !== 'Directory') return;
    let current = true;
    const controller = new AbortController();
    setCatalogLoading(true); setCatalogError('');
    let deadline: ReturnType<typeof setTimeout>;
    const debounce = setTimeout(() => {
      deadline = setTimeout(() => controller.abort(), 10000);
      void fetchSharedDirectory(sharedDirectoryRequest(query, publisher, catalogOffset), catalogOffset, controller.signal)
        .then(page => {if (current) setSharedCatalog({...page, query, publisher});})
        .catch(() => {if (current) setCatalogError('The shared directory could not load. Try again or open the website to continue.');})
        .finally(() => {clearTimeout(deadline); if (current) setCatalogLoading(false);});
    }, query ? 250 : 0);
    return () => {current = false; clearTimeout(debounce); clearTimeout(deadline); controller.abort();};
  }, [sharedDirectory, screen, query, publisher, catalogOffset, catalogAttempt]);
  useEffect(() => {
    if (!sharedDirectory || !selected) return;
    let current = true;
    const controller = new AbortController(), id = selected.id;
    setDetailLoading(true); setDetailError('');
    const deadline = setTimeout(() => controller.abort(), 10000);
    void fetchSharedDirectory('/api/catalog?id=' + encodeURIComponent(String(id)), 0, controller.signal)
      .then(page => {
        if (page.issues.length !== 1 || page.issues[0].id !== id) throw new Error('The exact issue was not returned');
        if (current) setSelected(page.issues[0]);
      })
      .catch(() => {if (current) setDetailError('The full bibliography could not load. Try again or open this issue on the website.');})
      .finally(() => {clearTimeout(deadline); if (current) setDetailLoading(false);});
    return () => {current = false; clearTimeout(deadline); controller.abort();};
  }, [sharedDirectory, selected?.id, detailAttempt]);
  const filtered = useMemo(() => {
    const words = normalizedWords(query);
    return issues.filter(issue => {
      if (publisher !== 'All' && issue.publisher !== publisher) return false;
      const record = normalizedWords([issue.title, issue.number, issue.publisher, issue.year, issue.writer, issue.artist, issue.note, ...issue.characters].join(' ')).join(' ');
      return words.every(word => record.includes(word));
    });
  }, [query, publisher]);
  const currentCatalog = sharedCatalog && sharedCatalog.query === query && sharedCatalog.publisher === publisher && sharedCatalog.offset === catalogOffset ? sharedCatalog : null;
  const directoryIssues = sharedDirectory ? currentCatalog?.issues || [] : filtered;
  function go(next: Tab) {navigationVersion.current++; setScreen(next); setQuery(''); setPublisher('All'); setCatalogOffset(0); setSelected(null); setMore(false);}
  function external(url: string) {navigationVersion.current++; void Linking.openURL(url).catch(() => setToast('The browser did not open. Please try again.'));}
  function web(section: WebSection, params: Record<string, string | number | undefined> = {}) {external(websiteLink(section, params));}
  function account(section: 'My Profile' | 'Account' | 'Messages', params: Record<string, string> = {}) {setMore(false); web(section, params);}
  function tabControl(tab: Tab) {
    return <Pressable key={tab} accessibilityRole="tab" accessibilityLabel={tab} accessibilityState={{selected: screen === tab}} onPress={() => go(tab)} style={({pressed}) => [s.tab, pressed && s.pressed]}>
      <View style={[s.tabIcon, screen === tab && s.activeTab]}>{tab === 'Upcoming' ? <UpcomingIcon tint={screen === tab ? C.ink : C.muted}/> : <Icon name={tabIcons[tab]} size={22} tint={screen === tab ? C.ink : C.muted}/>}</View>
      <Text numberOfLines={2} adjustsFontSizeToFit minimumFontScale={.8} style={[s.tabText, screen === tab && s.activeTabText]}>{tab === 'Comic Workshop' ? 'Comic\nWorkshop' : tab === 'My Profile' ? 'My\nProfile' : tab}</Text>
    </Pressable>;
  }
  function card(issue: Issue, horizontal = false) {
    return <View key={issue.id} style={[s.card, horizontal && s.horizontalCard]}>
      <Art issue={issue} simple/><View style={s.cardBody}>
        <Text style={s.cardTitle}>{issue.title} <Text style={{color: C.coral}}>#{issue.number}</Text></Text>
        <Text numberOfLines={1} style={s.meta}>{issue.publisher}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={'More info about ' + issue.title + ' #' + issue.number} onPress={() => {navigationVersion.current++;setSelected(issue);}} style={({pressed}) => [s.moreInfo, pressed && s.pressed]}><Text style={s.link}>More info</Text><Icon name="Arrow" size={15} tint={C.coral}/></Pressable>
      </View>
    </View>;
  }
  function search() {
    const names = sharedDirectory && screen === 'Directory' && sharedCatalog?.publishers.length ? sharedCatalog.publishers : [...new Set(issues.map(issue => issue.publisher))];
    return <>
      <View style={s.search}><Icon name="Search" size={20} tint={C.muted}/>
        <TextInput style={s.searchInput} value={query} onChangeText={value => {setQuery(value); setCatalogOffset(0);}} maxLength={150} accessibilityLabel="Search comic directory" placeholder="Series, issue, character…" placeholderTextColor={C.muted}/>
        {!!query && <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => {setQuery('');setCatalogOffset(0);}} style={s.clear}><Icon name="Close" size={17}/></Pressable>}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
        {['All', ...names].map(name => <Pressable key={name} accessibilityRole="button" accessibilityState={{selected: publisher === name}} onPress={() => {setPublisher(name);setCatalogOffset(0);}} style={[s.chip, publisher === name && s.activeChip]}>
          <Text style={[s.chipText, publisher === name && {color: C.white}]}>{name}</Text>
        </Pressable>)}
      </ScrollView>
    </>;
  }
  return <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
    <StatusBar style="dark"/>
    <View style={s.header}>
      <Pressable accessibilityRole="button" accessibilityLabel="ComicHuddle home" onPress={() => go('Home')} style={s.brand}>
        <Svg width={114} height={92} viewBox="0 116 1254 1010" accessibilityElementsHidden importantForAccessibility="no-hide-descendants"><SvgImage href={require('./assets/comichuddle-logo.jpeg')} width={1254} height={1254}/></Svg>
      </Pressable>
      <View style={s.headerActions}>
        <Pressable accessibilityRole="link" accessibilityLabel="Open messages on website" onPress={() => web('Messages')} style={s.headerButton}><Icon name="Messages" size={21}/></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Open account drawer and My Profile" onPress={() => {navigationVersion.current++;setMore(true);}} style={[s.headerButton, s.accountButton]}><Icon name="User" size={19}/></Pressable>
      </View>
    </View>
    <ScrollView key={screen} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={[s.scroll, {paddingBottom: 116 + insets.bottom}]}>
      <View style={s.content}>
        {screen === 'Home' && <>
          <View style={s.homeIntro}><View><Text style={s.eyebrow}>YOUR COLLECTOR UNIVERSE</Text><Text style={s.welcome}>The hunt starts here.</Text></View><View style={s.previewPill}><View style={s.statusDot}/><Text style={s.previewText}>Preview</Text></View></View>
          <View style={n.scanPanel}><Atmosphere tone="dark"/><View style={n.scanHeader}><View style={n.scanBadge}><Icon name="Scan" size={30} tint={C.white}/></View><View style={n.scanSticker}><Text style={n.scanStickerText}>LIVE COVER SCAN</Text></View></View><Text style={n.scanTitle}>POINT. FIND.{'\n'}FILL YOUR LONGBOX.</Text><Text style={n.scanBody}>Start the live camera scanner on the website, then confirm the comic before adding your actual copy.</Text><Action role="link" light label="Open live scanner" onPress={() => web('Scan')}/><Text style={n.scanScope}>{Object.keys(covers).length} vintage covers supported today. Find other issues in the directory.</Text></View>
          <View style={s.homeHero}>
            <Atmosphere/><View style={s.heroCopy}><Text style={s.heroKicker}>FOR THE LOVE OF COMICS</Text><Text style={s.heroTitle}>Your next{'\n'}grail awaits.</Text><Text style={s.heroBody}>Find the book.{'\n'}Build your longbox.</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Explore the comic directory" onPress={() => go('Directory')} style={s.heroArrow}><Icon name="Arrow" size={24}/></Pressable>
            </View>
            <View pointerEvents="none" style={s.heroDeck}>{[issues[0], issues[24], issues[25]].map((issue, index) => <View key={issue.id} style={[s.deckCover, {transform: [{rotate: ((index - 1) * 13) + 'deg'}], left: index * 19, top: index * 12, zIndex: index + 1}]}><Art issue={issue} variant="hero"/></View>)}</View>
            <Text style={s.heroFootnote}>STARTER ISSUE RECORDS · SOURCES INCLUDED</Text>
          </View>
          <View style={s.statRow}><View style={s.stat}><Text style={s.statNumber}>{issues.length}</Text><Text style={s.statLabel}>Issues to explore</Text></View><View style={s.statDivider}/><View style={s.stat}><Text style={s.statNumber}>{new Set(issues.map(issue => issue.publisher)).size}</Text><Text style={s.statLabel}>Publishers represented</Text></View><View style={s.statBadge}><Icon name="Directory" tint={C.coral}/></View></View>
          <View style={s.sectionHead}><View><Text style={s.sectionTitle}>From the longbox</Text><Text style={s.small}>Big stories. Small issue numbers.</Text></View><Pressable accessibilityRole="button" onPress={() => go('Directory')} style={s.textLink}><Text style={s.link}>See all</Text><Icon name="Arrow" size={16} tint={C.coral}/></Pressable></View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.horizontalCards}>{[issues[25], issues[0], issues[24], issues[10]].map(issue => card(issue, true))}</ScrollView>
          <View style={s.collectionBanner}><Atmosphere tone="mint"/><View style={s.bannerIcon}><Icon name="User" size={27}/></View><Text style={s.bannerTitle}>Your shelf. Your story.</Text><Text style={s.body}>Make your grails, your completed runs and your wonderfully specific obsession worth showing off.</Text><Action light label="Explore My Profile" onPress={() => go('My Profile')}/></View>
          <Pressable accessibilityRole="button" onPress={() => go('Marketplace')} style={s.communityTeaser}><View style={[s.communityIcon,{backgroundColor:C.peach}]}><Icon name="Marketplace" size={27}/></View><View style={{flex: 1}}><Text style={s.rowTitle}>A new home for your next find</Text><Text style={s.small}>Singles, collections and local pickup.</Text></View><Icon name="Arrow" size={20}/></Pressable>
        </>}
        {screen === 'Directory' && <>
          <View style={s.pageTop}><Text style={s.eyebrow}>THE COMIC DIRECTORY</Text><Text style={s.pageTitle}>Find your next obsession.</Text><Text style={s.body}>Search the series, creators and characters you love.</Text></View>
          <Action role="link" light label="Browse full directory on website" onPress={() => web('Directory')}/>
          {search()}<View style={s.countRow}><Text style={s.small}>{sharedDirectory ? currentCatalog ? currentCatalog.total.toLocaleString() + ' matching issue records' : 'Shared directory' : filtered.length + ' issue records'}</Text><View style={s.scopePill}><Text style={s.scopeText}>{sharedDirectory ? 'Shared catalog' : 'App snapshot'}</Text></View></View>
          {sharedDirectory && (catalogLoading || !currentCatalog && !catalogError) && <Text accessibilityLiveRegion="polite" style={s.body}>Loading the shared directory…</Text>}
          {sharedDirectory && catalogError && <View style={s.note}><Text accessibilityLiveRegion="polite" style={s.body}>{catalogError}</Text><Action light label="Try directory again" onPress={() => setCatalogAttempt(value => value + 1)}/></View>}
          {!catalogLoading && !catalogError && <View style={s.grid}>{directoryIssues.map(issue => card(issue))}</View>}
          {!catalogLoading && !catalogError && !directoryIssues.length && (!sharedDirectory || currentCatalog) && <View style={s.note}><Text style={s.noticeTitle}>No matching issue records.</Text><Text style={s.body}>Try another series, issue or creator.</Text></View>}
          {sharedDirectory && currentCatalog && !catalogLoading && !catalogError && <>
            <View style={s.pagination}><Pressable accessibilityRole="button" accessibilityLabel="Previous directory page" accessibilityState={{disabled: catalogOffset === 0}} disabled={catalogOffset === 0} onPress={() => setCatalogOffset(Math.max(0, catalogOffset - PAGE_SIZE))} style={[s.pageButton, catalogOffset === 0 && {opacity: .4}]}><Icon name="Back" size={17}/><Text style={s.link}>Previous</Text></Pressable><Text style={s.small}>Page {Math.floor(catalogOffset / PAGE_SIZE) + 1}</Text><Pressable accessibilityRole="button" accessibilityLabel="Next directory page" accessibilityState={{disabled: !currentCatalog.hasMore}} disabled={!currentCatalog.hasMore} onPress={() => setCatalogOffset(catalogOffset + PAGE_SIZE)} style={[s.pageButton, !currentCatalog.hasMore && {opacity: .4}]}><Text style={s.link}>Next</Text><Icon name="Arrow" size={17}/></Pressable></View>
            <Text style={s.disclosure}>{currentCatalog.issueCount.toLocaleString()} stored issue records, including {currentCatalog.gcdIssueCount.toLocaleString()} GCD records. Import coverage grows over time; this is not the complete GCD. More info includes each record’s source and license.</Text>
          </>}
          {!sharedDirectory && <View style={s.note}><Text style={s.noticeTitle}>The shared directory keeps growing.</Text><Text style={s.body}>This app snapshot contains {issues.length} records as of {asOf}. Browse the full directory on the website for current GCD imports and to save your actual copy through your account.</Text></View>}
        </>}
        {screen === 'Marketplace' && <>
          <View style={s.marketHero}><Atmosphere tone="mint"/><View style={s.bannerIcon}><Icon name="Collection" size={28}/></View><Text style={s.eyebrow}>THE COLLECTOR MARKETPLACE · USA</Text><Text style={s.pageTitle}>One grail. Or the whole longbox.</Text><Text style={s.body}>Find singles and collections, explore auction previews, or talk through pickup and a trade with another collector.</Text><Action role="link" label="Browse collector listings" onPress={() => web('Marketplace')}/></View>
          <View style={[s.marketActions, {flexWrap: 'wrap'}]}>{[
            {label: 'Sell a comic', icon: 'Marketplace' as IconName, intent: 'single'},
            {label: 'Sell a collection', icon: 'Collection' as IconName, intent: 'collection'},
            {label: 'Start an auction', icon: 'Auction' as IconName, intent: 'auction'},
          ].map(value => <Pressable key={value.intent} accessibilityRole="link" onPress={() => web('Marketplace', {sell: value.intent})} style={[s.marketAction, {minWidth: '45%', paddingHorizontal: 9, minHeight: 54}]}><Icon name={value.icon} tint={C.coral} size={18}/><Text style={s.marketActionLabel}>{value.label}</Text><Icon name="Arrow" size={14}/></Pressable>)}</View>
          <View style={n.marketPossibilities}><View style={n.marketHint}><View style={[n.hintIcon,{backgroundColor:C.blue}]}><Icon name="User" size={20}/></View><Text style={s.rowTitle}>Keep it local</Text><Text style={s.small}>Check a listing’s pickup city and arrange the handoff with its seller.</Text></View><View style={n.marketHint}><View style={[n.hintIcon,{backgroundColor:C.lilacLight}]}><Icon name="Collection" size={20}/></View><Text style={s.rowTitle}>Make a trade proposal</Text><Text style={s.small}>Discuss the books and terms in private messages. A proposal is not a completed exchange.</Text></View></View>
          <View style={s.note}><Text style={s.noticeTitle}>Your account, your actual listings</Text><Text style={s.small}>Owned-copy listings, messages and offers open on the website. Auction proposals remain nonbinding. Payment tools are test-only and unavailable until sandbox setup is complete.</Text></View>
          <Text style={s.sectionTitle}>Find copies by comic</Text><Text style={s.body}>Choose an issue, then open its actual single or collection listings.</Text>
          {search()}<View style={s.grid}>{filtered.map(issue => card(issue))}</View>
          {!filtered.length && <View style={s.note}><Text style={s.noticeTitle}>No matching issue here yet.</Text><Text style={s.body}>The app uses a {issues.length}-issue starter snapshot. Open the shared directory for its current coverage.</Text></View>}
          <Pressable accessibilityRole="link" onPress={() => external('mailto:maliktecks@gmail.com')} style={s.sourceButton}><Text style={s.link}>Support: maliktecks@gmail.com ↗</Text></Pressable>
          <Text style={s.disclosure}>ComicHuddle is operated by Malik LLC, Minnesota, United States. USA-only private preview.</Text>
        </>}
        {screen === 'My Profile' && <>
          <View style={s.pageTop}><Text style={s.eyebrow}>YOUR COLLECTOR IDENTITY</Text><Text style={s.pageTitle}>A profile worth showing off.</Text><Text style={s.body}>Your longbox says a lot about you. Give your grails, your runs and your story a place to shine.</Text></View>
          <View style={n.profileHero}><Atmosphere tone="peach"/><View style={n.heroHeader}><View style={n.profileBadge}><Icon name="User" size={35}/></View><View style={n.sticker}><Text style={n.stickerText}>YOUR OWN UNIVERSE</Text></View></View><Text style={n.comicHeading}>Every shelf.{'\n'}A different story.</Text><Text style={n.heroBody}>Your real showcase opens on the website. Sign in to choose your featured comics and tell collectors what makes your collection yours.</Text><Action role="link" label="Open my collector showcase" onPress={() => web('My Profile')}/></View>
          <View style={n.profileLinks}><Pressable accessibilityRole="link" accessibilityLabel="Open my saved comic collection" onPress={() => web('Account',{accountTab:'Collection'})} style={[s.secondaryLink,{marginBottom:0}]}><View style={[s.secondaryLinkIcon,{backgroundColor:C.mint}]}><Icon name="Collection"/></View><View style={{flex:1}}><Text style={s.rowTitle}>My collection</Text><Text style={s.small}>Your actual copies, conditions and personal notes.</Text></View><Icon name="Arrow" size={18}/></Pressable></View>
          <View style={n.cityPanel}><View style={[n.hintIcon,{backgroundColor:C.blue}]}><Icon name="User" size={22}/></View><Text style={s.sectionTitle}>Your city. Your collecting circle.</Text><Text style={s.body}>A city on your profile gives nearby collectors context for local pickup and a proposed trade. Keep meeting details in private messages; your profile does not need a street address.</Text><Action role="link" light label="Set up my profile on the website" onPress={() => web('My Profile')}/></View>
          <View style={s.note}><Text style={s.noticeTitle}>Collectors and comic care specialists share the longbox.</Text><Text style={s.body}>Registering a pressing studio does not replace your collector account. Providers can keep a personal collection and a showcase, too.</Text><Action label="Explore Comic Workshop" light onPress={() => go('Comic Workshop')}/></View>
          <Text style={s.disclosure}>This prototype does not invent a collection, a location, follower counts or a reputation. Open your account on the website to view and save your real records.</Text>
        </>}
        {screen === 'Upcoming' && <>
          <View style={s.pageTop}><Text style={s.eyebrow}>NEXT IN THE COMICHUDDLE UNIVERSE</Text><Text style={s.pageTitle}>The next chapter.</Text><Text style={s.body}>Three future features for your collector universe. They are coming soon and are not available to use here yet.</Text></View>
          {upcomingFeatures.map(feature => <View key={feature.name} style={n.upcomingCard}><Atmosphere tone={feature.tone}/><View style={n.heroHeader}><View style={s.bannerIcon}><Icon name={feature.icon} size={28}/></View><View style={n.sticker}><Text style={n.stickerText}>COMING SOON</Text></View></View><Text style={n.comicHeading}>{feature.name} coming soon</Text><Text style={n.heroBody}>{feature.description}</Text><Text style={n.plannedLabel}>PLANNED FEATURE · {feature.boundary}</Text></View>)}
          <View style={s.note}><Text style={s.noticeTitle}>Your longbox is already waiting.</Text><Text style={s.body}>Explore the directory, build your profile and connect to your actual web account while these features take shape.</Text><Action light label="Explore the directory" onPress={() => go('Directory')}/></View>
        </>}
        {screen === 'Comic Workshop' && <>
          <View style={s.pageTop}><Text style={s.eyebrow}>COMIC WORKSHOP</Text><Text style={s.pageTitle}>Good books deserve good care.</Text><Text style={s.body}>Independent pressing, dry cleaning and grading support. Read reviews and talk to a specialist before shipping.</Text></View>
          <View style={s.secondaryHero}><Atmosphere tone="mint"/><Icon name="Pressing" size={45}/><Text style={s.bannerTitle}>Meet your next comic care specialist.</Text><Action role="link" label="Open Comic Workshop" onPress={() => web('Comic Workshop')}/></View>
          <View style={s.secondaryLinks}>
            <Pressable accessibilityRole="link" accessibilityLabel="Register my pressing studio" style={s.secondaryLink} onPress={() => web('Comic Workshop', {join: 'provider'})}><View style={s.secondaryLinkIcon}><Icon name="Pressing"/></View><View style={{flex: 1}}><Text style={s.rowTitle}>Register my pressing studio</Text><Text style={s.small}>You can be a collector and a provider.</Text></View><Icon name="Arrow" size={18}/></Pressable>
            <Pressable accessibilityRole="link" style={s.secondaryLink} onPress={() => web('Messages')}><View style={s.secondaryLinkIcon}><Icon name="Messages"/></View><View style={{flex: 1}}><Text style={s.rowTitle}>Talk to my specialist</Text><Text style={s.small}>Quotes, intake and care conversations.</Text></View><Icon name="Arrow" size={18}/></Pressable>
          </View>
          <Text style={s.disclosure}>Account features open the website. Pressing cannot guarantee a higher grade. Verify methods, shipping insurance and CGC submission eligibility directly with your provider.</Text>
        </>}
        <View style={s.footer}><Text style={s.footerBrand}>Made for your obsession.</Text><Text style={s.disclosure}>ComicHuddle · Independent collector platform.{'\n'}Private prototype. No publisher or CGC affiliation.</Text></View>
      </View>
    </ScrollView>
    <View style={[s.dock, {width: dock.width, bottom: insets.bottom + 12}]} accessibilityLabel="Primary app navigation">
      <View style={s.dockSide}>{bottomTabs.slice(0, 3).map(tabControl)}</View>
      <View style={[s.scanSlot, {width: dock.scanDiameter}]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Scan a comic" accessibilityHint="Opens the live scanner on the website. Start the camera there." onPress={() => web('Scan')} style={({pressed}) => [s.scanAction, {width: dock.scanDiameter, height: dock.scanDiameter, borderRadius: dock.scanDiameter / 2}, pressed && s.pressed]}><Icon name="Scan" size={28} tint={C.white}/></Pressable>
        <Text style={s.scanActionText}>Scan</Text>
      </View>
      <View style={s.dockSide}>{bottomTabs.slice(3).map(tabControl)}</View>
    </View>
    <Modal visible={more} transparent animationType="slide" onRequestClose={() => setMore(false)}>
      <View style={s.overlay}><Pressable accessibilityRole="button" accessibilityLabel="Close account drawer" onPress={() => setMore(false)} style={s.overlayDismiss}/>
        <SafeAreaView edges={['bottom']} accessibilityViewIsModal style={s.moreSheet}><View style={s.sheetHandle}/><View style={s.sheetHead}><View><Text style={s.sectionTitle}>Your account</Text><Text style={s.small}>Your collection and your collector identity.</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Close account drawer" onPress={() => setMore(false)} style={s.close}><Icon name="Close"/></Pressable></View>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.moreContent}>
            <Pressable accessibilityRole="link" accessibilityLabel="Open My Profile showcase on website" onPress={() => account('My Profile')} style={s.moreRow}><View style={[s.moreIcon, {backgroundColor: C.peach}]}><Icon name="User"/></View><View style={{flex: 1}}><Text style={s.rowTitle}>My Profile</Text><Text style={s.small}>Your grails, your story, your showcase.</Text></View><Icon name="Arrow" size={18}/></Pressable>
            <View style={[s.moreAccount, {gap: 14}]}><Action role="link" light label="My collection & account" onPress={() => account('Account')}/><Action role="link" light label="Private messages" onPress={() => account('Messages')}/><Action role="link" label="Orders & refund requests ↗" onPress={() => account('Account', {accountTab: 'Orders'})}/></View>
            <Text style={s.disclosure}>Account features open the shared website. Sign in or create your free account there to save your collection and showcase.</Text>
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
    <Modal visible={!!selected} transparent animationType="slide" onRequestClose={() => setSelected(null)}>
      <View style={s.overlay}><Pressable accessibilityRole="button" accessibilityLabel="Close comic details" onPress={() => setSelected(null)} style={s.overlayDismiss}/>
        <SafeAreaView edges={['bottom']} accessibilityViewIsModal style={s.detailSheet}><View style={s.sheetHandle}/><View style={s.sheetHead}><Text style={s.eyebrow}>ISSUE RECORD · SOURCES INCLUDED</Text><Pressable accessibilityRole="button" accessibilityLabel="Close comic details" style={s.close} onPress={() => setSelected(null)}><Icon name="Close"/></Pressable></View>
          {selected && <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.detail}>
            <View style={s.detailHero}><View style={s.detailArt}><Art issue={selected} variant="detail" simple/></View><View style={{flex: 1}}><Text style={s.meta}>{selected.publisher}{selected.year ? ' · ' + selected.year : ''}</Text><Text style={s.detailTitle}>{selected.title}{'\n'}<Text style={{color: C.coral}}>#{selected.number}</Text></Text><Text style={s.small}>{selected.note}</Text></View></View>
            <View style={s.recordFields}><Text style={s.body}>Writer: {selected.writer || 'Not supplied'}{'\n'}Artist: {selected.artist || 'Not supplied'}{selected.coverArtist ? '\nCover artist: ' + selected.coverArtist : ''}{'\n'}Edition: {selected.variant || 'Not supplied'}{selected.era ? '\nEra: ' + selected.era : ''}{selected.kind ? '\nType: ' + selected.kind : ''}{selected.characters.length ? '\nCharacters: ' + selected.characters.join(', ') : ''}{selected.gcdId ? '\nGCD issue ID: ' + selected.gcdId : ''}</Text></View>
            {sharedDirectory && detailLoading && <Text accessibilityLiveRegion="polite" style={s.body}>Loading the full issue bibliography…</Text>}
            {sharedDirectory && detailError && <View style={s.note}><Text accessibilityLiveRegion="polite" style={s.body}>{detailError}</Text><Action light label="Try issue details again" onPress={() => setDetailAttempt(value => value + 1)}/></View>}
            <Bibliography value={selected.bibliography}/>
            <View style={s.detailActions}><Action role="link" label="Find copies for sale" onPress={() => web('Marketplace', {issue: selected.id})}/><Action role="link" light label="Add to collection on website" onPress={() => web('Directory', {issue: selected.id})}/></View>
            <Action role="link" light label="Open full issue on website" onPress={() => web('Directory', {issue: selected.id})}/>
            <Text style={s.sectionTitle}>Bibliography & cover credits</Text>
            {!!selected.source && <Pressable accessibilityRole="link" onPress={() => external(selected.source)} style={s.sourceButton}><Text style={s.link}>Open issue source ↗</Text></Pressable>}
            {selected.dataCredit && <Text style={s.disclosure}>{selected.dataCredit}</Text>}{selected.dataLicense && <Text style={s.disclosure}>Metadata license: {selected.dataLicense}</Text>}{selected.coverCredit && <Text style={s.disclosure}>{selected.coverCredit}</Text>}
            {selected.coverSource && <Pressable accessibilityRole="link" onPress={() => external(selected.coverSource!)} style={s.sourceButton}><Text style={s.link}>Vintage cover source ↗</Text></Pressable>}
            <Text style={s.disclosure}>Cover art appears only for the six authorized vintage covers. Other records use a missing-cover icon.</Text>
          </ScrollView>}
        </SafeAreaView>
      </View>
    </Modal>
    {!!toast && <Pressable accessibilityRole="button" accessibilityLabel="Dismiss notice" onPress={() => setToast('')} style={[s.toast, {bottom: 110 + insets.bottom}]}><Text accessibilityLiveRegion="polite" style={{color: C.white}}>{toast}</Text></Pressable>}
  </SafeAreaView>;
}

const panel = {borderWidth: 2, borderColor: C.ink, borderRadius: 9, backgroundColor: C.white};
const n = StyleSheet.create({
  scanPanel: {...panel, backgroundColor: C.navy, overflow: 'hidden', padding: 22, marginBottom: 24, boxShadow: '4px 4px 0 #1e2530'},
  scanHeader: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 14},
  scanBadge: {width: 56, height: 56, borderWidth: 2, borderColor: C.white, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: '#ffffff15'},
  scanSticker: {borderWidth: 1.5, borderColor: C.ink, borderRadius: 4, backgroundColor: C.lilac, paddingHorizontal: 10, paddingVertical: 8, transform: [{rotate: '4deg'}], flexShrink: 1},
  scanStickerText: {fontSize: 8, letterSpacing: .8, fontWeight: '900', color: C.ink},
  scanTitle: {fontSize: 28, lineHeight: 32, fontWeight: '900', letterSpacing: -.8, color: C.white, marginTop: 21, marginBottom: 11},
  scanBody: {fontSize: 13, lineHeight: 21, color: '#e8eee6', marginBottom: 20},
  scanScope: {fontSize: 10, lineHeight: 16, color: '#e8eee6', marginTop: 13},
  heroHeader: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10},
  sticker: {borderWidth: 1.5, borderColor: C.ink, backgroundColor: C.white, borderRadius: 4, paddingHorizontal: 8, paddingVertical: 7, transform: [{rotate: '3deg'}], flexShrink: 1},
  stickerText: {fontSize: 8, letterSpacing: .8, fontWeight: '800', color: C.ink},
  comicHeading: {fontSize: 29, lineHeight: 33, textTransform: 'uppercase', fontWeight: '900', letterSpacing: -.8, color: C.ink, marginBottom: 12},
  heroBody: {fontSize: 13, lineHeight: 21, color: C.ink, marginBottom: 19},
  profileHero: {...panel, overflow: 'hidden', padding: 22, boxShadow: '4px 4px 0 #1e2530'},
  profileBadge: {width: 65, height: 65, borderWidth: 2, borderColor: C.ink, borderRadius: 13, backgroundColor: C.white, alignItems: 'center', justifyContent: 'center', marginBottom: 24, transform: [{rotate: '-3deg'}]},
  profileLinks: {marginTop: 23},
  cityPanel: {...panel, backgroundColor: C.blue, padding: 21, marginTop: 23},
  marketPossibilities: {flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12, marginTop: 16},
  marketHint: {...panel, width: '47.8%', padding: 14},
  hintIcon: {width: 39, height: 39, borderWidth: 1.5, borderColor: C.ink, borderRadius: 7, alignItems: 'center', justifyContent: 'center', marginBottom: 13},
  upcomingCard: {...panel, overflow: 'hidden', padding: 22, marginBottom: 22, boxShadow: '4px 4px 0 #1e2530'},
  plannedLabel: {fontSize: 8, lineHeight: 14, letterSpacing: .6, fontWeight: '800', color: C.ink},
});

export default function NativeApp() {return <SafeAreaProvider><AppBody/></SafeAreaProvider>;}
