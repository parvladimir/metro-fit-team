import { BackLink } from '@/components/ui/BackLink';
import { CustomExerciseForm } from './CustomExerciseForm';

export default async function NeueUebungPage({ searchParams }: { searchParams: Promise<{ returnTo?: string }> }) {
  const { returnTo } = await searchParams;
  const back = returnTo && /^\/(plan|aktivitaet)\/[A-Za-z0-9/_-]*$/.test(returnTo) ? returnTo : '/plan';

  return (
    <div className="screen-padding flex flex-col gap-4 pb-8">
      <div className="flex items-center gap-3">
        <BackLink href={back} />
        <h1 className="min-w-0 text-xl font-bold text-neutral-900">Eigene Übung erstellen</h1>
      </div>
      <p className="text-sm text-neutral-500">
        Deine Übung ist nur für dich sichtbar und steht dir künftig im Übungskatalog zur Verfügung.
      </p>
      <CustomExerciseForm returnTo={back} />
    </div>
  );
}
