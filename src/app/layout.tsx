import type { Metadata, Viewport } from 'next';
import { appConfig } from '@/lib/config';
import { ServiceWorkerRegister } from '@/components/pwa/ServiceWorkerRegister';
import './globals.css';

export const metadata: Metadata = {
  title: appConfig.name,
  description: `${appConfig.name} — Trainingsplan, Fortschritt und Team-Ranglisten für dein Fitnessteam.`,
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: appConfig.name,
  },
  icons: {
    icon: [{ url: '/favicon.png' }, { url: '/icons/icon-192.png', sizes: '192x192' }],
    apple: '/icons/apple-touch-icon.png',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
  themeColor: '#FF5A1F',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <body>
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
