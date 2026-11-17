/**
 * The Bloodline profile on this device (guest play). It is account-level progression, not a save:
 * it survives every chronicle. Never holds tokens or personal data.
 */
import { emptyProfile, ProfileSchema, type Profile } from '@mrak/core';

const KEY = 'mrak.bloodline.v1';

export function loadProfile(storage: Pick<Storage, 'getItem'> | undefined): Profile {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return emptyProfile();
    const parsed = ProfileSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : emptyProfile();
  } catch {
    return emptyProfile();
  }
}

export function saveProfile(storage: Pick<Storage, 'setItem'> | undefined, profile: Profile): void {
  try {
    storage?.setItem(KEY, JSON.stringify(profile));
  } catch {
    // Storage full or blocked: the profile lives on in memory for this session.
  }
}
