'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { ensureInitialAdminBootstrap } from '@/lib/server/bootstrap';
import { publicEnv } from '@/lib/env';

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

  redirect(next || '/');
}

export async function signUpAction(_prev: AuthActionState, formData: FormData): Promise<AuthActionState> {
  const email = String(formData.get('email') || '').trim();
  const password = String(formData.get('password') || '');
  const confirmPassword = String(formData.get('confirmPassword') || '');
  const fullName = String(formData.get('fullName') || '').trim();

  if (!email || !password || !fullName) {
    return { error: 'Bitte alle Felder ausfüllen.' };
  }
  if (password.length < 8) {
    return { error: 'Das Passwort muss mindestens 8 Zeichen lang sein.' };
  }
  if (password !== confirmPassword) {
    return { error: 'Die Passwörter stimmen nicht überein.' };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName },
      emailRedirectTo: `${publicEnv.appUrl}/auth/callback`,
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

  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${publicEnv.appUrl}/auth/callback?next=/passwort-zuruecksetzen`,
  });

  // Always return success, even if the email doesn't exist — do not leak
  // whether an account exists for a given address.
  return { success: 'Wenn ein Konto mit dieser E-Mail existiert, haben wir dir einen Link geschickt.' };
}

export async function resetPasswordAction(_prev: AuthActionState, formData: FormData): Promise<AuthActionState> {
  const password = String(formData.get('password') || '');
  const confirmPassword = String(formData.get('confirmPassword') || '');

  if (password.length < 8) return { error: 'Das Passwort muss mindestens 8 Zeichen lang sein.' };
  if (password !== confirmPassword) return { error: 'Die Passwörter stimmen nicht überein.' };

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });

  if (error) return { error: 'Passwort konnte nicht aktualisiert werden. Bitte fordere einen neuen Link an.' };

  return { success: 'Passwort aktualisiert. Du kannst dich jetzt anmelden.' };
}

export async function signOutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/anmelden');
}
