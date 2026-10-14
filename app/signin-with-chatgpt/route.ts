import { NextResponse } from 'next/server';
export function GET(request: Request) {
  const incoming = new URL(request.url), target = new URL('/sign-in', incoming.origin);
  target.searchParams.set('return_to', incoming.searchParams.get('return_to') || '/');
  return NextResponse.redirect(target);
}
