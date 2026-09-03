import type { Metadata, Viewport } from 'next';
import './globals.css';
import './clock-fonts.css';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.SITE_URL || 'http://localhost:3000'),
  title: 'Clock',
  description: 'Time, weather and local departures.',
  openGraph: {
    title: 'Clock',
    description: 'Time, weather and local departures.',
    images: [{ url: '/og.png', width: 1536, height: 1024, alt: 'Clock — time and weather' }],
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Clock',
    description: 'Time, weather and local departures.',
    images: ['/og.png'],
  },
  icons: { icon: '/favicon.svg' },
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#111113' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
