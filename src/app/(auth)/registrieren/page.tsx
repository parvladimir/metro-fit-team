import { RegistrationForm } from './RegistrationForm';

export default async function RegistrierenPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return <RegistrationForm next={next || '/'} />;
}
