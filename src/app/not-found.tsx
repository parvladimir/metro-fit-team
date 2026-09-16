import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-app flex-col items-center justify-center gap-4 px-6 text-center">
      <span className="text-4xl">🧭</span>
      <h1 className="text-xl font-bold text-neutral-900">Seite nicht gefunden</h1>
      <p className="text-sm text-neutral-500">Diese Seite existiert nicht oder wurde verschoben.</p>
      <Link href="/" className="btn-primary px-6">Zur Startseite</Link>
    </div>
  );
}
