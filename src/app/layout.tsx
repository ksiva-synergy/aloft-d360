import type { Metadata } from 'next';
import ThemeProvider from '@/components/providers/ThemeProvider';
import AuthSessionProvider from '@/components/providers/SessionProvider';
import './globals.css';

export const metadata: Metadata = {
  title: 'Agent Lab — Spinor Labs',
  description: 'Design, stage, and operate AI agent pipelines. Powered by ALOFT.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning className="h-full">
      <head>
        <meta charSet="utf-8" />
        <meta name="color-scheme" content="dark light" />
        {/* Blocking script: reads localStorage before first paint to avoid theme flash */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var d=document.documentElement,t=localStorage.getItem('theme'),isDark=t==='dark'||(t==='system'||!t)&&window.matchMedia('(prefers-color-scheme: dark)').matches;d.classList.add(isDark?'dark':'light');d.style.colorScheme=isDark?'dark':'light'}catch(e){}})();`,
          }}
        />
      </head>
      <body className="h-full bg-[var(--background)] text-[var(--foreground)] antialiased">
        <ThemeProvider>
          <AuthSessionProvider>
            {children}
          </AuthSessionProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
