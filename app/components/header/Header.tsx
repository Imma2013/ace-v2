import { useStore } from '@nanostores/react';
import { lazy, Suspense } from 'react';
import { ClientOnly } from 'remix-utils/client-only';
import { chatStore } from '~/lib/stores/chat';
import { classNames } from '~/utils/classNames';
import { currentApp } from '~/lib/stores/apps';

const HeaderActionButtons = lazy(() =>
  import('./HeaderActionButtons.client').then((module) => ({ default: module.HeaderActionButtons })),
);
const ChatDescription = lazy(() =>
  import('~/lib/persistence/ChatDescription.client').then((module) => ({ default: module.ChatDescription })),
);

export function Header() {
  const chat = useStore(chatStore);
  const managedApp = useStore(currentApp);

  return (
    <header
      className={classNames('flex items-center px-4 border-b h-[var(--header-height)]', {
        'border-transparent': !chat.started,
        'border-bolt-elements-borderColor': chat.started,
      })}
    >
      <div className="flex items-center gap-2 z-logo text-bolt-elements-textPrimary cursor-pointer">
        <div className="i-ph:sidebar-simple-duotone text-xl" />
        <a href="/" className="text-2xl font-semibold text-accent flex items-center">
          {/* <span className="i-bolt:logo-text?mask w-[46px] inline-block" /> */}
          <img src="/logo-light-styled.png" alt="logo" className="w-[90px] inline-block dark:hidden" />
          <img src="/logo-dark-styled.png" alt="logo" className="w-[90px] inline-block hidden dark:block" />
        </a>
      </div>
      {chat.started && ( // Display ChatDescription and HeaderActionButtons only when the chat has started.
        <>
          <div className="flex-1 px-4 min-w-0 text-center text-bolt-elements-textPrimary">
            {managedApp && (
              <div className="flex items-center justify-center gap-2 text-xs text-bolt-elements-textSecondary mb-0.5 truncate">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-bolt-elements-background-depth-2 border border-bolt-elements-borderColor">
                  <span className="i-ph:app-window" />
                  <span className="truncate max-w-[220px]">{managedApp.name}</span>
                </span>
                {managedApp.branch && <span className="truncate">Branch: {managedApp.branch}</span>}
              </div>
            )}
            <span className="truncate block">
              <ClientOnly>{() => <Suspense fallback={null}><ChatDescription /></Suspense>}</ClientOnly>
            </span>
          </div>
          <ClientOnly>
            {() => (
              <div className="">
                <Suspense fallback={null}>
                  <HeaderActionButtons chatStarted={chat.started} />
                </Suspense>
              </div>
            )}
          </ClientOnly>
        </>
      )}
    </header>
  );
}
