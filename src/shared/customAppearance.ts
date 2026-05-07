import type {
  BuiltinAppearanceId,
  CustomAppearanceId,
  PetAppearanceId,
  PetState,
} from "./types";

const CUSTOM_PREFIX = "custom:";
const NAME_MAX = 30;

export type CustomAppearanceManifest = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  assets: Partial<Record<PetState, string>>;
  version: 1;
};

export type CustomAppearancesConfig = {
  appearances: Record<string, CustomAppearanceManifest>;
};

export function isCustomAppearanceId(id: PetAppearanceId): id is CustomAppearanceId {
  return typeof id === "string" && id.startsWith(CUSTOM_PREFIX);
}

export function isBuiltinAppearanceId(id: PetAppearanceId): id is BuiltinAppearanceId {
  return id === "lovartPuppy" || id === "lineDog";
}

export function customIdToBareId(id: CustomAppearanceId): string {
  return id.slice(CUSTOM_PREFIX.length);
}

export function bareIdToCustomId(bareId: string): CustomAppearanceId {
  return `${CUSTOM_PREFIX}${bareId}` as CustomAppearanceId;
}

export type NameValidation = { ok: true } | { ok: false; reason: "empty" | "too-long" };

export function validateCustomAppearanceName(name: string): NameValidation {
  const trimmed = name.trim();
  if (trimmed.length === 0) return { ok: false, reason: "empty" };
  if (trimmed.length > NAME_MAX) return { ok: false, reason: "too-long" };
  return { ok: true };
}

export function isValidCustomAppearanceManifest(value: unknown): value is CustomAppearanceManifest {
  if (typeof value !== "object" || value === null) return false;
  const m = value as Record<string, unknown>;
  return (
    typeof m.id === "string" && m.id.length > 0 &&
    typeof m.name === "string" && m.name.length > 0 &&
    typeof m.createdAt === "number" &&
    typeof m.updatedAt === "number" &&
    typeof m.assets === "object" && m.assets !== null &&
    m.version === 1
  );
}