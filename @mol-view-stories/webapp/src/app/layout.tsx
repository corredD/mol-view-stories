'use client';

import 'molstar/build/viewer/molstar.css';
import './globals.css';
import { Inter } from 'next/font/google';
import { Providers } from './providers';
import { Toaster } from '@/components/ui/sonner';
import { DevSyncMount } from '@/components/DevSyncMount';
import { DevSyncListener } from '@/components/DevSyncListener';

const inter = Inter({ subsets: ['latin'] });

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang='en'>
      <title>Mol View Stories</title>
      <body className={inter.className}>
        <Providers>
          {process.env.NEXT_PUBLIC_DEV_API === '1' && (
            <>
              <DevSyncMount />
              <DevSyncListener />
            </>
          )}
          {children}
          <Toaster />
        </Providers>
      </body>
    </html>
  );
}
