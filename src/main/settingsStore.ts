import Store from "electron-store";
import { DEFAULT_SETTINGS } from "../shared/constants";
import { resolveLanguage } from "../shared/i18n";
import { resolvePetAppearanceId } from "../shared/petAppearances";
import type { Settings } from "../shared/types";

export type PetPosition = {
  x: number;
  y: number;
};

interface RootStoreSchema {
  settings?: Settings;
  petPosition?: PetPosition;
}

const SETTINGS_KEY = "settings";
const PET_POSITION_KEY = "petPosition";

/**
 * Persists `settings` and `petPosition` on the shared `pawpal` electron-store.
 * Settings are normalised on every read/write so callers always see a valid
 * Language + PetAppearanceId, even after a schema drift or hand-edit.
 *
 * Owns:
 * - cache + persist of Settings
 * - language / petAppearanceId normalisation
 * - petPosition single-value persistence
 *
 * Does NOT own:
 * - IPC broadcast (caller wires `settings:updated` after mutation)
 * - Reminder / distraction timers (caller decides when to reschedule)
 * - Tray menu refresh (caller's UI concern)
 */
export class SettingsStore {
  private readonly store: Store<RootStoreSchema>;
  private cache: Settings;

  constructor(store?: Store<RootStoreSchema>) {
    this.store =
      store ??
      (new Store<RootStoreSchema>({ name: "pawpal" }) as Store<RootStoreSchema>);
    this.cache = this.loadFromDisk();
  }

  get(): Settings {
    return this.cache;
  }

  set(next: Settings): Settings {
    const normalised = this.normalise(next);
    this.cache = normalised;
    this.store.set(SETTINGS_KEY, normalised);
    return normalised;
  }

  patch(partial: Partial<Settings>): Settings {
    return this.set({ ...this.cache, ...partial });
  }

  getPetPosition(): PetPosition | undefined {
    return this.store.get(PET_POSITION_KEY) as PetPosition | undefined;
  }

  setPetPosition(position: PetPosition): void {
    this.store.set(PET_POSITION_KEY, position);
  }

  private loadFromDisk(): Settings {
    const stored = this.store.get(SETTINGS_KEY) as Partial<Settings> | undefined;
    return this.normalise({ ...DEFAULT_SETTINGS, ...(stored ?? {}) });
  }

  private normalise(value: Settings): Settings {
    return {
      ...value,
      language: resolveLanguage(value.language),
      petAppearanceId: resolvePetAppearanceId(value.petAppearanceId)
    };
  }
}
