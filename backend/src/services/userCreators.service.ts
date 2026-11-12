import { query } from '../database/connection';
import { matchCreatorForUser, type CreatorOption } from '../utils/creatorMatch';
import { listCreatorOptions } from './sapUsers.service';

/**
 * The "Created by" a COD user opens the Documents page with. An administrator can set which SAP user (NIK) an account is (Users > Edit user, table
 * commercial_user_creators, migration 264); that wins. Without it the name is matched (utils/creatorMatch.ts). Either way it is only a default the person can change.
 */

export async function getUserCreatorMapping(userId: string): Promise<string | null> {
  const r = await query('SELECT sap_user_id FROM commercial_user_creators WHERE user_id = $1::uuid', [userId]);
  return r.rows[0] ? String(r.rows[0].sap_user_id) : null;
}

/** Sets (or, with null, clears) the SAP user of an account. */
export async function setUserCreatorMapping(userId: string, sapUserId: string | null, setBy: string | null): Promise<void> {
  if (!sapUserId) {
    await query('DELETE FROM commercial_user_creators WHERE user_id = $1::uuid', [userId]);
    return;
  }
  await query(
    `INSERT INTO commercial_user_creators (user_id, sap_user_id, set_by) VALUES ($1::uuid, $2, $3::uuid)
     ON CONFLICT (user_id) DO UPDATE SET sap_user_id = EXCLUDED.sap_user_id, set_by = EXCLUDED.set_by, set_at = CURRENT_TIMESTAMP`,
    [userId, sapUserId, setBy],
  );
}

/** The name-based default only (no stored mapping): the SAP user whose name is this account's name, when exactly one is. */
export async function matchCreatorByName(person: { email?: string | null; fullName?: string | null }, options?: CreatorOption[]): Promise<CreatorOption | null> {
  const all = options ?? (await listCreatorOptions());
  return matchCreatorForUser(person, all.filter((o) => o.name !== o.userId));
}

/** The creator to pre-select for an account: the administrator's mapping first, then the name match. `source` says which one decided. */
export async function resolveCreatorForUser(
  userId: string,
  person: { email?: string | null; fullName?: string | null },
): Promise<{ creator: CreatorOption | null; source: 'mapping' | 'name' | null }> {
  const options = await listCreatorOptions();
  const mapped = await getUserCreatorMapping(userId);
  if (mapped) {
    const hit = options.find((o) => o.userId === mapped);
    return { creator: hit ?? { userId: mapped, name: mapped }, source: 'mapping' };
  }
  const byName = await matchCreatorByName(person, options);
  return { creator: byName, source: byName ? 'name' : null };
}
