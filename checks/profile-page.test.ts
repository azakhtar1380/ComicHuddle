// My Profile (migration 051 onward): input validation for profile details, short key notes, share cards.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {extrasInput} from '../lib/profile-extras';
import {shortKeyNote} from '../lib/issue-keys';
import {L,STRIP_TEXT,cardKey,labelLines,nameFontSize,type ShareCardData} from '../lib/share-cards';
import {MAX_PROFILE_TAGS} from '../lib/profile-page-types';

test('profile details: tags, references and reward are validated',()=>{
 assert.equal(extrasInput.safeParse({tags:['Bronze Age','Open to trades']}).success,true);
 assert.equal(extrasInput.safeParse({tags:Array.from({length:MAX_PROFILE_TAGS+1},(_,i)=>'Tag '+i)}).success,false,'at most four tags');
 assert.equal(extrasInput.safeParse({tags:['Bronze Age','bronze age']}).success,false,'each tag once');
 assert.equal(extrasInput.safeParse({tags:['<script>']}).success,false,'plain words only');
 assert.equal(extrasInput.safeParse({grailReward:'x'.repeat(81)}).success,false);
 assert.equal(extrasInput.safeParse({favoriteCharacterId:0}).success,false);
 assert.equal(extrasInput.safeParse({favoriteIssueId:null,grailIssueId:4000000724}).success,true);
 assert.equal(extrasInput.safeParse({value:100}).success,false,'unknown fields (like a collection value) are refused');
});

test('short key notes for small labels',()=>{
 assert.equal(shortKeyNote(['Elektra'],null),'1st Elektra');
 assert.equal(shortKeyNote(['Wolverine','Wendigo','Hulk'],null),'1st Wolverine & Wendigo +1');
 assert.equal(shortKeyNote([],'First full appearance of Wolverine. Wendigo also appears.'),'1st Wolverine');
 assert.equal(shortKeyNote([],'Death of Gwen Stacy; classic cover.'),'Death of Gwen Stacy');
 assert.equal(shortKeyNote([],null),'Key issue');
});

test('slab share card: label lines carry the stats and only the set extras, readable sizes, never a value',()=>{
 const data:ShareCardData={name:'Ava Reads',handle:'ava',since:2009,comics:1284,keys:1,trades:38,rating:'4.8',verified:'person',founder:true,favoriteCharacter:'Wolverine',grail:null,avatar:'/api/avatar?id=x',cover:null};
 assert.deepEqual(labelLines(data),['1,284 issues · 1 key · 38 trades · ★ 4.8.','Fave: Wolverine.']);
 assert.deepEqual(labelLines({...data,rating:null,favoriteCharacter:null,grail:'Incredible Hulk #181'}),['1,284 issues · 1 key · 38 trades.','Grail: Incredible Hulk #181.']);
 assert.equal(labelLines({...data,favoriteCharacter:null}).length,1,'no empty second line');
 assert.equal(nameFontSize('Al'),96);assert.ok(nameFontSize('A very long collector name here')>=54);
 for(const size of [L.handle.size,L.lines.size,L.strip.size,L.url.size,L.grade.word])assert.ok(size>=28,'no text smaller than 28px at 1080 wide');
 assert.doesNotMatch([...labelLines(data),STRIP_TEXT].join(' '),/\$|value|price/i,'never a dollar value');
 assert.notEqual(cardKey(data),cardKey({...data,comics:1285}),'the PNG cache changes when the profile does');
});
