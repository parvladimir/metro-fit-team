import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { RECOVERY_INVALID_MESSAGE } from '@/lib/recovery';
import { ResetPasswordForm } from './ResetPasswordForm';

export default async function PasswortZuruecksetzenPage({ searchParams }: { searchParams: Promise<{ fehler?: string }> }) {
  const { fehler } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || fehler) {
    return (
      <div className="flex flex-col gap-5 text-center">
        <h2 className="text-2xl font-bold text-neutral-900">Link ungültig</h2>
        <p className="rounded-xl bg-red-500/15 px-4 py-3 text-sm font-medium text-red-400" role="status">
          {RECOVERY_INVALID_MESSAGE}
        </p>
        <Link href="/passwort-vergessen" className="btn-primary">
          Neuen Link anfordern
        </Link>
        <Link href="/anmelden" className="text-sm font-semibold text-brand">
          Zur Anmeldung
        </Link>
      </div>
    );
  }

  return <ResetPasswordForm />;
}
