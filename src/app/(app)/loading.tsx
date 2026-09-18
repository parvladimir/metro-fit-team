export default function Loading() {
  return (
    <div className="screen-padding flex animate-pulse flex-col gap-4 pb-4">
      <div className="h-7 w-40 rounded-full bg-neutral-100" />
      <div className="h-64 rounded-3xl bg-neutral-100" />
      <div className="grid grid-cols-2 gap-3">
        <div className="h-28 rounded-3xl bg-neutral-100" />
        <div className="h-28 rounded-3xl bg-neutral-100" />
      </div>
      <div className="h-24 rounded-3xl bg-neutral-100" />
    </div>
  );
}
