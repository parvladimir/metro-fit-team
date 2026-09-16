'use client';

import { useFormStatus } from 'react-dom';
import clsx from 'clsx';

export function SubmitButton({ children, className }: { children: React.ReactNode; className?: string }) {
  const { pending } = useFormStatus();

  return (
    <button type="submit" disabled={pending} className={clsx('btn-primary w-full', className)}>
      {pending ? 'Wird gesendet…' : children}
    </button>
  );
}
