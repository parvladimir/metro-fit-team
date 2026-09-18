'use server';

import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { ensureInitialAdminBootstrap } from '@/lib/server/bootstrap';
import { publicEnv } from '@/lib/env';
import { PENDING_INVITE_COOKIE, resolveEffectiveNext } from '@/lib/pending-invite';
import { waitUntil } from '@vercel/functions';
import { isEmailConfigured } from '@/lib/server/mail';
import { sendRecoveryEmail } from '@/lib/server/recovery-mail';
import { RECOVERY_INVALID_MESSAGE, RECOVERY_REQUEST_MESSAGE, isPlausibleEmail } from '@/lib/recovery';

export type AuthActionState = { error?: string; success?: string } | undefined;

export async function signInAction(_prev: AuthActionState, formData: FormData): Promise<AuthActionState> {
  const email = String(formData.get('email') || '').trim();
  const password = String(formData.get('password') || '');
  const next = String(formData.get('next') || '/');

  if (!email || !password) {
    return { error: 'Bitte E-Mail und Passwort eingeben.' };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !data.user) {
    return { error: 'Anmeldung fehlgeschlagen. Bitte E-Mail und Passwort prüfen.' };
  }

  await ensureInitialAdminBootstrap(data.user.id, data.user.email);

  const cookieStore = await cookies();
  const pendingInviteToken = cookieStore.get(PENDING_INVITE_COOKIE)?.value;
  redirect(resolveEffectiveNext(next, pendingInviteToken));
}

export async function signUpAction(_prev: AuthActionState, formData: FormData): Promise<AuthActionState> {
  const email = String(formData.get('email') || '').trim();
  const password = String(formData.get('password') || '');
  const confirmPassword = String(formData.get('confirmPassword') || '');
  const fullName = String(formData.get('fullName') || '').trim();
  const next = String(formData.get('next') || '/');

  if (!email || !password || !fullName) {
    return { error: 'Bitte alle Felder ausfüllen.' };
  }
  if (password.length < 8) {
    return { error: 'Das Passwort muss mindestens 8 Zeichen lang sein.' };
  }
  if (password !== confirmPassword) {
    return { error: 'Die Passwörter stimmen nicht überein.' };
  }

  const cookieStore = await cookies();
  const pendingInviteToken = cookieStore.get(PENDING_INVITE_COOKIE)?.value;
  const effectiveNext = resolveEffectiveNext(next, pendingInviteToken);

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName },
      emailRedirectTo: `${publicEnv.appUrl}/auth/callback?next=${encodeURIComponent(effectiveNext)}`,
    },
  });

  if (error) {
    return { error: error.message.includes('already registered') ? 'Diese E-Mail-Adresse ist bereits registriert.' : 'Registrierung fehlgeschlagen.' };
  }

  return { success: 'Fast geschafft! Bitte bestätige deine E-Mail-Adresse über den Link, den wir dir geschickt haben.' };
}

export async function forgotPasswordAction(_prev: AuthActionState, formData: FormData): Promise<AuthActionState> {
  const email = String(formData.get('email') || '').trim();
  if (!email) return { error: 'Bitte E-Mail-Adresse eingeben.' };

  // Same response for every well-formed address — never reveal whether an
  // account exists. The work runs after the response so timing is uniform.
  if (isPlausibleEmail(email)) {
    if (isEmailConfigured()) {
      // Own recovery link (token_hash → /auth/confirm): works across devices.
      waitUntil(sendRecoveryEmail(email));
    } else {
      const supabase = await createClient();
      await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${publicEnv.appUrl}/auth/callback?next=/passwort-zuruecksetzen`,
      });
    }
  }

  return { success: RECOVERY_REQUEST_MESSAGE };
}

export async function resetPasswordAction(_prev: AuthActionState, formData: FormData): Promise<AuthActionState> {
  const password = String(formData.get('password') || '');
  const confirmPassword = String(formData.get('confirmPassword') || '');

  if (password.length < 8) return { error: 'Das Passwort muss mindestens 8 Zeichen lang sein.' };
  if (password !== confirmPassword) return { error: 'Die Passwörter stimmen nicht überein.' };

  const supabase = await createClient();
  // Only a valid (recovery) session may change the password.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: RECOVERY_INVALID_MESSAGE };

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    const same = /same|different from the old/i.test(error.message);
    return { error: same ? 'Das neue Passwort muss sich vom bisherigen unterscheiden.' : 'Passwort konnte nicht aktualisiert werden. Bitte fordere einen neuen Link an.' };
  }

  // End the temporary recovery session; the user signs in with the new password.
  await supabase.auth.signOut();
  redirect('/anmelden?passwort=geaendert');
}

export async function signOutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/anmelden');
}
