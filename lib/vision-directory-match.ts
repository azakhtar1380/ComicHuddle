import type {Issue} from './catalog';
export type CoverObservations={title:string|null;number:string|null;publisher:string|null;dateText:string|null;coverPriceText:string|null;barcode:string|null;printingClues:string[];labelText:string|null;quality:'clear'|'ambiguous'|'poor_photo'|'multiple_books'|'unknown'};
const key=(s:string)=>s.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
export function rankVisionDirectory(observed:CoverObservations,issues:Issue[]){
 if(!observed.title||!observed.number||['poor_photo','multiple_books','unknown'].includes(observed.quality))return [];
 const number=observed.number.replace(/^#\s*/,'').toLowerCase(),tokens=key(observed.title).split(' ').filter(word=>word.length>1&&!['comics','comic','marvel','dc','the'].includes(word));
 return issues.flatMap(issue=>{if(issue.number.toLowerCase()!==number)return [];const title=key(issue.title),matches=tokens.filter(token=>title.split(' ').includes(token)).length;if(!tokens.length||matches/tokens.length<.6)return [];
  const publisher=observed.publisher&&key(issue.publisher).includes(key(observed.publisher));const clueConflict=observed.printingClues.some(clue=>/facsimile|reprint|second printing|third printing/i.test(clue))&&!/facsimile|reprint|second|third/i.test(key(issue.variant));const score=matches/tokens.length+(publisher?.2:0)-(clueConflict?.5:0);
  return [{issue,score,explanation:'Visible title and issue number match'+(publisher?'; publisher text agrees':'')+(clueConflict?'. Printing clues need a barcode or indicia photo.':'. Confirm the listed edition against your copy.'),needsEditionPhoto:clueConflict}];
 }).sort((a,b)=>b.score-a.score||a.issue.id-b.issue.id).slice(0,6);
}
