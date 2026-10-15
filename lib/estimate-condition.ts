import {z} from 'zod';
import {listingDirectoryId} from './shared-catalog';
import type {EstimateCondition,EstimateRequest} from './estimated-fmv-types';
export const estimateConditionSchema=z.object({mode:z.enum(['Raw','CGC']),grade:z.string().max(12),label:z.string().max(40),printing:z.string().max(50),language:z.string().max(40).optional(),signatureStatus:z.string().max(50).optional(),restorationStatus:z.string().max(50).optional(),certificationNumber:z.string().max(40).optional()}).strict();
/** A physical copy only uses condition explicitly recorded on that copy. */
export function ownedEstimateRequest(copy:{catalogId?:number;externalCatalog?:{provider:string;id:number};condition?:EstimateCondition}):EstimateRequest|null{const issueId=listingDirectoryId(copy);return issueId===null?null:{issueId,...(copy.condition?{condition:copy.condition}:{})}}
