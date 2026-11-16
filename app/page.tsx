import { getChatGPTUser } from './chatgpt-auth';
import Hub from './hub';
import {redirect} from 'next/navigation';
import {ownerAccountId} from '../lib/owner';
export const dynamic='force-dynamic';
// The section in the address bar is rendered by the server too, so /?section=Marketplace never flashes Home first.
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){const query=await searchParams,collector=query.collector;
 // Old share links (/?collector=handle) now open the clean profile link.
 if(typeof collector==='string'&&/^[a-z][a-z0-9_]{2,23}$/i.test(collector))redirect('/@'+collector.toLowerCase());
 const user=await getChatGPTUser(),section=query.section;return <Hub name={user?.displayName || 'Collector'} signedIn={!!user} isOwner={user?.userId===ownerAccountId} initialSection={typeof section==='string'?section.slice(0,40):undefined}/>;}
