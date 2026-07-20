import type { Metadata } from 'next';

import { AuthGate } from '@/components/auth/auth-gate';
import { LocaleProvider } from '@/components/i18n/locale-provider';

import { appFontClassName } from './fonts';
import './globals.css';

export const metadata: Metadata = {
  title: 'Open Image Generator',
  description: 'Generate and compare images across multiple AI providers.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body className={appFontClassName}>
        <LocaleProvider>
          <AuthGate>{children}</AuthGate>
        </LocaleProvider>
      </body>
    </html>
  );
}
