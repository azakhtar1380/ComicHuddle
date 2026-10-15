import type {CatalogDb} from './catalog-store';
/** Retained interface for historical operator tooling. AI is not a launch service. */
export const enrichmentModel=()=>null;
export class EnrichmentAiError extends Error{constructor(public code:string,public retryable=false){super(code)}}
export async function aiConnection():Promise<{token:string;url:string;model:string;direct:boolean}|null>{return null}
export async function aiAvailability(){return {available:false,reason:'AI features are deferred for launch.',model:null}}
export async function structuredAi<T>(_db:CatalogDb,_purpose:'valuation'|'scanner'|'pulse',_schema:Record<string,unknown>,_system:string,_input:unknown,_imageData?:string|string[],_maxMilliseconds=35000):Promise<{value:T;model:string}>{throw new EnrichmentAiError('ai_deferred_for_launch')}
