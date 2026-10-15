import {z} from 'zod';
import type {EstimateCondition} from './estimated-fmv-types';

export const rawConditions=['GOOD','VERY_GOOD','FINE','VERY_FINE','NEAR_MINT'] as const;
export const collectionGrades=['0.5','1.0','1.5','1.8','2.0','2.5','3.0','3.5','4.0','4.5','5.0','5.5','6.0','6.5','7.0','7.5','8.0','8.5','9.0','9.2','9.4','9.6','9.8','9.9','10.0'] as const;
export const slabLabels=['Universal','Signature Series','Qualified','Restored','Conserved'] as const;
const validDate=(value:string)=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
export const collectionEntrySchema=z.object({
 format:z.enum(['RAW','GRADED']),rawCondition:z.enum(rawConditions).nullable(),gradingCompany:z.literal('CGC').nullable(),grade:z.enum(collectionGrades).nullable(),labelType:z.enum(slabLabels).nullable(),
 certificationNumber:z.string().trim().regex(/^\d{5,20}$/).nullable(),purchasePriceCents:z.string().regex(/^(0|[1-9]\d{0,9})$/).refine(value=>BigInt(value)<=BigInt(1000000000)).nullable(),
 acquiredOn:z.string().refine(validDate,'Use a valid calendar date.').nullable(),notes:z.string().trim().max(500),
}).strict().superRefine((entry,context)=>{
 if(entry.format==='RAW'&&(entry.gradingCompany!==null||entry.grade!==null||entry.labelType!==null||entry.certificationNumber!==null))context.addIssue({code:z.ZodIssueCode.custom,message:'A raw copy cannot carry a slab identity.'});
 if(entry.format==='GRADED'&&(entry.rawCondition!==null||entry.gradingCompany!=='CGC'||entry.grade===null||entry.labelType===null||entry.certificationNumber===null))context.addIssue({code:z.ZodIssueCode.custom,message:'Record the slab grade, label and certification number.'});
});
export type CollectionEntry=z.infer<typeof collectionEntrySchema>;

/** Integer cents; blank is unknown, while an explicit zero remains zero. */
export function purchaseCents(value:string):string|null{
 const amount=value.trim();if(!amount)return null;
 if(!/^(0|[1-9]\d{0,7})(?:\.\d{1,2})?$/.test(amount))throw Error('Enter a nonnegative USD amount with at most two decimal places.');
 const [whole,fraction='']=amount.split('.'),cents=BigInt(whole)*BigInt(100)+BigInt(fraction.padEnd(2,'0'));
 if(cents>BigInt(1000000000))throw Error('Purchase price must not exceed $10,000,000.');
 return String(cents);
}
export function collectionGrade(entry:CollectionEntry){return entry.format==='GRADED'?'CGC '+entry.grade+' '+entry.labelType:'Raw · '+(entry.rawCondition?.replaceAll('_',' ').toLowerCase()||'condition not recorded');}

export function ownershipFromForm(form:FormData,format:'RAW'|'GRADED'):CollectionEntry{
 return collectionEntrySchema.parse({format,rawCondition:format==='RAW'?(String(form.get('rawCondition')||'')||null):null,gradingCompany:format==='GRADED'?'CGC':null,grade:format==='GRADED'?String(form.get('grade')):null,labelType:format==='GRADED'?String(form.get('labelType')):null,certificationNumber:format==='GRADED'?String(form.get('certificationNumber')||'').trim():null,purchasePriceCents:purchaseCents(String(form.get('purchasePrice')||'')),acquiredOn:String(form.get('acquiredOn')||'')||null,notes:String(form.get('notes')||'')});
}
/** A retry acknowledges only the same edition and the same recorded ownership payload. */
export function matchesCollectionRequest(copy:{catalogId?:number;externalCatalog?:{provider:string;id:number};ownership?:CollectionEntry;grade:string},anchor:{catalogId?:number;externalCatalog?:{provider:string;id:number}},entry:CollectionEntry|null){
 const identity=anchor.externalCatalog?copy.catalogId===undefined&&copy.externalCatalog?.provider===anchor.externalCatalog.provider&&copy.externalCatalog.id===anchor.externalCatalog.id:copy.externalCatalog===undefined&&copy.catalogId===anchor.catalogId;
 return identity&&JSON.stringify(copy.ownership||null)===JSON.stringify(entry)&&copy.grade===(entry?collectionGrade(entry):'Raw · condition not recorded');
}

/** Public profiles expose copy identity, never acquisition/cost/certification notes. */
export function publicOwnedCopy<T extends {id:string;title:string;issue:string;grade:string;catalogId?:number;externalCatalog?:{provider:'Metron'|'GCD';id:number;sourceUrl:string;license:'CC BY-SA 4.0'};photoId?:string;condition?:EstimateCondition}>(copy:T){
 return {id:copy.id,title:copy.title,issue:copy.issue,grade:copy.grade,...(copy.catalogId===undefined?{}:{catalogId:copy.catalogId}),...(copy.externalCatalog?{externalCatalog:copy.externalCatalog}:{}),...(copy.photoId?{photoId:copy.photoId}:{}),...(copy.condition?{condition:{...copy.condition,certificationNumber:undefined}}:{})};
}
