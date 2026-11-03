/** Keep sessions and unsaved personal data when the product storage prefix changes. */
export function migrateContentPoolStorage(): void {
  for (const name of ['localStorage', 'sessionStorage'] as const) {
    try {
      const storage = window[name];
      const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index));
      for (const key of keys) {
        if (!key?.startsWith('cp_')) continue;
        const value = storage.getItem(key);
        if (value === null) continue;
        const target = `ch_${key.slice(3)}`;
        if (storage.getItem(target) === null) storage.setItem(target, value);
        storage.removeItem(key);
      }
    } catch {
      // Restricted storage must not prevent the app from starting or delete old data.
    }
  }
}
