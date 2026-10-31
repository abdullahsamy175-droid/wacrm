// ============================================================
// GET /api/sso?token=<jwt>&next=/inbox — Bnerd staff sign-in.
//
// The Portal gets a 60-second signed URL from Payload and loads it in
// the iframe. This route checks the token, provisions the user, and
// mints a Supabase session on our cookies by verifying a magic link
// server-side, so nobody sees an email or a password.
//
// Failures answer in plain text rather than redirecting to /login:
// staff have no wacrm password, so a login page in the Portal's frame
// would only mislead them. See docs/bnerd.md.
// ============================================================

import { supabaseAdmin } from '@/lib/flows/admin-client';
import { createClient } from '@/lib/supabase/server';
import { relativeRedirect, safeNextPath } from '@/lib/auth/callback';
import { provisionSsoUser } from '@/lib/sso/provision';
import { SsoTokenError, verifySsoToken } from '@/lib/sso/token';

const DEFAULT_NEXT = '/inbox';

// Session exchange is per-request by definition; never prerender.
export const dynamic = 'force-dynamic';

const refuse = (message: string, status: number) =>
  new Response(message, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });

const isUniqueViolation = (error: { code?: string } | null) => error?.code === '23505';

export async function GET(request: Request) {
  const secret = process.env.WACRM_SSO_SECRET;
  const accountId = process.env.WACRM_SSO_ACCOUNT_ID;
  if (!secret || !accountId) return refuse('Single sign-on is not configured.', 503);

  const { searchParams } = new URL(request.url);
  const db = supabaseAdmin();

  try {
    const claims = verifySsoToken(searchParams.get('token') ?? '', secret);

    await db.from('sso_token_uses').delete().lt('expires_at', new Date().toISOString());
    const { error: useError } = await db.from('sso_token_uses').insert({
      jti: claims.jti,
      expires_at: new Date(claims.exp * 1000).toISOString(),
    });
    if (isUniqueViolation(useError)) return refuse('This sign-in link was already used.', 401);
    if (useError) throw new Error(`Token use not recorded: ${useError.message}`);

    await provisionSsoUser(db, claims, accountId);

    const { data: link, error: linkError } = await db.auth.admin.generateLink({
      type: 'magiclink',
      email: claims.email.trim().toLowerCase(),
    });
    if (linkError) throw new Error(`Magic link failed: ${linkError.message}`);

    const supabase = await createClient();
    const { error: sessionError } = await supabase.auth.verifyOtp({
      type: 'magiclink',
      token_hash: link.properties.hashed_token,
    });
    if (sessionError) throw new Error(`Session failed: ${sessionError.message}`);

    return relativeRedirect(safeNextPath(searchParams.get('next'), DEFAULT_NEXT));
  } catch (err) {
    if (err instanceof SsoTokenError) return refuse('This sign-in link is not valid.', 401);
    console.error('[GET /api/sso]', err);
    return refuse('Sign-in failed. Please try again.', 500);
  }
}
