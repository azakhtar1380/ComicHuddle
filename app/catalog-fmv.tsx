'use client';
import EstimatedValue from './estimated-value';
import type {EstimateSnapshot} from '../lib/estimated-fmv-types';
export default function CatalogFmv({issueId,initialSnapshot}:{issueId:number;initialSnapshot?:EstimateSnapshot}){return <EstimatedValue request={{issueId,reference:true}} initialSnapshot={initialSnapshot}/>}
