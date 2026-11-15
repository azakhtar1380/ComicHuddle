// Comic detail card helpers (lib/issue-insights-detail.ts) and outbound links (lib/value-links.ts).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {catalogCharacters,catalogNote,detailCredits,editionInfo,gcdCharacterNames,gcdCreditNames,gcdDate,gcdFirstAppearances,releaseInfo} from '../lib/issue-insights-detail';
import {cgcSubmitUrl,goCollectIssueUrl} from '../lib/value-links';
import type {GcdBibliography,GcdStory} from '../lib/catalog';

const story=(over:Partial<GcdStory>):GcdStory=>({type:'comic story',title:'',feature:'',sequenceNumber:1,pageCount:'',script:'',pencils:'',inks:'',colors:'',letters:'',editing:'',jobNumber:'',genre:'',firstLine:'',characters:'',synopsis:'',notes:'',keywords:'',...over});
const bib=(stories:GcdStory[],over:Partial<GcdBibliography>={}):GcdBibliography=>({publicationDate:'',keyDate:'',onSaleDate:'',originalCoverPrice:{kind:'ORIGINAL_COVER_PRICE',text:''},pageCount:'',isbn:'',barcode:'',issueTitle:'',volume:'',variantOf:null,seriesProviderId:1,indiciaPublisher:'',brandEmblem:'',rating:'',indiciaFrequency:'',indiciaPrinter:'',keywords:'',editing:'',stories,...over});

test('GCD first appearances come only from explicit indexer notes',()=>{
 const b=bib([story({type:'cover',characters:'Batman (first appearance)'}),story({characters:'Batman [Bruce Wayne] (featured); The Joker (villain) (introduction); Liz (first name revealed); Mary Jane Watson (First full appearance); Gwen Stacy (clone) (cameo) (first appearance); Rhino [Aleksei Sytsevich] (antagonist) (first appearance)'})]);
 assert.deepEqual(gcdFirstAppearances(b),[{name:'The Joker',qualifier:'first appearance'},{name:'Mary Jane Watson',qualifier:'first full appearance'},{name:'Gwen Stacy',qualifier:'first appearance (cameo)'},{name:'Rhino',qualifier:'first appearance'}]);
 assert.deepEqual(gcdFirstAppearances(bib([story({characters:'Spider-Man [Peter Parker]; Aunt May'})])),[]);
 assert.deepEqual(gcdCharacterNames(b),['Batman','The Joker','Liz','Mary Jane Watson','Gwen Stacy','Rhino']);
});

test('credits: Metron first, then GCD stories, then the catalog entry; variant cover artists flagged',()=>{
 const metron=[{name:'Al Ewing',roles:['Writer']},{name:'Stefano Caselli',roles:['Artist']},...['A','B','C'].map(name=>({name,roles:['Cover']}))];
 const c=detailCredits({writer:'Not recorded',artist:'Not recorded',gcdId:1},metron);
 assert.deepEqual([c.writers?.source,c.writers?.names,c.artists?.names,c.covers?.note],['Metron',['Al Ewing'],['Stefano Caselli'],'All covers, including variants']);
 const g=detailCredits({writer:'Not recorded',artist:'Not recorded',gcdId:1,bibliography:bib([story({type:'cover',pencils:'Jack Kirby (signed)'}),story({script:'Stan Lee (credited); ?',pencils:'Steve Ditko (signed)'})])},[]);
 assert.deepEqual([g.writers,g.artists,g.covers],[{names:['Stan Lee'],source:'GCD'},{names:['Steve Ditko'],source:'GCD'},{names:['Jack Kirby'],source:'GCD'}]);
 const k=detailCredits({writer:'Stan Lee / Larry Lieber',artist:'Multiple contributors'},[]);
 assert.deepEqual([k.writers,k.artists],[{names:['Stan Lee','Larry Lieber'],source:'Catalog entry'},null]);
 assert.deepEqual(gcdCreditNames('Bob Kane (signed); Jerry Robinson (sourced) (see notes)'),['Bob Kane','Jerry Robinson']);
});

test('dates, editions and catalog notes are shown only when recorded',()=>{
 assert.equal(gcdDate('1940-04-25'),'April 25, 1940');assert.equal(gcdDate('1940-04-00'),'April 1940');assert.equal(gcdDate('1940-00-00'),'1940');assert.equal(gcdDate(''),null);
 assert.deepEqual(releaseInfo({year:1940,bibliography:bib([],{onSaleDate:'1940-04-25',publicationDate:'Spring 1940'})}),{onSale:'April 25, 1940',coverDate:'Spring 1940',year:null,source:'GCD'});
 assert.deepEqual(releaseInfo({year:0}),{onSale:null,coverDate:null,year:null,source:null});
 assert.equal(editionInfo({variant:'Original issue · printing to be confirmed'}),null,'placeholder edition text is not a fact');
 assert.deepEqual(editionInfo({variant:'Todd McFarlane Cover',bibliography:bib([],{variantOf:724})}),{label:'Variant edition: Todd McFarlane Cover',variantOfUrl:'https://www.comics.org/issue/724/'});
 assert.equal(catalogNote({note:'The debut issue for Deadpool.'}),null,'unverified first-appearance claims are hidden');
 assert.equal(catalogNote({note:'Cover Number with Period',gcdId:724}),null,'GCD indexer notes are not descriptions');
 assert.equal(catalogNote({note:'The opening issue of Saga.'}),'The opening issue of Saga.');
 assert.deepEqual(catalogCharacters({characters:['Science-fiction anthology']}),[]);
});

test('one GoCollect search link and the CGC submission page',()=>{
 assert.equal(goCollectIssueUrl({title:'Amazing Spider-Man',number:'300'}),'https://gocollect.com/search?q=Amazing%20Spider-Man%20300');
 assert.equal(goCollectIssueUrl({title:'Batman (1940 series)',number:'#1'}),'https://gocollect.com/search?q=Batman%201');
 assert.equal(cgcSubmitUrl,'https://www.cgccomics.com/submit/how-to-submit/');
});
