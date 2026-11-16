// My Profile (migration 051 onward): input validation for profile details, short key notes, share cards.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {extrasInput} from '../lib/profile-extras';
import {shortKeyNote} from '../lib/issue-keys';
import {shareCardSvg,type ShareCardData} from '../lib/share-cards';
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

test('share cards: both styles carry the photo, Mr. Huddles, the verified check and no value',()=>{
 const data:ShareCardData={name:'Ava <Reads>',handle:'ava',since:2009,comics:1200,keys:42,verified:'person',favoriteCharacter:'Storm',grail:'Hulk #181',avatar:'data:image/png;base64,AA',cover:null,huddles:'/mascot/huddles-cutout.webp',sky:['#efd369','#f3c94a'],accent:'#c83e30'};
 for(const style of ['slab','trading'] as const){
  const svg=shareCardSvg(style,data);
  assert.match(svg,new RegExp(`data-card="${style}"`));
  assert.match(svg,/data-role="huddles"/);assert.match(svg,/data-role="avatar"/);assert.match(svg,/data-role="verified"/);
  assert.match(svg,/Ava &lt;Reads&gt;/,'names are escaped');
  assert.doesNotMatch(svg,/\$|value|price/i,'never a dollar value');
 }
 assert.match(shareCardSvg('slab',data),/9\.8/);assert.match(shareCardSvg('slab',data),/COLLECTOR/);
 assert.match(shareCardSvg('trading',data),/No\. 0001/);assert.match(shareCardSvg('trading',data),/POWER GRID/);
 assert.doesNotMatch(shareCardSvg('slab',{...data,verified:null}),/data-role="verified"/);
});
