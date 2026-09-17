export function FormMessage({ error, success }: { error?: string; success?: string }) {
  if (!error && !success) return null;

  return (
    <div
      className={
        error
          ? 'rounded-xl bg-red-500/15 px-4 py-3 text-sm font-medium text-red-400'
          : 'rounded-xl bg-emerald-500/15 px-4 py-3 text-sm font-medium text-emerald-400'
      }
      role="status"
    >
      {error || success}
    </div>
  );
}
