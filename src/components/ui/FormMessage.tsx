export function FormMessage({ error, success }: { error?: string; success?: string }) {
  if (!error && !success) return null;

  return (
    <div
      className={
        error
          ? 'rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700'
          : 'rounded-xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700'
      }
      role="status"
    >
      {error || success}
    </div>
  );
}
