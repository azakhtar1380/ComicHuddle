// My Profile (migration 051 onward): input validation for profile details, short key notes, share cards.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {extrasInput} from '../lib/profile-extras';
import {shortKeyNote} from '../lib/issue-keys';
import {L,cardKey,extraLines,nameFontSize,statChips,type ShareCardData} from '../lib/share-cards';
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

test('share card: one design with stats, only the set extras, readable sizes and never a value',()=>{
 const data:ShareCardData={name:'Ava Reads',handle:'ava',since:2009,comics:1200,keys:1,rating:'4.8',verified:'person',founder:false,favoriteCharacter:'Storm',grail:null,avatar:'/api/avatar?id=x',cover:null};
 assert.deepEqual(statChips(data),[{value:'1,200',label:'Comics'},{value:'1',label:'Key'},{value:'★ 4.8',label:'Rating'}]);
 assert.equal(statChips({...data,rating:null})[2].value,'New');
 assert.deepEqual(extraLines(data),['Fave: Storm'],'only the extras that are set');
 assert.deepEqual(extraLines({...data,grail:'Hulk #181',trophy:{name:'Key Hunter',tier:'Gold'}}),['Fave: Storm','Grail: Hulk #181','Trophy: Key Hunter · Gold']);
 assert.equal(nameFontSize('Al'),108);assert.ok(nameFontSize('A very long collector name here')>=60);
 for(const size of [L.handle.size,L.since.size,L.stats.label,L.extras.size,L.link.small])assert.ok(size>=28,'no text smaller than 28px at 1080 wide');
 assert.doesNotMatch([...statChips(data).flatMap(c=>[c.value,c.label]),...extraLines(data)].join(' '),/\$|value|price/i,'never a dollar value');
 assert.notEqual(cardKey(data),cardKey({...data,comics:1201}),'the PNG cache changes when the profile does');
});
