import type { Metadata } from 'next';
import { IBM_Plex_Sans_Thai } from 'next/font/google';
import type { ReactNode } from 'react';
import './globals.css';

const plex = IBM_Plex_Sans_Thai({
  weight: ['300', '400', '500', '600', '700'],
  subsets: ['latin', 'thai'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'TasteDraft',
  description: 'Test whether a concept resonates with an audience in a city. The engine scores. A person approves the change.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={plex.className}>
      <body>{children}</body>
    </html>
  );
}
