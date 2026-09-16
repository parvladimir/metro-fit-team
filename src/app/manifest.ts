import type { MetadataRoute } from 'next';
import { appConfig } from '@/lib/config';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: appConfig.name,
    short_name: appConfig.name,
    description: `${appConfig.name} — Trainingsplan, Fortschritt und Team-Ranglisten.`,
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#0B0D10',
    theme_color: '#FF5A1F',
    orientation: 'portrait',
    lang: 'de',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
