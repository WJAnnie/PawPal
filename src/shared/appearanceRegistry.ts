import {
  BUILTIN_APPEARANCES,
  STATE_FALLBACKS,
  getBuiltinAsset,
  type PetAssetDefinition,
} from "./petAppearances";
import {
  isCustomAppearanceId,
  customIdToBareId,
  type CustomAppearanceManifest,
} from "./customAppearance";
import type { Language, PetAppearanceId, PetState } from "./types";
import type { PetSpecies } from "./petSpecies";

export interface AppearanceRegistry {
  resolve(id: PetAppearanceId, state: PetState): PetAssetDefinition;
  listAll(language: Language): Array<{ value: PetAppearanceId; label: string }>;
  getSpecies(id: PetAppearanceId): PetSpecies;
  hasAppearance(id: PetAppearanceId): boolean;
}

export function createAppearanceRegistry(
  customs: Record<string, CustomAppearanceManifest> = {}
): AppearanceRegistry {
  return {
    resolve(id, state) {
      if (isCustomAppearanceId(id)) {
        const bareId = customIdToBareId(id);
        const manifest = customs[bareId];
        if (manifest) {
          const path = resolveFromCustomManifest(manifest, state);
          if (path) {
            return { path: `pet-assets://custom/${bareId}/${path}` };
          }
        }
        return getBuiltinAsset("lineDog", "idle");
      }
      return getBuiltinAsset(id, state);
    },

    listAll(language) {
      const builtin = Object.values(BUILTIN_APPEARANCES).map((a) => ({
        value: a.id as PetAppearanceId,
        label: a.label[language],
      }));
      const custom = Object.values(customs).map((m) => ({
        value: `custom:${m.id}` as PetAppearanceId,
        label: m.name,
      }));
      return [...builtin, ...custom];
    },

    getSpecies(id) {
      if (isCustomAppearanceId(id)) {
        // v1: custom appearances are all treated as "dog".
        // v2 will add a species field to CustomAppearanceManifest.
        return "dog";
      }
      return BUILTIN_APPEARANCES[id].species;
    },

    hasAppearance(id) {
      if (isCustomAppearanceId(id)) {
        return customIdToBareId(id) in customs;
      }
      return id === "lovartPuppy" || id === "lineDog";
    },
  };
}

function resolveFromCustomManifest(
  manifest: CustomAppearanceManifest,
  state: PetState
): string | undefined {
  const fallbackState = STATE_FALLBACKS[state];
  return (
    manifest.assets[state] ??
    (fallbackState ? manifest.assets[fallbackState] : undefined) ??
    manifest.assets.idle
  );
}