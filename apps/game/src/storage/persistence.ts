/**
 * Persistent storage (docs/systems/save-system.md): asks the browser not to evict our saves under
 * storage pressure. When denied, the UI recommends exporting a backup file.
 */
export type PersistenceState = 'unknown' | 'granted' | 'denied' | 'unsupported';

type StorageApi = Pick<StorageManager, 'persist' | 'persisted'>;

export async function checkPersistence(api: StorageApi | undefined): Promise<PersistenceState> {
  if (!api || typeof api.persisted !== 'function') return 'unsupported';
  try {
    return (await api.persisted()) ? 'granted' : 'unknown';
  } catch {
    return 'unsupported';
  }
}

export async function requestPersistence(api: StorageApi | undefined): Promise<PersistenceState> {
  if (!api || typeof api.persist !== 'function') return 'unsupported';
  try {
    if (await api.persisted()) return 'granted';
    return (await api.persist()) ? 'granted' : 'denied';
  } catch {
    return 'denied';
  }
}
