// ============================================================
// Bnerd: verify the sign-in token the staff Portal issues (HS256).
//
// Pure — no I/O, so it's unit-testable without Next plumbing. Payload
// mints the token for a signed-in staff member; see docs/bnerd.md for
// the contract. Single use is enforced by /api/sso, not here.
// ============================================================

import { createHmac, timingSafeEqual } from 'node:crypto';

export const SSO_ISSUER = 'bnerd-portal';
export const SSO_AUDIENCE = 'wacrm';

/** Longest lifetime accepted, so a stolen secret can't mint a long-lived link. */
export const MAX_TOKEN_TTL_SECONDS = 120;

export type SsoRole = 'admin' | 'agent';

export interface SsoClaims {
  sub: string;
  email: string;
  name: string;
  role: SsoRole;
  jti: string;
  exp: number;
}

export class SsoTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SsoTokenError';
  }
}

function decodeJson(segment: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
    if (value && typeof value === 'object') return value as Record<string, unknown>;
  } catch {
    // Reported below.
  }
  throw new SsoTokenError('Malformed token');
}

const isText = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

/** Returns the token's claims, or throws `SsoTokenError` if it can't be trusted. */
export function verifySsoToken(
  token: string,
  secret: string,
  nowSeconds = Date.now() / 1000
): SsoClaims {
  const parts = token.split('.');
  if (parts.length !== 3) throw new SsoTokenError('Malformed token');
  const [header, payload, signature] = parts;

  // Fixed to HS256: never let the token choose its own algorithm.
  if (decodeJson(header).alg !== 'HS256') throw new SsoTokenError('Unsupported algorithm');

  const expected = createHmac('sha256', secret).update(`${header}.${payload}`).digest();
  const given = Buffer.from(signature, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    throw new SsoTokenError('Bad signature');
  }

  const { iss, aud, sub, email, name, role, jti, exp } = decodeJson(payload);
  if (iss !== SSO_ISSUER || aud !== SSO_AUDIENCE) throw new SsoTokenError('Wrong issuer or audience');
  if (typeof exp !== 'number' || exp <= nowSeconds) throw new SsoTokenError('Token expired');
  if (exp > nowSeconds + MAX_TOKEN_TTL_SECONDS) throw new SsoTokenError('Token lifetime too long');
  if (!isText(sub) || !isText(email) || !isText(jti)) throw new SsoTokenError('Missing claims');
  if (role !== 'admin' && role !== 'agent') throw new SsoTokenError('Unknown role');

  return { sub, email, name: isText(name) ? name : email, role, jti, exp };
}
