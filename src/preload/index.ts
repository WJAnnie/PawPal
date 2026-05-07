import { contextBridge, ipcRenderer } from "electron";
import type {
  AiDeltaEvent,
  AiDoneEvent,
  AiErrorEvent,
  AiSendResult,
  AiSettings,
  ChatSession,
} from "../shared/ai/types";
import type {
  AppSnapshot,
  DemoTrigger,
  PetState,
  Settings,
  SpeechBubble,
  TodayStats
} from "../shared/types";
import type { PetVitals, PendingGift } from "../shared/vitals";

type Unsubscribe = () => void;

type FeedOk = { ok: true; item: { id: string; icon: string; label: { "zh-CN": string; en: string } }; vitals: PetVitals };
type FeedErr = { ok: false; reason: "no_inventory" | "cooldown" | "unknown_item" };
type BuyOk = { ok: true; vitals: PetVitals };
type BuyErr = { ok: false; reason: "no_coins" | "unknown_item" | "level_locked" };
type PlayResult =
  | { ok: true; bonus: boolean; score: number; vitals: PetVitals }
  | { ok: false; reason: "unknown_game" };
type StrokeResult = { ok: boolean; vitals: PetVitals; reason?: "cooldown" };
type ClaimGiftResult = { vitals: PetVitals; gift: PendingGift | null };

function onChannel<T>(channel: string, callback: (payload: T) => void): Unsubscribe {
  const listener = (_event: Electron.IpcRendererEvent, payload: T) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const ai = {
  getSettings: (): Promise<AiSettings> => ipcRenderer.invoke("ai:get-settings"),
  saveSettings: (settings: AiSettings): Promise<AiSettings> =>
    ipcRenderer.invoke("ai:save-settings", settings),

  send: (sessionId: string, userText: string): Promise<AiSendResult> =>
    ipcRenderer.invoke("ai:send", { sessionId, userText }),
  stop: (requestId: string): void => ipcRenderer.send("ai:stop", requestId),

  listSessions: (): Promise<ChatSession[]> => ipcRenderer.invoke("ai:list-sessions"),
  getSession: (id: string): Promise<ChatSession | null> => ipcRenderer.invoke("ai:get-session", id),
  newSession: (title?: string): Promise<ChatSession> => ipcRenderer.invoke("ai:new-session", title),
  deleteSession: (id: string): Promise<void> => ipcRenderer.invoke("ai:delete-session", id),

  onDelta: (callback: (event: AiDeltaEvent) => void): Unsubscribe =>
    onChannel("ai:delta", callback),
  onDone: (callback: (event: AiDoneEvent) => void): Unsubscribe =>
    onChannel("ai:done", callback),
  onError: (callback: (event: AiErrorEvent) => void): Unsubscribe =>
    onChannel("ai:error", callback),
};

const vitals = {
  get: (): Promise<PetVitals> => ipcRenderer.invoke("vitals:get"),
  feed: (itemId: string): Promise<FeedOk | FeedErr> =>
    ipcRenderer.invoke("vitals:feed", itemId),
  buy: (itemId: string, qty = 1): Promise<BuyOk | BuyErr> =>
    ipcRenderer.invoke("vitals:buy", itemId, qty),
  play: (gameId: string, score: number, requiredScore: number): Promise<PlayResult> =>
    ipcRenderer.invoke("vitals:play", gameId, score, requiredScore),
  petStroke: (): Promise<StrokeResult> => ipcRenderer.invoke("vitals:pet-stroke"),
  startCompanion: (minutes: number): Promise<PetVitals> =>
    ipcRenderer.invoke("vitals:start-companion", minutes),
  stopCompanion: (): Promise<PetVitals> => ipcRenderer.invoke("vitals:stop-companion"),
  claimGift: (): Promise<ClaimGiftResult> => ipcRenderer.invoke("vitals:claim-gift"),
};

const frisbee = {
  report: (
    payload: { score: number; requiredScore: number; cancelled: boolean }
  ): Promise<PetVitals | null> => ipcRenderer.invoke("frisbee:report", payload),
  close: (): void => ipcRenderer.send("frisbee:close"),
};

const api = {
  getSnapshot: (): Promise<AppSnapshot> => ipcRenderer.invoke("app:get-snapshot"),
  openReleaseNotes: (): void => ipcRenderer.send("app:open-release-notes"),
  openSettings: (): void => ipcRenderer.send("app:open-settings"),
  petClicked: (): void => ipcRenderer.send("pet:clicked"),
  petContextMenu: (): void => ipcRenderer.send("pet:context-menu"),
  petTogglePanel: (): void => ipcRenderer.send("pet:toggle-panel"),
  petDragStart: (offset: { offsetX: number; offsetY: number }): void =>
    ipcRenderer.send("pet:drag-start", offset),
  petDragStop: (): void => ipcRenderer.send("pet:drag-stop"),
  bubbleAction: (actionId: string): void => ipcRenderer.send("bubble:action", actionId),
  updateSettings: (settings: Partial<Settings>): void =>
    ipcRenderer.send("settings:update", settings),
  triggerDemo: (trigger: DemoTrigger): void => ipcRenderer.send("demo:trigger", trigger),
  isPackaged: !process.defaultApp,
  assetUrl: (relativePath: string): string => {
    return `pawpal-asset://asset/${encodeURIComponent(relativePath)}`;
  },
  startFocus: (): void => ipcRenderer.send("focus:start"),
  stopFocus: (): void => ipcRenderer.send("focus:stop"),
  resetToday: (): void => ipcRenderer.send("stats:reset-today"),
  openChatWindow: (): void => ipcRenderer.send("chat:open-window"),
  onPetState: (callback: (state: PetState) => void): Unsubscribe =>
    onChannel("pet:set-state", callback),
  onPetPanelState: (callback: (open: boolean) => void): Unsubscribe =>
    onChannel("pet:set-panel-state", callback),
  onShowBubble: (callback: (bubble: SpeechBubble) => void): Unsubscribe =>
    onChannel("pet:show-bubble", callback),
  onHideBubble: (callback: () => void): Unsubscribe => onChannel("pet:hide-bubble", callback),
  onSettingsUpdated: (callback: (settings: Settings) => void): Unsubscribe =>
    onChannel("settings:updated", callback),
  onStatsUpdated: (callback: (stats: TodayStats) => void): Unsubscribe =>
    onChannel("stats:updated", callback),
  onSnapshot: (callback: (snapshot: AppSnapshot) => void): Unsubscribe =>
    onChannel("app:snapshot", callback),

  // AI subsystem (FU#1: see docs/ai-design.md)
  ai,
  // Vitals / feed / play loop
  vitals,
  // Frisbee mini-game window IPC
  frisbee,
};

contextBridge.exposeInMainWorld("pawpal", api);

export type PawPalApi = typeof api;
