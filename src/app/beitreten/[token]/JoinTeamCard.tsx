'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { t } from '@/lib/i18n';

export function JoinTeamCard({ token, teamName, valid }: { token: string; teamName: string | null; valid: boolean }) {
  const [status, setStatus] = useState<'idle' | 'joining' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const router = useRouter();

  if (!valid) {
    return (
      <div className="card text-center">
        <p className="text-base font-semibold text-neutral-900">{t('team.joinPrompt.invalid')}</p>
      </div>
    );
  }

  async function handleJoin() {
    setStatus('joining');
    const supabase = createClient();
    const { data, error } = await supabase.rpc('redeem_team_invite', { p_token: token });
    const result = Array.isArray(data) ? data[0] : data;

    if (error) {
      setStatus('error');
      setMessage(t('team.joinPrompt.invalid'));
      return;
    }

    setStatus('done');
    setMessage(result?.already_member ? t('team.joinPrompt.alreadyMember') : t('team.joinPrompt.success'));
    setTimeout(() => router.push('/team'), 1200);
  }

  return (
    <div className="card flex flex-col items-center gap-4 text-center">
      <h1 className="text-xl font-bold text-neutral-900">{t('team.joinPrompt.title', { teamName: teamName || '' })}</h1>
      <p className="text-sm text-neutral-500">{t('team.joinPrompt.description')}</p>

      {message && <p className="text-sm font-medium text-emerald-400">{message}</p>}

      {status !== 'done' && (
        <button onClick={handleJoin} disabled={status === 'joining'} className="btn-primary w-full">
          {status === 'joining' ? t('common.loading') : t('team.joinPrompt.action')}
        </button>
      )}
    </div>
  );
}
