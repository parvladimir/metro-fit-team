'use client';

import { AlertTriangle } from 'lucide-react';

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-app flex-col items-center justify-center gap-4 px-6 text-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-red-500/10 text-red-400">
        <AlertTriangle size={30} strokeWidth={1.75} />
      </span>
      <h1 className="text-xl font-bold text-neutral-900">Etwas ist schiefgelaufen</h1>
      <p className="text-sm text-neutral-500">Bitte versuche es erneut.</p>
      <button onClick={() => reset()} className="btn-primary px-6">Erneut versuchen</button>
    </div>
  );
}
