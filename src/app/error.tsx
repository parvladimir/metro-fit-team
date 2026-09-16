'use client';

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-app flex-col items-center justify-center gap-4 px-6 text-center">
      <span className="text-4xl">⚠️</span>
      <h1 className="text-xl font-bold text-neutral-900">Etwas ist schiefgelaufen</h1>
      <p className="text-sm text-neutral-500">Bitte versuche es erneut.</p>
      <button onClick={() => reset()} className="btn-primary px-6">Erneut versuchen</button>
    </div>
  );
}
