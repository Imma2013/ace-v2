import { json, type MetaFunction } from '@remix-run/node';
import { lazy, Suspense } from 'react';
import { ClientOnly } from 'remix-utils/client-only';
import { Header } from '~/components/header/Header';
import BackgroundRays from '~/components/ui/BackgroundRays';

const Chat = lazy(() => import('~/components/chat/Chat.client').then((module) => ({ default: module.Chat })));

export const meta: MetaFunction = () => {
  return [{ title: 'Bolt' }, { name: 'description', content: 'Talk with Bolt, an AI assistant from StackBlitz' }];
};

export const loader = () => json({});

function LandingFallback() {
  return (
    <div className="flex flex-1 items-center justify-center px-6">
      <div className="w-full max-w-2xl rounded-2xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2/80 p-8 shadow-lg backdrop-blur">
        <div className="space-y-4">
          <div className="h-4 w-28 rounded bg-bolt-elements-background-depth-3" />
          <div className="h-12 w-full rounded-xl bg-bolt-elements-background-depth-3" />
          <div className="h-28 w-full rounded-xl bg-bolt-elements-background-depth-3" />
        </div>
      </div>
    </div>
  );
}

/**
 * Landing page component for Bolt
 * Note: Settings functionality should ONLY be accessed through the sidebar menu.
 * Do not add settings button/panel to this landing page as it was intentionally removed
 * to keep the UI clean and consistent with the design system.
 */
export default function Index() {
  return (
    <div className="flex flex-col h-full w-full bg-bolt-elements-background-depth-1">
      <BackgroundRays />
      <Header />
      <ClientOnly fallback={<LandingFallback />}>
        {() => (
          <Suspense fallback={<LandingFallback />}>
            <Chat />
          </Suspense>
        )}
      </ClientOnly>
    </div>
  );
}

