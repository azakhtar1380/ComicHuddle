import type { NextConfig } from "next";

// The owner's CloudFront host for copied Metron covers (lib/metron-cover-index.ts validates the same value).
function metronCoverCdnHost(): string | null {
  try { const url = new URL(process.env.METRON_COVER_CDN_BASE || ''); return url.protocol === 'https:' && !url.username && !url.password && !url.port ? url.hostname : null; } catch { return null; }
}
const metronCdnHost = metronCoverCdnHost();

const nextConfig: NextConfig = {
  images: { remotePatterns: [
    { protocol: 'https', hostname: 'www.comics.org', pathname: '/**' },
    { protocol: 'https', hostname: 'files1.comics.org', pathname: '/**' },
    { protocol: 'https', hostname: 'files2.comics.org', pathname: '/**' },
    { protocol: 'https', hostname: 'cdn.marvel.com', pathname: '/**' },
    { protocol: 'https', hostname: 'i.annihil.us', pathname: '/**' },
    { protocol: 'https', hostname: 'covers.openlibrary.org', pathname: '/**' },
    { protocol: 'https', hostname: 'static.metron.cloud', pathname: '/**' },
    ...(metronCdnHost ? [{ protocol: 'https' as const, hostname: metronCdnHost, pathname: '/**' }] : []),
  ] },
  serverExternalPackages: ['pg', 'better-auth', '@electric-sql/pglite'],
  // Local development only: let a phone on the same network load the dev server (e.g. CH_DEV_EXTRA_ORIGINS=http://10.0.0.11:3000).
  allowedDevOrigins: (process.env.CH_DEV_EXTRA_ORIGINS || '').split(',').map(origin => origin.trim().replace(/^https?:\/\//, '').replace(/:\d+$/, '')).filter(Boolean),
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
      { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
      { key: 'Referrer-Policy', value: 'same-origin' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
    ] }];
  },
};

export default nextConfig;
