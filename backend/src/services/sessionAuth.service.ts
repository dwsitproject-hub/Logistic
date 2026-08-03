import { Request } from 'express';
import { query } from '../database/connection';
import { fetchUserScopeAssociations } from './userAssociations.service';

export interface SessionUserPayload {
  id: string;
  username: string;
  email: string;
  full_name: string;
  role: string;
  level: string | null;
  transport_type: string | null;
  plant: string | null;
  plants: string[];
  group_plants: string[];
  products: string[];
  is_active: boolean;
  is_first_login: boolean;
}

export async function buildSessionUserPayload(userRow: Record<string, unknown>): Promise<SessionUserPayload> {
  const scope = await fetchUserScopeAssociations(String(userRow.id), userRow.plant as string | null);
  return {
    id: String(userRow.id),
    username: String(userRow.username),
    email: String(userRow.email),
    full_name: String(userRow.full_name),
    role: String(userRow.role),
    level: userRow.level ? String(userRow.level) : null,
    transport_type: userRow.transport_type ? String(userRow.transport_type) : null,
    plant: userRow.plant ? String(userRow.plant) : null,
    plants: scope.plants,
    group_plants: scope.group_plants,
    products: scope.products,
    is_active: Boolean(userRow.is_active),
    is_first_login: Boolean(userRow.is_first_login),
  };
}

export async function loadActiveUserById(userId: string): Promise<Record<string, unknown> | null> {
  const result = await query(
    'SELECT * FROM users WHERE id = $1::uuid AND is_active = true',
    [userId],
  );
  return (result.rows[0] as Record<string, unknown>) ?? null;
}

export async function loadActiveUserByEmail(email: string): Promise<Record<string, unknown> | null> {
  const result = await query(
    'SELECT * FROM users WHERE LOWER(email) = LOWER($1) AND is_active = true',
    [email.trim()],
  );
  return (result.rows[0] as Record<string, unknown>) ?? null;
}

export async function persistHubOidcSub(userId: string, hubSub: string): Promise<void> {
  await query(
    `UPDATE users SET hub_oidc_sub = $1, updated_at = CURRENT_TIMESTAMP
     WHERE id = $2::uuid AND (hub_oidc_sub IS NULL OR hub_oidc_sub = $1)`,
    [hubSub, userId],
  );
}

export function establishSession(req: Request, userId: string): void {
  if (!req.session) return;
  req.session.userId = userId;
  delete req.session.oidcState;
  delete req.session.oidcNonce;
  delete req.session.oidcCodeVerifier;
}

/** Persist session before redirect/JSON — ensures Set-Cookie reaches browser behind nginx. */
export function saveSession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!req.session) {
      resolve();
      return;
    }
    req.session.save((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

export function frontendUrl(): string {
  return String(process.env.FRONTEND_URL || process.env.APP_PUBLIC_ORIGIN || 'http://localhost:3001').replace(
    /\/$/,
    '',
  );
}
