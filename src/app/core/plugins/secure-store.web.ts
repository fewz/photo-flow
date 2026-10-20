const secrets = new Map<string, string>();

/** Session-only storage. The browser build does not write the app password to disk. */
export class SecureStoreWeb {
  async set(options: { key: string; value: string }): Promise<void> {
    secrets.set(options.key, options.value);
  }

  async get(options: { key: string }): Promise<{ value?: string }> {
    const value = secrets.get(options.key);
    return value == null ? {} : { value };
  }

  async remove(options: { key: string }): Promise<void> {
    secrets.delete(options.key);
  }
}
