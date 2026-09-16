'use client';

export function ConfirmSubmitButton({ children, className, confirmMessage }: { children: React.ReactNode; className?: string; confirmMessage: string }) {
  return (
    <button
      type="submit"
      className={className}
      onClick={(e) => {
        if (!window.confirm(confirmMessage)) e.preventDefault();
      }}
    >
      {children}
    </button>
  );
}
