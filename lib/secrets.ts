/**
 * Strings kept in the keychain-backed SecureStore under `<namespace>.<key>`.
 * Reads never throw: a missing or mistyped value reads as "". Writing "" removes it.
 */
export class SecretStore {
  private readonly namespace: string;

  constructor(namespace: string) {
    this.namespace = namespace;
  }

  keyFor(key: string): string {
    return `${this.namespace}.${key}`;
  }

  async get(key: string): Promise<string> {
    try {
      return (await SecureStore.string(this.keyFor(key))) ?? "";
    } catch {
      return "";
    }
  }

  async has(key: string): Promise<boolean> {
    return (await this.get(key)) !== "";
  }

  /** Stored as given (a password may start or end with a space); blank removes it. */
  async set(key: string, value: string): Promise<void> {
    if (value.trim()) await SecureStore.set(this.keyFor(key), value);
    else await SecureStore.remove(this.keyFor(key));
  }

  async clear(...keys: string[]): Promise<void> {
    for (const key of keys) await SecureStore.remove(this.keyFor(key));
  }
}
