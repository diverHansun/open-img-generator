import type { Metadata } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: 'Open Image Generator',
  description: 'Generate and compare images across multiple AI providers.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
