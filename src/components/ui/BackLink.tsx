import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';

export function BackLink({ href }: { href: string }) {
  return (
    <Link href={href} className="btn-icon -ml-2" aria-label="Zurück">
      <ChevronLeft size={22} strokeWidth={2.25} />
    </Link>
  );
}
