import Store from "electron-store";
import { aiSettingsSchema, type AiSettings } from "../../shared/ai/types";
import { DEFAULT_AI_SETTINGS } from "../../shared/ai-defaults";
import {
  ensureValidProfileState,
  syncTopLevelToActiveProfile,
} from "../../shared/ai/profileSync";

/**
 * Persistence layer for AI settings, on top of the same electron-store
 * already used by the main app (so users only have one config file).
 *
 * Strategy:
 * - Settings live under the "ai" key on the main store.
 * - Load: parse with zod; on any failure (corrupt JSON, schema drift) fall
 *   back to DEFAULT_AI_SETTINGS without crashing the app.
 * - Save: always run `syncTopLevelToActiveProfile + ensureValidProfileState`
 *   before writing so the on-disk shape obeys our invariants.
 */

interface RootStoreSchema {
  ai?: unknown;
}

const STORAGE_KEY = "ai";

export class AiSettingsStore {
  // electron-store v10 is ESM-only and exports `default` differently in CJS contexts;
  // we treat it as `Store` constructor. The renderer never imports this file.
  private readonly store: Store<RootStoreSchema>;

  constructor(store?: Store<RootStoreSchema>) {
    this.store =
      store ??
      (new Store<RootStoreSchema>({ name: "pawpal" }) as Store<RootStoreSchema>);
  }

  /**
   * Load settings, returning defaults on any error. Always returns a settings
   * object whose profile state is internally consistent (profiles non-empty,
   * activeProfileId points at a real profile, top-level mirrors active).
   */
  load(): AiSettings {
    const raw = this.store.get(STORAGE_KEY);
    if (raw === undefined || raw === null) {
      return cloneDefaults();
    }
    try {
      const parsed = aiSettingsSchema.parse(raw);
      return ensureValidProfileState(parsed);
    } catch (error) {
      // Schema violation — log to console (main-process console) and fall back.
      // We never crash the app over a corrupt settings file.
      const message = error instanceof Error ? error.message : String(error);
      // Using process.stderr directly to avoid any production-logger dependency.
      process.stderr.write(`[ai-settings] failed to parse, using defaults: ${message}\n`);
      return cloneDefaults();
    }
  }

  /**
   * Persist settings. Auto-syncs top-level fields back into
   * profiles[activeProfileId] before write.
   */
  save(settings: AiSettings): AiSettings {
    const validated = aiSettingsSchema.parse(settings);
    const synced = syncTopLevelToActiveProfile(ensureValidProfileState(validated));
    this.store.set(STORAGE_KEY, synced);
    return synced;
  }

  /** Test hook: clear the AI settings entry. */
  clear(): void {
    this.store.delete(STORAGE_KEY);
  }
}

function cloneDefaults(): AiSettings {
  // Deep clone via JSON to avoid sharing the DEFAULT_AI_SETTINGS profile array.
  return JSON.parse(JSON.stringify(DEFAULT_AI_SETTINGS)) as AiSettings;
}

/**
 * Standalone validation helper, useful in tests + IPC handlers receiving
 * settings from the renderer.
 */
export function validateAiSettings(input: unknown): ReturnType<typeof aiSettingsSchema.safeParse> {
  return aiSettingsSchema.safeParse(input);
}
