import { atom } from 'nanostores';
import type { ManagedAppRecord } from '~/lib/persistence/db';

export const managedApps = atom<ManagedAppRecord[]>([]);
export const currentApp = atom<ManagedAppRecord | null>(null);

export function setManagedApps(apps: ManagedAppRecord[]) {
  managedApps.set(
    [...apps].sort((a, b) => Number(new Date(b.updatedAt)) - Number(new Date(a.updatedAt))),
  );
}

export function upsertManagedApp(app: ManagedAppRecord) {
  const next = managedApps
    .get()
    .filter((entry) => entry.id !== app.id)
    .concat(app);

  setManagedApps(next);
}

export function removeManagedAppsForChat(chatId: string) {
  managedApps.set(managedApps.get().filter((app) => app.chatId !== chatId));

  if (currentApp.get()?.chatId === chatId) {
    currentApp.set(null);
  }
}

export function syncCurrentApp(app: ManagedAppRecord | null | undefined) {
  currentApp.set(app ?? null);
}

export function findManagedAppByChatId(chatId: string | undefined) {
  if (!chatId) {
    return null;
  }

  return managedApps.get().find((app) => app.chatId === chatId) ?? null;
}
