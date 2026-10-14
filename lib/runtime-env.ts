import { getPool } from '../db/postgres';
// Original permission checks remain in the media route. RDS is the bounded
// persistent photo store until an operator configures licensed S3/R2 storage.
const bucket = {
  async put(key: string, bytes: Uint8Array, options?: { httpMetadata?: { contentType?: string } }) {
    if (bytes.byteLength > 4194304) throw new Error('Photo exceeds the upload limit.');
    await getPool().query('INSERT INTO ch_web.photo_bytes (key, body, content_type) VALUES ($1,$2,$3) ON CONFLICT (key) DO UPDATE SET body=EXCLUDED.body,content_type=EXCLUDED.content_type', [key, Buffer.from(bytes), options?.httpMetadata?.contentType || 'image/jpeg']);
  },
  async get(key: string) {
    const result = await getPool().query<{ body: Buffer }>('SELECT body FROM ch_web.photo_bytes WHERE key=$1', [key]);
    return result.rows[0] ? { body: new Uint8Array(result.rows[0].body) } : null;
  },
  async delete(keys: string | string[]) {
    await getPool().query('DELETE FROM ch_web.photo_bytes WHERE key=ANY($1::text[])', [Array.isArray(keys) ? keys : [keys]]);
  },
};
// A Sites service header is never an authentication credential on Vercel.
export const env = { ...process.env, METRON_PRIVATE_SERVICE_ENABLED: 'false', BUCKET: bucket };
