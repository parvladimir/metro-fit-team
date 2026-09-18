'use client';

import { useEffect, useState } from 'react';
import { appConfig } from '@/lib/config';
import { t } from '@/lib/i18n';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY = 'pwa-install-dismissed';

export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isIos, setIsIos] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(DISMISS_KEY)) return;
    } catch {
      // ignore storage access errors (private browsing, etc.)
    }

    const standalone = window.matchMedia('(display-mode: standalone)').matches;
    if (standalone) return;

    const ua = window.navigator.userAgent;
    const iosDevice = /iphone|ipad|ipod/i.test(ua);
    setIsIos(iosDevice);
    if (iosDevice) setVisible(true);

    function handler(e: Event) {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setVisible(true);
    }

    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  if (!visible) return null;

  function dismiss() {
    setVisible(false);
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      // ignore
    }
  }

  return (
    <div className="card mx-4 mb-3 flex items-center gap-3 !py-3">
      <span className="text-xl">📲</span>
      <div className="flex-1">
        <p className="text-sm font-semibold text-neutral-900">{t('pwa.installTitle', { appName: appConfig.name })}</p>
        <p className="text-xs text-neutral-400">{isIos ? t('pwa.installIos') : t('pwa.installDescription')}</p>
      </div>
      {!isIos && deferredPrompt ? (
        <button
          onClick={async () => {
            await deferredPrompt.prompt();
            dismiss();
          }}
          className="shrink-0 rounded-xl bg-brand px-3 py-2 text-xs font-semibold text-[#00232A]"
        >
          {t('pwa.installAndroid')}
        </button>
      ) : (
        <button onClick={dismiss} className="shrink-0 text-lg text-neutral-400">×</button>
      )}
    </div>
  );
}
