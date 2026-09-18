import Link from 'next/link';
import { Compass } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-app flex-col items-center justify-center gap-4 px-6 text-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-neutral-150 text-neutral-400">
        <Compass size={30} strokeWidth={1.75} />
      </span>
      <h1 className="text-xl font-bold text-neutral-900">Seite nicht gefunden</h1>
      <p className="text-sm text-neutral-500">Diese Seite existiert nicht oder wurde verschoben.</p>
      <Link href="/" className="btn-primary px-6">Zur Startseite</Link>
    </div>
  );
}
