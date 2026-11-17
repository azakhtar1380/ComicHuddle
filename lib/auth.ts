import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { getPool } from '../db/postgres';
import type { Pool } from 'pg';
import { appleEnabled, socialProviders } from './social-auth';

export function authOptions(database: Pool): BetterAuthOptions {
  if (!process.env.BETTER_AUTH_SECRET || process.env.BETTER_AUTH_SECRET.length < 32) throw new Error('Account signing secret is not configured.');
  return {
    appName: 'ComicHuddle', database,
    secret: process.env.BETTER_AUTH_SECRET,
    baseURL: process.env.BETTER_AUTH_URL || undefined,
    trustedOrigins: [process.env.BETTER_AUTH_URL, process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : undefined,
      // Local development only: extra origins such as a phone on the same Wi-Fi.
      ...(process.env.NODE_ENV !== 'production' && process.env.VERCEL !== '1' ? (process.env.CH_DEV_EXTRA_ORIGINS || '').split(',').map(origin => origin.trim()) : []),
      // Apple returns to /api/auth/callback/apple with a form POST from this origin.
      ...(appleEnabled() ? ['https://appleid.apple.com'] : []),
    ].filter((value): value is string => !!value),
    emailAndPassword: { enabled: true, minPasswordLength: 12, maxPasswordLength: 128 },
    // Sign in with Google / Apple (on only when their env vars are set). A social sign-in with the same verified
    // email as an existing account links to it instead of making a second account.
    socialProviders: socialProviders(),
    account: { accountLinking: { enabled: true, allowDifferentEmails: false } },
    session: { expiresIn: 604800, updateAge: 86400 },
    rateLimit: { enabled: true, storage: 'database', window: 60, max: 60,
      customRules: { '/sign-in/email': { window: 60, max: 8 }, '/sign-in/social': { window: 60, max: 10 }, '/sign-up/email': { window: 60, max: 5 } } },
    advanced: { useSecureCookies: process.env.NODE_ENV === 'production', database: { generateId: () => crypto.randomUUID() } },
  };
}
let instance: ReturnType<typeof betterAuth> | undefined;
export function getAuth() { return instance ||= betterAuth(authOptions(getPool())); }
