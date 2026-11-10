import crypto from 'crypto';

/**
 * Which stored record each freshly built group IS (KMAPS partner API: `id` is opaque, issued by KLIP, never changed, never reused).
 *
 * The STO key the Shipments list shows cannot be the identity: an OP- / MNL- shipment gets its STO number later, and a PO moved to its own operation changes
 * the key. What survives such a change is the set of shipments behind the group (member_ids). So a group keeps a record when it still has the same STO key,
 * and otherwise when it shares members with a record nobody else has claimed - the one it shares the most with. A group that matches nothing is a new record.
 * A stored record that no group claims is retired by the caller (deactivated or deleted); it is never handed to a different group.
 */

export interface StoredIdentity {
  record_id: string;
  sto_key: string | null;
  member_ids: string[];
  first_seen_at: Date | string;
}

export interface BuiltIdentity {
  stoKey: string;
  memberIds: string[];
}

export interface IdentityAssignment {
  /** Index into the built list -> the stored record it keeps, or null for a new record. */
  keeps: Array<string | null>;
  /** Stored records no group claimed. */
  unclaimed: string[];
}

export function assignRecordIds(built: BuiltIdentity[], stored: StoredIdentity[]): IdentityAssignment {
  const keeps: Array<string | null> = built.map(() => null);
  const claimed = new Set<string>();

  // Pass 1: the same STO key. The key is unique among live records, so this is one-to-one.
  const byKey = new Map<string, StoredIdentity>();
  for (const s of stored) if (s.sto_key && !byKey.has(s.sto_key)) byKey.set(s.sto_key, s);
  built.forEach((b, i) => {
    const hit = byKey.get(b.stoKey);
    if (hit && !claimed.has(hit.record_id)) {
      keeps[i] = hit.record_id;
      claimed.add(hit.record_id);
    }
  });

  // Pass 2: shared shipments. Largest overlap first, so a merge keeps the record that held most of the group, and a split leaves the new half a new id.
  const owners = new Map<string, StoredIdentity[]>();
  for (const s of stored) for (const m of s.member_ids) owners.set(m, [...(owners.get(m) ?? []), s]);
  const candidates: Array<{ index: number; stored: StoredIdentity; overlap: number }> = [];
  built.forEach((b, i) => {
    if (keeps[i] !== null) return;
    const overlap = new Map<string, { stored: StoredIdentity; n: number }>();
    for (const m of b.memberIds) {
      for (const s of owners.get(m) ?? []) {
        if (claimed.has(s.record_id)) continue;
        const cur = overlap.get(s.record_id);
        overlap.set(s.record_id, { stored: s, n: (cur?.n ?? 0) + 1 });
      }
    }
    for (const { stored: s, n } of overlap.values()) candidates.push({ index: i, stored: s, overlap: n });
  });
  candidates.sort((a, b) => {
    if (b.overlap !== a.overlap) return b.overlap - a.overlap;
    const ta = new Date(a.stored.first_seen_at).getTime();
    const tb = new Date(b.stored.first_seen_at).getTime();
    if (ta !== tb) return ta - tb;
    return a.stored.record_id < b.stored.record_id ? -1 : 1;
  });
  for (const c of candidates) {
    if (keeps[c.index] !== null || claimed.has(c.stored.record_id)) continue;
    keeps[c.index] = c.stored.record_id;
    claimed.add(c.stored.record_id);
  }

  return { keeps, unclaimed: stored.filter((s) => !claimed.has(s.record_id)).map((s) => s.record_id) };
}

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** A new opaque id: `shp_` and ten random characters. The caller retries on the (astronomically unlikely) primary key clash. */
export function newRecordId(): string {
  const bytes = crypto.randomBytes(10);
  let out = 'shp_';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}
