import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { MAX_TOKEN_TTL_SECONDS, SsoTokenError, verifySsoToken } from './token';

const SECRET = 'test-secret';
const NOW = 1_800_000_000;

const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

function sign(claims: Record<string, unknown>, { secret = SECRET, alg = 'HS256' } = {}) {
  const body = `${encode({ alg, typ: 'JWT' })}.${encode(claims)}`;
  const signature = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${signature}`;
}

const claims = {
  iss: 'bnerd-portal',
  aud: 'wacrm',
  sub: 'user-1',
  email: 'sales@bnerd.local',
  name: 'Sales Agent',
  role: 'agent',
  jti: 'jti-1',
  exp: NOW + 60,
};

describe('verifySsoToken', () => {
  it('returns the claims of a good token', () => {
    expect(verifySsoToken(sign(claims), SECRET, NOW)).toMatchObject({
      sub: 'user-1',
      email: 'sales@bnerd.local',
      role: 'agent',
      jti: 'jti-1',
    });
  });

  it('falls back to the email when the name is empty', () => {
    expect(verifySsoToken(sign({ ...claims, name: '' }), SECRET, NOW).name).toBe('sales@bnerd.local');
  });

  it.each([
    ['a wrong secret', () => sign(claims, { secret: 'other' })],
    ['a tampered payload', () => {
      const [header, , signature] = sign(claims).split('.');
      return `${header}.${encode({ ...claims, role: 'admin' })}.${signature}`;
    }],
    ['another algorithm', () => sign(claims, { alg: 'none' })],
    ['an expired token', () => sign({ ...claims, exp: NOW - 1 })],
    ['a lifetime past the limit', () => sign({ ...claims, exp: NOW + MAX_TOKEN_TTL_SECONDS + 1 })],
    ['another issuer', () => sign({ ...claims, iss: 'someone-else' })],
    ['another audience', () => sign({ ...claims, aud: 'other' })],
    ['an owner role', () => sign({ ...claims, role: 'owner' })],
    ['no jti', () => sign({ ...claims, jti: '' })],
    ['garbage', () => 'not-a-token'],
  ])('refuses %s', (_label, token) => {
    expect(() => verifySsoToken(token(), SECRET, NOW)).toThrow(SsoTokenError);
  });
});
