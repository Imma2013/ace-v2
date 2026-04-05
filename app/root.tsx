import type { LinksFunction } from '@remix-run/node';
import { Links, Meta, Outlet, Scripts, ScrollRestoration } from '@remix-run/react';
import tailwindReset from '@unocss/reset/tailwind-compat.css?url';
import { stripIndents } from './utils/stripIndent';
import { useEffect, useState } from 'react';

import reactToastifyStyles from 'react-toastify/dist/ReactToastify.css?url';
import globalStyles from './styles/index.scss?url';
import xtermStyles from '@xterm/xterm/css/xterm.css?url';

import 'virtual:uno.css';

export const links: LinksFunction = () => [
  {
    rel: 'icon',
    href: '/favicon.svg',
    type: 'image/svg+xml',
  },
  { rel: 'stylesheet', href: reactToastifyStyles },
  { rel: 'stylesheet', href: tailwindReset },
  { rel: 'stylesheet', href: globalStyles },
  { rel: 'stylesheet', href: xtermStyles },
  {
    rel: 'preconnect',
    href: 'https://fonts.googleapis.com',
  },
  {
    rel: 'preconnect',
    href: 'https://fonts.gstatic.com',
    crossOrigin: 'anonymous',
  },
  {
    rel: 'stylesheet',
    href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',
  },
];

const inlineThemeCode = stripIndents`
  setTutorialKitTheme();

  function setTutorialKitTheme() {
    let theme = localStorage.getItem('bolt_theme');

    if (!theme) {
      theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }

    document.querySelector('html')?.setAttribute('data-theme', theme);
  }
`;

export function Layout({ children }: { children: React.ReactNode }) {
  const [Providers, setProviders] =
    useState<React.ComponentType<{ children: React.ReactNode }> | null>(null);

  useEffect(() => {
    import('~/components/root/ClientProviders.client')
      .then((module) => {
        setProviders(() => module.ClientProviders);
      })
      .catch(() => {
        setProviders(null);
      });
  }, []);

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
        <script dangerouslySetInnerHTML={{ __html: inlineThemeCode }} />
      </head>
      <body>
        {Providers ? <Providers>{children}</Providers> : children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  useEffect(() => {
    import('./lib/stores/logs')
      .then(({ logStore }) => {
        logStore.logSystem('Application initialized', {
          platform: navigator.platform,
          userAgent: navigator.userAgent,
          timestamp: new Date().toISOString(),
        });

        return import('./utils/debugLogger').then(({ debugLogger }) => {
          const status = debugLogger.getStatus();
          logStore.logSystem('Debug logging ready', {
            initialized: status.initialized,
            capturing: status.capturing,
            enabled: status.enabled,
          });
        });
      })
      .catch(() => {
        // Client-only bootstrap is best-effort on hosted platforms.
      });
  }, []);

  return (
    <Outlet />
  );
}

