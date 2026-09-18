import { SignInForm } from './SignInForm';

export default async function AnmeldenPage({ searchParams }: { searchParams: Promise<{ next?: string; passwort?: string }> }) {
  const { next, passwort } = await searchParams;
  const notice = passwort === 'geaendert' ? 'Passwort wurde geändert. Bitte melde dich mit deinem neuen Passwort an.' : undefined;
  return <SignInForm next={next || '/'} notice={notice} />;
}
