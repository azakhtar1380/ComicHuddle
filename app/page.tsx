import { getChatGPTUser } from './chatgpt-auth';
import Hub from './hub';
import {ownerAccountId} from '../lib/owner';
export const dynamic='force-dynamic';
// The section in the address bar is rendered by the server too, so /?section=Marketplace never flashes Home first.
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){const user=await getChatGPTUser(),section=(await searchParams).section;return <Hub name={user?.displayName || 'Collector'} signedIn={!!user} isOwner={user?.userId===ownerAccountId} initialSection={typeof section==='string'?section.slice(0,40):undefined}/>;}
