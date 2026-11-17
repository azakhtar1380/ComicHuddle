// Clean profile links: comichuddle.com/@handle renders app/profile/[handle]. Hidden, moderated or unknown
// profiles are answered here with a real 404 (the page itself streams, so it could only send 200).
import {NextResponse,type NextRequest} from 'next/server';

const HANDLE=/^\/@([a-z][a-z0-9_]{2,23})\/?$/i;
const INTERNAL=/^\/profile\/([^/]+)\/?$/;
export async function proxy(request:NextRequest){
 // The internal page path always goes through the checked clean link.
 const internal=INTERNAL.exec(request.nextUrl.pathname);
 if(internal)return NextResponse.redirect(new URL('/@'+encodeURIComponent(internal[1])+request.nextUrl.search,request.url));
 const match=HANDLE.exec(request.nextUrl.pathname);
 if(!match)return NextResponse.rewrite(new URL('/profile-not-found',request.url));
 const handle=match[1].toLowerCase(),check=new URL('/api/profile-status?handle='+handle,request.url);
 let status=503,moved='';
 try{const r=await fetch(check,{headers:{cookie:request.headers.get('cookie')||''},cache:'no-store'});status=r.status;moved=r.headers.get('x-current-handle')||''}catch{/* fall through to the page, which checks again */}
 // A handle changed in the last 90 days: send old links to the new one.
 if(status===410&&/^[a-z][a-z0-9_]{2,23}$/.test(moved))return NextResponse.redirect(new URL('/@'+moved+request.nextUrl.search,request.url),308);
 if(status===404)return NextResponse.rewrite(new URL('/profile-not-found',request.url));
 return NextResponse.rewrite(new URL('/profile/'+handle+request.nextUrl.search,request.url));
}
export const config={matcher:['/(@.*)','/profile/:path*']};
