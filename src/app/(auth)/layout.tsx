import { appConfig } from '@/lib/config';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="mx-auto flex min-h-screen w-full max-w-app flex-col justify-center bg-[#04141a] px-6 pb-10"
      style={{ paddingTop: 'max(2.5rem, calc(env(safe-area-inset-top) + 1rem))' }}
    >
      <div className="mb-10 flex flex-col items-center gap-2 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand text-2xl font-black text-[#00232A]">
          {appConfig.name.charAt(0)}
        </div>
        <h1 className="text-xl font-bold text-neutral-900">{appConfig.name}</h1>
      </div>
      {children}
    </div>
  );
}
