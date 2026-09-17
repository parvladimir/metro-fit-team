import { SignInForm } from './SignInForm';

export default async function AnmeldenPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return <SignInForm next={next || '/'} />;
}
