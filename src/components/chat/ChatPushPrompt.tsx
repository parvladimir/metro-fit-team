'use client';

import { useEffect, useState } from 'react';
import { Bell, X } from 'lucide-react';
import { publicEnv } from '@/lib/env';
import { savePushSubscriptionAction } from '@/app/(app)/team/chat/actions';
import { t } from '@/lib/i18n';

const DISMISS_KEY = 'chat-push-dismissed';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

type Status = 'hidden' | 'prompt' | 'ios-install' | 'requesting';

export function ChatPushPrompt() {
  const [status, setStatus] = useState<Status>('hidden');

  useEffect(() => {
    if (!publicEnv.vapidPublicKey) return; // push not configured server-side

    try {
      if (localStorage.getItem(DISMISS_KEY)) return;
    } catch {
      // ignore storage access errors (private browsing, etc.)
    }

    const nav = navigator as Navigator & { standalone?: boolean };
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true;
    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);

    // iOS Safari only supports Web Push for an installed (Home Screen) PWA —
    // showing an "Aktivieren" button that silently does nothing there would
    // be a broken control, so guide toward installing instead.
    if (isIos && !isStandalone) {
      setStatus('ios-install');
      return;
    }

    const supportsPush = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    if (!supportsPush || Notification.permission !== 'default') return;

    setStatus('prompt');
  }, []);

  function dismiss() {
    setStatus('hidden');
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      // ignore
    }
  }

  async function enable() {
    setStatus('requesting');
    try {
      const permission = await Notification.requestPermission();
      if (permission === 'granted' && publicEnv.vapidPublicKey) {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicEnv.vapidPublicKey) as BufferSource,
        });
        const json = subscription.toJSON();
        if (json.endpoint && json.keys?.p256dh && json.keys?.auth) {
          await savePushSubscriptionAction({ endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth });
        }
      }
    } catch {
      // Denied, unsupported mid-flow, or a transient subscribe error — the
      // in-app unread badge still works regardless, so this is non-fatal.
    } finally {
      dismiss();
    }
  }

  if (status === 'hidden') return null;

  return (
    <div className="card mx-4 mt-3 flex shrink-0 items-center gap-3 !py-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand">
        <Bell size={18} strokeWidth={2} />
      </span>
      <div className="flex-1">
        <p className="text-sm font-semibold text-neutral-900">{t('push.chat.title')}</p>
        <p className="text-xs text-neutral-400">{status === 'ios-install' ? t('push.chat.iosInstallHint') : t('push.chat.description')}</p>
      </div>
      {status === 'ios-install' ? (
        <button onClick={dismiss} className="btn-icon shrink-0" aria-label="Schließen">
          <X size={17} strokeWidth={2} />
        </button>
      ) : (
        <button onClick={enable} disabled={status === 'requesting'} className="btn-primary shrink-0 px-3.5 py-2 text-xs">
          {t('push.chat.enable')}
        </button>
      )}
    </div>
  );
}
