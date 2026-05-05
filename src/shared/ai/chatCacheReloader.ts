import type { AiSettings, ChatMessage } from "./types";

/**
 * Pure function: rebuild a chat message cache to reflect current AiSettings.
 *
 * Ported from VPet-WorkPet ChatCacheReloader.Apply (FU#1).
 *
 * Behaviors:
 * - Removes any existing system messages, then prepends a new one if
 *   `settings.systemPrompt` is non-empty (after trim).
 * - Trims to settings.maxContextMessages, keeping all system messages plus
 *   the most recent (max - systemCount) non-system messages.
 * - Clamps maxContextMessages < 2 up to 2 (room for at least 1 user msg).
 * - Never mutates the input array. Returns a new array.
 */
export function applySettingsToCache(
  cache: ReadonlyArray<ChatMessage>,
  settings: AiSettings
): ChatMessage[] {
  const max = Math.max(2, settings.maxContextMessages);
  const now = Date.now();

  // Drop all existing system messages.
  const withoutSystem = cache.filter((m) => m.role !== "system");

  // Prepend the new system message (only if non-empty).
  const next: ChatMessage[] = [];
  if (settings.systemPrompt.trim().length > 0) {
    next.push({
      id: "system",
      role: "system",
      content: settings.systemPrompt,
      createdAt: now,
    });
  }
  next.push(...withoutSystem);

  if (next.length <= max) return next;

  // Keep all system messages (always 0 or 1 here, but defensive),
  // plus the most recent non-system messages up to the budget.
  const systems = next.filter((m) => m.role === "system");
  const others = next.filter((m) => m.role !== "system");
  const budgetForOthers = Math.max(0, max - systems.length);
  return [...systems, ...others.slice(-budgetForOthers)];
}
