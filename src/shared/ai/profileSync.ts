import type { AiProvider, AiSettings } from "./types";

/**
 * Pure functions managing the relationship between AiSettings top-level fields
 * and the AiSettings.profiles[activeProfileId] entry.
 *
 * Invariant: top-level fields always mirror the active profile so that all
 * existing callers (chat client, cache reloader, etc.) can keep reading
 * `settings.baseUrl` / `settings.apiKey` etc. without knowing about profiles.
 *
 * Ported from VPet-WorkPet AiSettingsStore (FU#4).
 */

/**
 * Switch active profile and copy its fields onto top-level.
 * @throws Error if profileId is missing or not in profiles list.
 */
export function withActiveProfile(settings: AiSettings, profileId: string): AiSettings {
  if (!profileId) {
    throw new Error("Profile id cannot be null or empty.");
  }
  const match = settings.profiles.find((p) => p.id === profileId);
  if (!match) {
    throw new Error(`Profile '${profileId}' not found in profiles list.`);
  }
  return {
    ...settings,
    activeProfileId: match.id,
    baseUrl: match.baseUrl,
    apiKey: match.apiKey,
    model: match.model,
    temperature: match.temperature,
    maxContextMessages: match.maxContextMessages,
    systemPrompt: match.systemPrompt,
    requestTimeoutMs: match.requestTimeoutMs,
  };
}

/**
 * Copy current top-level fields back into profiles[activeProfileId] so that
 * disk persistence sees a consistent profile entry.
 *
 * No-op if profiles is empty, activeProfileId is empty, or activeProfileId
 * does not match any profile.
 */
export function syncTopLevelToActiveProfile(settings: AiSettings): AiSettings {
  if (settings.profiles.length === 0 || !settings.activeProfileId) {
    return settings;
  }
  const idx = settings.profiles.findIndex((p) => p.id === settings.activeProfileId);
  if (idx < 0) return settings;

  const updated: AiProvider = {
    ...settings.profiles[idx],
    baseUrl: settings.baseUrl,
    apiKey: settings.apiKey,
    model: settings.model,
    temperature: settings.temperature,
    maxContextMessages: settings.maxContextMessages,
    systemPrompt: settings.systemPrompt,
    requestTimeoutMs: settings.requestTimeoutMs,
  };
  const newProfiles = [...settings.profiles];
  newProfiles[idx] = updated;
  return { ...settings, profiles: newProfiles };
}

/**
 * Self-heal AiSettings to guarantee a usable state:
 * - profiles non-empty
 * - activeProfileId points at a real profile
 *
 * If profiles is empty, builds a single "default" profile from the current
 * top-level fields. If activeProfileId is missing/unknown, picks profiles[0].
 *
 * Idempotent: calling twice produces same result.
 */
export function ensureValidProfileState(
  settings: AiSettings,
  defaultProfileId = "default",
  defaultProfileName = "Default"
): AiSettings {
  if (settings.profiles.length === 0) {
    const seed: AiProvider = {
      id: defaultProfileId,
      name: defaultProfileName,
      baseUrl: settings.baseUrl,
      apiKey: settings.apiKey,
      model: settings.model,
      temperature: settings.temperature,
      maxContextMessages: settings.maxContextMessages,
      systemPrompt: settings.systemPrompt,
      requestTimeoutMs: settings.requestTimeoutMs,
    };
    return { ...settings, profiles: [seed], activeProfileId: defaultProfileId };
  }
  const hasActive = settings.profiles.some((p) => p.id === settings.activeProfileId);
  if (!hasActive) {
    return withActiveProfile(settings, settings.profiles[0].id);
  }
  return settings;
}
