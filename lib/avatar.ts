// Member profile pictures (migration 033: ch_web.profile_avatars). Every read is tolerant: if the
// table is missing (database not migrated yet) members simply show their initial.
import {getPool} from '../db/postgres';

export const avatarUrlFor = (avatarId: string | null | undefined) => avatarId ? '/api/avatar?id=' + avatarId : null;

/** profileId → avatar URL for the given profiles (only those that have a picture). */
export async function avatarUrls(profileIds: readonly string[]): Promise<Map<string, string>> {
  const ids = [...new Set(profileIds.filter(Boolean))];
  const out = new Map<string, string>();
  if (!ids.length) return out;
  try {
    const result = await getPool().query<{profile_id: string; avatar_id: string}>('SELECT profile_id, avatar_id FROM ch_web.profile_avatars WHERE profile_id = ANY($1::text[])', [ids]);
    for (const row of result.rows) out.set(row.profile_id, avatarUrlFor(row.avatar_id)!);
  } catch { /* table not migrated yet */ }
  return out;
}

export async function avatarUrlForProfile(profileId: string | null | undefined) {
  if (!profileId) return null;
  return (await avatarUrls([profileId])).get(profileId) || null;
}

export async function avatarUrlForUser(userId: string) {
  try {
    const result = await getPool().query<{avatar_id: string}>('SELECT avatar_id FROM ch_web.profile_avatars WHERE user_id = $1 LIMIT 1', [userId]);
    return avatarUrlFor(result.rows[0]?.avatar_id);
  } catch { return null; }
}
