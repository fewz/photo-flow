import { Injectable } from '@angular/core';

import { SECRET_APP_PASSWORD } from '../constants/app.constants';
import { SecureStore } from '../plugins/secure-store';

export interface CredentialStore {
  getAppPassword(): Promise<string | null>;
  setAppPassword(value: string): Promise<void>;
  hasAppPassword(): Promise<boolean>;
}

@Injectable({ providedIn: 'root' })
export class SecureCredentialStore implements CredentialStore {
  async getAppPassword(): Promise<string | null> {
    const result = await SecureStore.get({ key: SECRET_APP_PASSWORD });
    const value = result.value?.trim();
    return value ? value : null;
  }

  async setAppPassword(value: string): Promise<void> {
    const secret = value.trim();
    if (!secret) {
      return;
    }
    await SecureStore.set({ key: SECRET_APP_PASSWORD, value: secret });
  }

  async hasAppPassword(): Promise<boolean> {
    return (await this.getAppPassword()) != null;
  }
}
