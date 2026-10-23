'use client';

import 'molstar/build/viewer/molstar.css';
import './globals.css';
import { Inter } from 'next/font/google';
import { Providers } from './providers';
import { Toaster } from '@/components/ui/sonner';
import { DevSyncGate } from '@/components/DevSyncGate';

const inter = Inter({ subsets: ['latin'] });

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang='en'>
      <title>Mol View Stories</title>
      <body className={inter.className}>
        <Providers>
          {process.env.NEXT_PUBLIC_DEV_API === '1' && <DevSyncGate />}
          {children}
          <Toaster />
        </Providers>
      </body>
    </html>
  );
}
