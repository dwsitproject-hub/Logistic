/**
 * The one place dhm/config.ts and jps/config.ts read a setting from.
 *
 * A value saved in the Integrations menu wins; otherwise process.env, exactly as before. With no
 * saved values - the state every deployment starts in - this is a plain process.env read, which is
 * why introducing it changes nothing on its own.
 *
 * Deliberately dependency-free. The HTTP clients import it to hear about changes, and the settings
 * store imports it to publish them; if it pulled in the database or the store, the clients would
 * import the store and the store would import the clients.
 */
const overrides = new Map<string, string>();
const listeners = new Set<() => void>();

export function integrationEnv(key: string): string | undefined {
  return overrides.has(key) ? overrides.get(key) : process.env[key];
}

export function hasIntegrationOverride(key: string): boolean {
  return overrides.has(key);
}

/**
 * Swap in a complete new set of saved values, then tell every listener.
 *
 * Listeners exist because the clients cache things built from these values: DHM keeps a bearer
 * token for seven hours and both keep an axios instance with the base URL and timeout baked in.
 * Without a reset, a rotated key would keep authenticating with the old token for hours.
 */
export function replaceIntegrationOverrides(next: ReadonlyMap<string, string>): void {
  overrides.clear();
  for (const [key, value] of next) overrides.set(key, value);
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // A listener's failure must not stop the others from resetting.
    }
  }
}

export function onIntegrationSettingsChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
