import { Injectable } from '@angular/core';

import { environment } from '../../../environments/environment';

export type LogCategory = 'PhotoScanner' | 'MediaStore' | 'Nextcloud' | 'UploadQueue' | 'Database' | 'Deletion';

const SECRET_KEYS = new Set(['password', 'apppassword', 'app_password', 'authorization', 'token', 'secret']);

@Injectable({ providedIn: 'root' })
export class Logger {
  debug(category: LogCategory, message: string, details?: unknown): void {
    this.write('debug', category, message, details, !environment.production);
  }

  info(category: LogCategory, message: string, details?: unknown): void {
    this.write('info', category, message, details, true);
  }

  warn(category: LogCategory, message: string, details?: unknown): void {
    this.write('warn', category, message, details, true);
  }

  error(category: LogCategory, message: string, details?: unknown): void {
    this.write('error', category, message, details, true);
  }

  private write(
    level: 'debug' | 'info' | 'warn' | 'error',
    category: LogCategory,
    message: string,
    details: unknown,
    enabled: boolean,
  ): void {
    if (!enabled) {
      return;
    }
    const formatted = this.format(category, message);
    if (details === undefined) {
      console[level](formatted);
      return;
    }
    console[level](formatted, this.sanitize(details));
  }

  sanitize(value: unknown): unknown {
    if (typeof value === 'string') {
      return value
        .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
        .replace(/appPassword=\S+/gi, 'appPassword=[redacted]')
        .replace(/password=\S+/gi, 'password=[redacted]')
        .replace(/(https?:\/\/)[^/\s@]+@/gi, '$1');
    }
    if (Array.isArray(value)) {
      return value.map((item) => this.sanitize(item));
    }
    if (value && typeof value === 'object') {
      const output: Record<string, unknown> = {};
      for (const [key, entry] of Object.entries(value)) {
        output[key] = SECRET_KEYS.has(key.toLowerCase()) ? '[redacted]' : this.sanitize(entry);
      }
      return output;
    }
    return value;
  }

  private format(category: LogCategory, message: string): string {
    return `[${category}] ${message}`;
  }
}
