import { getChatGPTUser } from './chatgpt-auth';
import Hub from './hub';
import {ownerAccountId} from '../lib/owner';
export const dynamic='force-dynamic';
export default async function Page(){const user=await getChatGPTUser();return <Hub name={user?.displayName || 'Collector'} signedIn={!!user} isOwner={user?.userId===ownerAccountId}/>;}
