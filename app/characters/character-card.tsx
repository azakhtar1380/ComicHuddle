// One character card (portrait, name, first appearance), shared by the Characters page and Home.
import {Star} from 'lucide-react';
import {Portrait} from '../issue-showcase';

export type CharacterHit={characterId:number;name:string;portraitUrl:string|null;issueCount:number|null;firstAppearance:{issueId:number;title:string;number:string;year:number|null}|null};

export default function CharacterCard({hit}:{hit:CharacterHit}){
 return <a href={'/characters/'+hit.characterId} className="cp-person">
  <Portrait name={hit.name} src={hit.portraitUrl} size="lg"/>
  <strong>{hit.name}</strong>
  {hit.firstAppearance?<small><Star size={12} fill="currentColor"/> {hit.firstAppearance.title} #{hit.firstAppearance.number}{hit.firstAppearance.year?' ('+hit.firstAppearance.year+')':''}</small>:hit.issueCount?<small>{hit.issueCount.toLocaleString('en-US')} {hit.issueCount===1?'comic':'comics'}</small>:<small className="cp-faint">Details on the way</small>}
 </a>;
}
