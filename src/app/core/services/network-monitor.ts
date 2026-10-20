import { Injectable, signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';

export interface NetworkStatus {
  isOnline(): boolean;
}

@Injectable({ providedIn: 'root' })
export class NetworkMonitor implements NetworkStatus {
  readonly online = signal(readOnline());
  private started = false;
  private readonly reconnectListeners = new Set<() => void>();

  isOnline(): boolean {
    return this.online();
  }

  onReconnect(listener: () => void): () => void {
    this.reconnectListeners.add(listener);
    return () => {
      this.reconnectListeners.delete(listener);
    };
  }

  apply(online: boolean): void {
    const previous = this.online();
    if (previous === online) {
      return;
    }
    this.online.set(online);
    if (online && !previous) {
      for (const listener of this.reconnectListeners) {
        listener();
      }
    }
  }

  async start(): Promise<void> {
    if (this.started || typeof window === 'undefined') {
      return;
    }
    this.started = true;
    window.addEventListener('online', () => this.apply(true));
    window.addEventListener('offline', () => this.apply(false));
    if (!Capacitor.isNativePlatform()) {
      return;
    }
    const { Network } = await import('@capacitor/network');
    const status = await Network.getStatus();
    this.apply(status.connected);
    await Network.addListener('networkStatusChange', (next) => this.apply(next.connected));
  }
}

function readOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine;
}
