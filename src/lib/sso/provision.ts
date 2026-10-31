// ============================================================
// Bnerd: make sure a staff member has a wacrm user in the shared
// account before /api/sso signs them in.
//
// Staff have no wacrm invitations: the Portal decides who gets in, so
// the first sign-in creates the user. The signup trigger gives every
// new user a personal account as owner; a Bnerd deployment has one
// shared account, so that stray account is removed straight away.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import type { SsoClaims } from './token';

interface ProfileRow {
  user_id: string;
  account_id: string | null;
  account_role: string | null;
}

async function findProfile(db: SupabaseClient, email: string) {
  const { data, error } = await db
    .from('profiles')
    .select('user_id, account_id, account_role')
    .eq('email', email)
    .maybeSingle();
  if (error) throw new Error(`Profile lookup failed: ${error.message}`);
  return data as ProfileRow | null;
}

/** Idempotent: run on every sign-in, so a role change in the Portal takes effect. */
export async function provisionSsoUser(
  db: SupabaseClient,
  claims: Pick<SsoClaims, 'email' | 'name' | 'role'>,
  accountId: string
): Promise<string> {
  const email = claims.email.trim().toLowerCase();

  let profile = await findProfile(db, email);
  const created = !profile;
  if (!profile) {
    const { error } = await db.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { full_name: claims.name },
    });
    if (error) throw new Error(`User creation failed: ${error.message}`);
    profile = await findProfile(db, email);
    if (!profile) throw new Error('The signup trigger created no profile');
  }

  // Whoever owns the account stays its owner, whatever the Portal says.
  const inAccount = profile.account_id === accountId;
  if (inAccount && (profile.account_role === 'owner' || profile.account_role === claims.role)) {
    return profile.user_id;
  }

  const { error } = await db
    .from('profiles')
    .update({ account_id: accountId, account_role: claims.role })
    .eq('user_id', profile.user_id);
  if (error) throw new Error(`Profile update failed: ${error.message}`);

  // Only the account this call just caused: an older one may hold real data.
  if (created && profile.account_id && !inAccount) {
    const { error: removeError } = await db
      .from('accounts')
      .delete()
      .eq('id', profile.account_id)
      .eq('owner_user_id', profile.user_id);
    if (removeError) console.error('[sso] stray account not removed:', removeError.message);
  }

  return profile.user_id;
}
