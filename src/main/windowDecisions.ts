import type { PetWindowMode } from "./windowMode";

/**
 * Pure decision: should the pet window let mouse events pass through to the
 * desktop right now? Extracted from main.ts so we can unit-test the rule
 * (panel/chat always interactive; compact follows renderer intent).
 */
export function resolvePassthrough(
  mode: PetWindowMode,
  rendererWantsPassthrough: boolean
): boolean {
  if (mode !== "compact") return false;
  return rendererWantsPassthrough;
}

/**
 * Pure decision: which Display id should we treat as "the pet's screen" given
 * the persisted displayId and the current set of attached displays? Returns
 * the matched display when found, otherwise the primary fallback. The caller
 * supplies displays + primary so this stays free of `electron` imports and
 * trivially testable.
 */
export interface DisplayLike {
  id: number;
}

export function resolveStoredDisplayId<T extends DisplayLike>(
  displayId: number | undefined,
  allDisplays: T[],
  primary: T
): T {
  if (displayId !== undefined) {
    const match = allDisplays.find((d) => d.id === displayId);
    if (match) return match;
  }
  return primary;
}
