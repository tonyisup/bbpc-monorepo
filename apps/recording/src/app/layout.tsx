import type { Metadata } from 'next';
import { ConvexClientProvider } from '@/components/ConvexClientProvider';
import './globals.css';

export const metadata: Metadata = {
  title: 'Podcast Studio',
  description: 'Session dashboard for podcast recording coordination',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen overflow-hidden">
        <ConvexClientProvider>{children}</ConvexClientProvider>
      </body>
    </html>
  );
}
