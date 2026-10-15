import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: { remotePatterns: [
    { protocol: 'https', hostname: 'www.comics.org', pathname: '/**' },
    { protocol: 'https', hostname: 'files1.comics.org', pathname: '/**' },
    { protocol: 'https', hostname: 'files2.comics.org', pathname: '/**' },
    { protocol: 'https', hostname: 'cdn.marvel.com', pathname: '/**' },
    { protocol: 'https', hostname: 'i.annihil.us', pathname: '/**' },
    { protocol: 'https', hostname: 'covers.openlibrary.org', pathname: '/**' },
    { protocol: 'https', hostname: 'static.metron.cloud', pathname: '/**' },
  ] },
  serverExternalPackages: ['pg', 'better-auth'],
  outputFileTracingIncludes: { '/**': ['./certificates/rds-ca.pem'] },
  async redirects() {
    const origin=process.env.BETTER_AUTH_URL;
    // Keep account cookies, CSRF origin checks and checkout returns on the
    // existing canonical production domain when Vercel adds its short alias.
    if(process.env.VERCEL_ENV==='production'&&origin&&/^https:\/\/[a-z0-9.-]+$/i.test(origin)&&origin!=='https://comichuddle.vercel.app')return [{source:'/:path*',has:[{type:'host' as const,value:'comichuddle.vercel.app'}],destination:origin+'/:path*',permanent:false}];
    return [];
  },
  async headers() {
    return [{ source: '/:path*', headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'same-origin' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
    ] }];
  },
};

export default nextConfig;
