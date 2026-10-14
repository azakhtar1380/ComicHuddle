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
