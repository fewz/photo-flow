import { registerPlugin } from '@capacitor/core';

interface SecureStorePlugin {
  set(options: { key: string; value: string }): Promise<void>;
  get(options: { key: string }): Promise<{ value?: string }>;
  remove(options: { key: string }): Promise<void>;
}

const native = registerPlugin<SecureStorePlugin>('SecureStore', {
  web: () => import('./secure-store.web').then((module) => new module.SecureStoreWeb()),
});

export const SecureStore = native;
