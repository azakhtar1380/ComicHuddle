import {NextResponse} from 'next/server';
export function GET(){return NextResponse.json({error:'AI scanning is disabled. Use barcode decoding or title and issue search.',code:'ai_scanning_disabled'},{status:410})}
export const POST=GET;
