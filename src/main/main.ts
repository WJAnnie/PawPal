import { join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeTheme,
  net,
  protocol,
  screen,
  shell,
  Tray
} from "electron";
import Store from "electron-store";
import {
  createEmptyStats,
  DEFAULT_SETTINGS,
  todayKey
} from "../shared/constants";
import { i18n, pick, resolveLanguage } from "../shared/i18n";
import { resolvePetAppearanceId, getPetSpecies } from "../shared/petAppearances";
import type {
  AppSnapshot,
  BlockingMode,
  DistractionStatus,
  DemoTrigger,
  PetFacing,
  PetState,
  Settings,
  StatsHistory,
  SpeechBubble,
  TodayStats
} from "../shared/types";
import {
  APP_NAME,
  BREAK_RUN_DURATION_MS,
  BREAK_RUN_TICK_MS,
  CHAT_WINDOW,
  FRISBEE_WINDOW,
  DISTRACTION_CHECK_INTERVAL_MS,
  DISTRACTION_WARNING_COOLDOWN_MS,
  IS_DEV,
  PET_WINDOW,
  PET_WINDOW_CHAT,
  PET_WINDOW_PANEL,
  PRELOAD_PATH,
  RELEASES_URL,
  RENDERER_HTML_PATH,
  SETTINGS_WINDOW,
  STORE_NAME
} from "./config";
import { classifyDistraction, isPermissionError, readActiveWindow } from "./distraction";
import { createTrayImage } from "./trayIcon";
import { AiSettingsStore } from "./ai/settingsStore";
import { ChatHistoryStore } from "./ai/chatHistory";
import { ChatService } from "./ai/chatService";
import type { AiSettings } from "../shared/ai/types";
import { VitalsStore, type RuntimeContext } from "./vitalsStore";
import {
  COIN_REWARDS,
  VITALS_TICK_MS,
  computeLevel,
  type PetVitals
} from "../shared/vitals";
import {
  getGameById,
  getItemById,
  visibleItemsFor
} from "../shared/items";

type PetPosition = {
  x: number;
  y: number;
};

type StoreSchema = {
  settings: Settings;
  stats: TodayStats;
  statsHistory: StatsHistory;
  petPosition?: PetPosition;
};

app.setName(APP_NAME);

const store = new Store<StoreSchema>({
  name: STORE_NAME,
  defaults: {
    settings: DEFAULT_SETTINGS,
    stats: createEmptyStats(),
    statsHistory: {}
  }
});

let petWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;
let chatWindow: BrowserWindow | null = null;
let frisbeeWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let petState: PetState = "idle";
let petFacing: PetFacing = "right";
let blockingMode: BlockingMode = null;
let focusActive = false;
let focusStartedAt: number | null = null;
let breakRunTimer: NodeJS.Timeout | null = null;
let breakRunCountdownTimer: NodeJS.Timeout | null = null;
let breakRunMovementTimer: NodeJS.Timeout | null = null;
let breakTimer: NodeJS.Timeout | null = null;
let hydrationTimer: NodeJS.Timeout | null = null;
let focusTimer: NodeJS.Timeout | null = null;
let distractionTimer: NodeJS.Timeout | null = null;
let distractionStartupTimer: NodeJS.Timeout | null = null;
let breakDueAt: number | null = null;
let hydrationDueAt: number | null = null;
let focusEndsAt: number | null = null;
let bubbleTimer: NodeJS.Timeout | null = null;
type PetWindowMode = "compact" | "panel" | "chat";
let petWindowMode: PetWindowMode = "compact";
let vitalsTickTimer: NodeJS.Timeout | null = null;
let lastUserInteractionAt = Date.now();
let dragTimer: NodeJS.Timeout | null = null;
let dragSafetyTimer: NodeJS.Timeout | null = null;
let breakRunVelocity: PetPosition = { x: 0, y: 0 };
let breakRunFormatter: ((seconds: number) => string) | null = null;
let nextBreakRunTurnAt = 0;
let breakMutedToday = false;
let dragOffset: PetPosition = { x: 0, y: 0 };
let distractionStatus: DistractionStatus = {
  state: "idle",
  activeApp: "",
  activeWindowTitle: "",
  matchedRule: null,
  lastCheckedAt: null,
  lastWarningAt: null,
  error: null
};

function getSettings(): Settings {
  const stored = store.get("settings");
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    language: resolveLanguage(stored.language),
    petAppearanceId: resolvePetAppearanceId(stored.petAppearanceId)
  };
}

function text(): ReturnType<typeof i18n> {
  return i18n(getSettings().language);
}

function setSettings(next: Settings): void {
  const normalized = {
    ...next,
    language: resolveLanguage(next.language),
    petAppearanceId: resolvePetAppearanceId(next.petAppearanceId)
  };
  store.set("settings", normalized);
  sendToAll("settings:updated", normalized);
  settingsWindow?.setTitle(`${APP_NAME} ${text().menu.settings}`);
  scheduleReminderTimers();
  scheduleDistractionDetection();
  updateTrayMenu();
}

function getStatsHistory(): StatsHistory {
  return store.get("statsHistory", {});
}

function isSameStats(left: TodayStats | undefined, right: TodayStats): boolean {
  return Boolean(
    left &&
      left.date === right.date &&
      left.breaksTaken === right.breaksTaken &&
      left.watersLogged === right.watersLogged &&
      left.focusMinutes === right.focusMinutes &&
      left.focusWarnings === right.focusWarnings
  );
}

function saveStatsToHistory(stats: TodayStats): void {
  if (!stats.date) return;
  const history = getStatsHistory();
  if (isSameStats(history[stats.date], stats)) return;
  store.set("statsHistory", {
    ...history,
    [stats.date]: stats
  });
}

function getStats(): TodayStats {
  const today = todayKey();
  const stats = store.get("stats", createEmptyStats());
  if (stats.date !== today) {
    saveStatsToHistory(stats);
    const current = getStatsHistory()[today] ?? createEmptyStats(today);
    store.set("stats", current);
    saveStatsToHistory(current);
    return current;
  }
  saveStatsToHistory(stats);
  return stats;
}

function updateStats(mutator: (stats: TodayStats) => TodayStats): void {
  const next = mutator(getStats());
  store.set("stats", next);
  saveStatsToHistory(next);
  sendToAll("stats:updated", next);
}

function resetTodayStats(): void {
  breakMutedToday = false;
  const reset = createEmptyStats();
  store.set("stats", reset);
  saveStatsToHistory(reset);
  sendToAll("stats:updated", reset);
}

function snapshot(): AppSnapshot {
  return {
    appInfo: {
      version: app.getVersion(),
      releaseNotesUrl: RELEASES_URL
    },
    settings: getSettings(),
    stats: getStats(),
    statsHistory: getStatsHistory(),
    timers: {
      breakDueAt,
      hydrationDueAt,
      focusEndsAt
    },
    distraction: distractionStatus,
    petState,
    petFacing,
    blockingMode,
    dogVisible: Boolean(petWindow?.isVisible()),
    focusActive,
    vitals: getVitalsStore().get()
  };
}

function sendToPet<T>(channel: string, payload?: T): void {
  if (!petWindow || petWindow.isDestroyed()) return;
  petWindow.webContents.send(channel, payload);
}

function sendToAll<T>(channel: string, payload?: T): void {
  sendToPet(channel, payload);
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send(channel, payload);
  }
  if (chatWindow && !chatWindow.isDestroyed()) {
    chatWindow.webContents.send(channel, payload);
  }
}

function publishSnapshot(): void {
  sendToAll("app:snapshot", snapshot());
}

function setPetState(next: PetState): void {
  petState = next;
  sendToAll("pet:set-state", next);
}

function setPetFacing(next: PetFacing): void {
  if (petFacing === next) return;
  petFacing = next;
  publishSnapshot();
}

function showBubble(bubble: SpeechBubble): void {
  if (bubbleTimer) clearTimeout(bubbleTimer);
  if (bubble.mode === "chat") {
    setPetWindowMode("chat");
  } else if (petWindowMode === "chat") {
    // Non-chat bubble while we were in chat mode — drop back to compact so
    // the bubble doesn't render in the oversized chat window.
    setPetWindowMode("compact");
  }
  sendToPet("pet:show-bubble", bubble);
  if (bubble.autoDismissMs) {
    bubbleTimer = setTimeout(() => hideBubble(), bubble.autoDismissMs);
  }
}

function hideBubble(): void {
  if (bubbleTimer) {
    clearTimeout(bubbleTimer);
    bubbleTimer = null;
  }
  if (petWindowMode === "chat") {
    setPetWindowMode("compact");
  }
  sendToPet("pet:hide-bubble");
}

function setPetWindowMode(mode: PetWindowMode): void {
  if (petWindowMode === mode) return;
  petWindowMode = mode;
  if (!petWindow) return;
  const target =
    mode === "chat" ? PET_WINDOW_CHAT : mode === "panel" ? PET_WINDOW_PANEL : PET_WINDOW;
  const current = petWindow.getBounds();
  // Anchor the bottom-center so the pet's visual position stays stable as
  // the surrounding window grows/shrinks (the pet sprite renders at the
  // bottom of the window via CSS).
  const centerX = current.x + Math.round(current.width / 2);
  const bottomY = current.y + current.height;
  const next = clampBoundsToWorkArea({
    x: centerX - Math.round(target.width / 2),
    y: bottomY - target.height,
    width: target.width,
    height: target.height
  });
  petWindow.setBounds(next);
}

function togglePetPanel(): void {
  if (blockingMode) return; // break/hydration/focusWarning bubbles are blocking — don't compete.
  if (petWindowMode === "chat") return; // AI chat bubble is open — let user finish first.
  if (petWindowMode === "panel") {
    setPetWindowMode("compact");
    sendToPet("pet:set-panel-state", false);
    return;
  }
  // Opening the panel — close any ambient threshold bubbles so the panel is the focus.
  hideBubble();
  setPetWindowMode("panel");
  sendToPet("pet:set-panel-state", true);
}

function rendererUrl(route: "pet" | "settings" | "chat" | "frisbee"): string {
  const devServer = process.env.ELECTRON_RENDERER_URL;
  if (devServer) return `${devServer}#${route}`;
  return RENDERER_HTML_PATH;
}

function loadRenderer(win: BrowserWindow, route: "pet" | "settings" | "chat" | "frisbee"): void {
  const devServer = process.env.ELECTRON_RENDERER_URL;
  if (devServer) {
    void win.loadURL(rendererUrl(route));
    return;
  }
  void win.loadFile(rendererUrl(route), { hash: route });
}

function clampBoundsToWorkArea(bounds: Electron.Rectangle): Electron.Rectangle {
  const center = {
    x: bounds.x + Math.round(bounds.width / 2),
    y: bounds.y + Math.round(bounds.height / 2)
  };
  const workArea = screen.getDisplayNearestPoint(center).workArea;
  return {
    ...bounds,
    x: Math.min(Math.max(bounds.x, workArea.x), workArea.x + workArea.width - bounds.width),
    y: Math.min(Math.max(bounds.y, workArea.y), workArea.y + workArea.height - bounds.height)
  };
}

function initialPetBounds(): Electron.Rectangle {
  const workArea = screen.getPrimaryDisplay().workArea;
  const stored = store.get("petPosition");
  const fallback = {
    width: PET_WINDOW.width,
    height: PET_WINDOW.height,
    x: Math.round(workArea.x + workArea.width / 2 - PET_WINDOW.width / 2),
    y: workArea.y + workArea.height - PET_WINDOW.height
  };

  if (!stored) return fallback;
  return clampBoundsToWorkArea({
    ...fallback,
    x: stored.x,
    y: stored.y
  });
}

function persistPetPosition(): void {
  if (!petWindow || petWindow.isDestroyed()) return;
  const bounds = petWindow.getBounds();
  store.set("petPosition", { x: bounds.x, y: bounds.y });
}

function createPetWindow(): void {
  const bounds = initialPetBounds();
  petWindow = new BrowserWindow({
    width: PET_WINDOW.width,
    height: PET_WINDOW.height,
    x: bounds.x,
    y: bounds.y,
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    show: false,
    skipTaskbar: true,
    hasShadow: false,
    backgroundColor: "#00000000",
    alwaysOnTop: true,
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: !IS_DEV
    }
  });

  petWindow.setAlwaysOnTop(true, process.platform === "darwin" ? "floating" : "normal");
  if (process.platform === "darwin") {
    petWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }
  loadRenderer(petWindow, "pet");
  petWindow.once("ready-to-show", () => {
    petWindow?.showInactive();
    updateTrayMenu();
    publishSnapshot();
  });
  petWindow.on("show", () => {
    updateTrayMenu();
    publishSnapshot();
  });
  petWindow.on("hide", () => {
    stopPetDrag();
    updateTrayMenu();
    publishSnapshot();
  });
  petWindow.on("closed", () => {
    stopPetDrag();
    petWindow = null;
    updateTrayMenu();
    publishSnapshot();
  });
}

function ensurePetWindowVisible(): void {
  if (!petWindow || petWindow.isDestroyed()) createPetWindow();
  if (petWindow && !petWindow.isVisible()) petWindow.showInactive();
  updateTrayMenu();
  publishSnapshot();
}

function createSettingsWindow(): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: SETTINGS_WINDOW.width,
    height: SETTINGS_WINDOW.height,
    title: `${APP_NAME} ${text().menu.settings}`,
    resizable: true,
    minWidth: SETTINGS_WINDOW.width,
    maxWidth: SETTINGS_WINDOW.width,
    minHeight: 400,
    show: false,
    backgroundColor: "#faf6ee",
    ...(process.platform === "darwin"
      ? { titleBarStyle: "hiddenInset" as const, trafficLightPosition: { x: 14, y: 14 } }
      : {}),
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: !IS_DEV
    }
  });

  loadRenderer(settingsWindow, "settings");
  settingsWindow.once("ready-to-show", () => {
    settingsWindow?.show();
    publishSnapshot();
  });
  settingsWindow.on("closed", () => {
    settingsWindow = null;
  });
}

function createChatWindow(): void {
  if (chatWindow && !chatWindow.isDestroyed()) {
    if (chatWindow.isMinimized()) chatWindow.restore();
    chatWindow.focus();
    return;
  }

  chatWindow = new BrowserWindow({
    width: CHAT_WINDOW.width,
    height: CHAT_WINDOW.height,
    title: `${APP_NAME} · AI`,
    resizable: true,
    minWidth: 640,
    minHeight: 480,
    show: false,
    backgroundColor: "#1f1b16",
    ...(process.platform === "darwin"
      ? { titleBarStyle: "hiddenInset" as const, trafficLightPosition: { x: 14, y: 14 } }
      : {}),
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: !IS_DEV
    }
  });

  loadRenderer(chatWindow, "chat");
  chatWindow.once("ready-to-show", () => {
    chatWindow?.show();
    publishSnapshot();
  });
  chatWindow.on("closed", () => {
    chatWindow = null;
  });
}

function createFrisbeeWindow(): void {
  if (frisbeeWindow && !frisbeeWindow.isDestroyed()) {
    frisbeeWindow.focus();
    return;
  }

  const workArea = screen.getPrimaryDisplay().workArea;
  const x = petWindow
    ? petWindow.getBounds().x + Math.round((petWindow.getBounds().width - FRISBEE_WINDOW.width) / 2)
    : Math.round(workArea.x + workArea.width / 2 - FRISBEE_WINDOW.width / 2);
  const y = petWindow
    ? Math.max(workArea.y + 8, petWindow.getBounds().y - FRISBEE_WINDOW.height - 8)
    : Math.round(workArea.y + workArea.height / 2 - FRISBEE_WINDOW.height / 2);

  frisbeeWindow = new BrowserWindow({
    width: FRISBEE_WINDOW.width,
    height: FRISBEE_WINDOW.height,
    x,
    y,
    title: `${APP_NAME} · 接飞盘`,
    resizable: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: !IS_DEV
    }
  });

  loadRenderer(frisbeeWindow, "frisbee");
  frisbeeWindow.once("ready-to-show", () => {
    frisbeeWindow?.show();
  });
  frisbeeWindow.on("closed", () => {
    frisbeeWindow = null;
  });
}

function createTray(): void {
  tray = new Tray(createTrayImage());
  tray.setToolTip(APP_NAME);
  tray.on("click", () => {
    tray?.popUpContextMenu();
  });
  if (process.platform !== "darwin") {
    nativeTheme.on("updated", () => tray?.setImage(createTrayImage()));
  }
  updateTrayMenu();
}

function actionMenuItems(): Electron.MenuItemConstructorOptions[] {
  const dogVisible = Boolean(petWindow?.isVisible());
  const labels = text().menu;
  return [
    {
      label: dogVisible ? labels.hideDog : labels.showDog,
      click: () => {
        if (!petWindow) createPetWindow();
        if (!petWindow) return;
        if (petWindow.isVisible()) petWindow.hide();
        else petWindow.showInactive();
        updateTrayMenu();
        sendToAll("app:snapshot", snapshot());
      }
    },
    {
      label: focusActive ? labels.stopFocusMode : labels.startFocusMode,
      click: () => {
        if (focusActive) stopFocusMode(true);
        else startFocusMode();
      }
    },
    ...(app.isPackaged
      ? []
      : [
          { type: "separator" as const },
          { label: labels.demoBreakReminder, click: () => triggerDemo("break") },
          { label: labels.demoHydrationReminder, click: () => triggerDemo("hydration") },
          { label: labels.demoFocusWarning, click: () => triggerDemo("focusWarning") },
          { label: labels.demoHappyReaction, click: () => triggerDemo("happy") }
        ]),
    { type: "separator" },
    { label: labels.settings, click: createSettingsWindow },
    { label: "AI 对话", click: createChatWindow }
  ];
}

function updateApplicationMenu(): void {
  const labels = text().menu;
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: APP_NAME,
      submenu: [
        ...actionMenuItems(),
        { type: "separator" },
        { role: "quit", label: labels.quit }
      ]
    },
    { role: "editMenu" },
    { role: "windowMenu" }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function updateTrayMenu(): void {
  updateApplicationMenu();
  if (!tray) return;
  const labels = text().menu;
  const template: Electron.MenuItemConstructorOptions[] = [
    { label: APP_NAME, enabled: false },
    { type: "separator" },
    ...actionMenuItems(),
    { type: "separator" },
    {
      label: labels.quit,
      click: () => {
        app.quit();
      }
    }
  ];
  tray.setContextMenu(Menu.buildFromTemplate(template));
}

function showPetContextMenu(): void {
  const labels = text().menu;
  const lang = resolveLanguage(getSettings().language);

  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: lang === "zh-CN" ? "🐾 状态面板" : "🐾 Status panel",
      click: () => togglePetPanel()
    },
    { type: "separator" },
    { label: labels.settings, click: createSettingsWindow },
    { label: "AI 对话", click: createChatWindow },
    {
      label: focusActive ? labels.stopFocusMode : labels.startFocusMode,
      click: () => {
        if (focusActive) stopFocusMode(false);
        else startFocusMode();
      }
    },
    ...(app.isPackaged
      ? []
      : [
          { type: "separator" as const },
          { label: labels.demoBreakReminder, click: () => triggerDemo("break") },
          { label: labels.demoHydrationReminder, click: () => triggerDemo("hydration") },
          { label: labels.demoFocusWarning, click: () => triggerDemo("focusWarning") },
          { label: labels.demoHappyReaction, click: () => triggerDemo("happy") }
        ]),
    { type: "separator" },
    {
      label: labels.hideDog,
      click: () => {
        petWindow?.hide();
        updateTrayMenu();
        sendToAll("app:snapshot", snapshot());
      }
    }
  ];

  Menu.buildFromTemplate(template).popup({ window: petWindow ?? undefined });
}

function feedItemFromMenu(itemId: string): void {
  const result = getVitalsStore().feed(itemId);
  if (!result.ok) {
    const labels = text();
    const msg =
      result.reason === "cooldown"
        ? "刚吃过了，等一会儿吧"
        : result.reason === "no_inventory"
        ? "背包里没有这个食物"
        : "出错了";
    showBubble({ id: "feed-fail", message: msg, autoDismissMs: 1800 });
    publishSnapshot();
    return;
  }
  setPetState("happy");
  const lang = resolveLanguage(getSettings().language);
  showBubble({
    id: `fed-${itemId}`,
    message: `${result.item.icon} ${result.item.label[lang]}！${pick(text().bubble.woof)}`,
    autoDismissMs: 2400
  });
  setTimeout(() => {
    if (!blockingMode) setPetState("idle");
  }, 2200);
  publishSnapshot();
}

function triggerStroke(): void {
  const result = getVitalsStore().petStroke();
  if (!result.ok) {
    showBubble({ id: "stroke-cooldown", message: "刚摸过啦，过会儿再来", autoDismissMs: 1500 });
    publishSnapshot();
    return;
  }
  setPetState("happy");
  showBubble({ id: "stroke", message: pick(text().bubble.woof), autoDismissMs: 1800 });
  setTimeout(() => {
    if (!blockingMode) setPetState("idle");
  }, 1700);
  publishSnapshot();
}

function startCompanionMinutes(minutes: number): void {
  getVitalsStore().startCompanion(minutes * 60_000);
  setPetState("sitting");
  showBubble({
    id: "companion-start",
    message: `开始陪伴模式 · ${minutes} 分钟～`,
    autoDismissMs: 2400
  });
  publishSnapshot();
}

function stopCompanionMode(): void {
  getVitalsStore().stopCompanion();
  showBubble({ id: "companion-end", message: "陪伴结束，谢谢你～", autoDismissMs: 1800 });
  setTimeout(() => {
    if (!blockingMode) setPetState("idle");
  }, 1700);
  publishSnapshot();
}

function triggerMiniGame(gameId: string): void {
  if (gameId === "frisbee") {
    createFrisbeeWindow();
    return;
  }
  showBubble({
    id: "mini-game-stub",
    message: "新游戏即将上线",
    autoDismissMs: 2200
  });
}

function movePetWithCursor(): void {
  if (!petWindow || petWindow.isDestroyed()) return;
  const cursor = screen.getCursorScreenPoint();
  const bounds = clampBoundsToWorkArea({
    width: PET_WINDOW.width,
    height: PET_WINDOW.height,
    x: cursor.x - dragOffset.x,
    y: cursor.y - dragOffset.y
  });
  petWindow.setBounds(bounds);
}

function startPetDrag(offset: { offsetX: number; offsetY: number }): void {
  if (blockingMode === "breakRun" || !petWindow || petWindow.isDestroyed()) return;
  dragOffset = {
    x: Math.min(Math.max(Math.round(offset.offsetX), 0), PET_WINDOW.width),
    y: Math.min(Math.max(Math.round(offset.offsetY), 0), PET_WINDOW.height)
  };
  if (dragTimer) clearInterval(dragTimer);
  if (dragSafetyTimer) clearTimeout(dragSafetyTimer);
  movePetWithCursor();
  dragTimer = setInterval(movePetWithCursor, 16);
  dragSafetyTimer = setTimeout(stopPetDrag, 15_000);
}

function stopPetDrag(): void {
  const wasDragging = Boolean(dragTimer || dragSafetyTimer);
  if (dragTimer) {
    clearInterval(dragTimer);
    dragTimer = null;
  }
  if (dragSafetyTimer) {
    clearTimeout(dragSafetyTimer);
    dragSafetyTimer = null;
  }
  if (wasDragging) {
    persistPetPosition();
    sendToAll("app:snapshot", snapshot());
  }
}

function clearBreakRunTimers(): void {
  if (breakRunTimer) {
    clearTimeout(breakRunTimer);
    breakRunTimer = null;
  }
  if (breakRunCountdownTimer) {
    clearInterval(breakRunCountdownTimer);
    breakRunCountdownTimer = null;
  }
  if (breakRunMovementTimer) {
    clearInterval(breakRunMovementTimer);
    breakRunMovementTimer = null;
  }
}

function showBreakRunCountdown(endsAt: number): void {
  const labels = text();
  const remainingSeconds = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
  const formatter = breakRunFormatter ?? pick(labels.bubble.breakRun);
  showBubble({
    id: "break-run",
    message: formatter(remainingSeconds),
    actions: [{ id: "break-run:done", label: labels.actions.breakRunDone, kind: "primary" }]
  });
}

function chooseBreakRunVelocity(): PetPosition {
  const speed = 3.5 + Math.random() * 2.9;
  const angle = Math.random() * Math.PI * 2;
  return {
    x: Math.cos(angle) * speed,
    y: Math.sin(angle) * speed
  };
}

function movePetForBreakRun(): void {
  if (!petWindow || petWindow.isDestroyed() || !petWindow.isVisible()) return;

  const bounds = petWindow.getBounds();
  const workArea = screen.getDisplayNearestPoint({
    x: bounds.x + Math.round(bounds.width / 2),
    y: bounds.y + Math.round(bounds.height / 2)
  }).workArea;
  const now = Date.now();
  const minX = workArea.x + 8;
  const maxX = workArea.x + workArea.width - PET_WINDOW.width - 8;
  const minY = workArea.y + 8;
  const maxY = workArea.y + workArea.height - PET_WINDOW.height - 8;

  if (now >= nextBreakRunTurnAt && Math.random() < 0.45) {
    breakRunVelocity = chooseBreakRunVelocity();
  }

  let nextX = bounds.x + breakRunVelocity.x;
  let nextY = bounds.y + breakRunVelocity.y;

  if (nextX <= minX) {
    nextX = minX;
    breakRunVelocity.x = Math.abs(breakRunVelocity.x);
  }
  if (nextX >= maxX) {
    nextX = maxX;
    breakRunVelocity.x = -Math.abs(breakRunVelocity.x);
  }
  if (nextY <= minY) {
    nextY = minY;
    breakRunVelocity.y = Math.abs(breakRunVelocity.y);
  }
  if (nextY >= maxY) {
    nextY = maxY;
    breakRunVelocity.y = -Math.abs(breakRunVelocity.y);
  }

  if (now >= nextBreakRunTurnAt) {
    nextBreakRunTurnAt = now + 350 + Math.round(Math.random() * 850);
  }

  setPetFacing(breakRunVelocity.x >= 0 ? "right" : "left");
  petWindow.setBounds({
    ...bounds,
    x: Math.round(nextX),
    y: Math.round(nextY)
  });
}

function finishBreakRun(): void {
  clearBreakRunTimers();
  breakRunFormatter = null;
  blockingMode = null;
  hideBubble();
  showBubble({ id: "break-run-complete", message: pick(text().bubble.breakRunComplete), autoDismissMs: 2200 });
  setPetState("breakDone");
  setTimeout(() => {
    if (!blockingMode && !focusActive) {
      hideBubble();
      setPetState("idle");
      scheduleReminderTimers();
    }
  }, 2300);
  publishSnapshot();
}

function startBreakRun(): void {
  ensurePetWindowVisible();
  clearBreakRunTimers();
  blockingMode = "breakRun";
  breakDueAt = null;
  breakRunFormatter = pick(text().bubble.breakRun);
  breakRunVelocity = chooseBreakRunVelocity();
  nextBreakRunTurnAt = Date.now();
  setPetState("breakRunning");
  setPetFacing(breakRunVelocity.x >= 0 ? "right" : "left");
  const endsAt = Date.now() + BREAK_RUN_DURATION_MS;
  showBreakRunCountdown(endsAt);
  breakRunCountdownTimer = setInterval(() => showBreakRunCountdown(endsAt), 1000);
  breakRunMovementTimer = setInterval(movePetForBreakRun, BREAK_RUN_TICK_MS);
  breakRunTimer = setTimeout(finishBreakRun, BREAK_RUN_DURATION_MS);
  publishSnapshot();
}

function scheduleReminderTimers(): void {
  if (breakTimer) clearTimeout(breakTimer);
  if (hydrationTimer) clearTimeout(hydrationTimer);
  breakDueAt = null;
  hydrationDueAt = null;

  const settings = getSettings();
  if (settings.breakReminderEnabled && !breakMutedToday) {
    breakDueAt = Date.now() + settings.breakIntervalMinutes * 60 * 1000;
    breakTimer = setTimeout(
      () => triggerBreakReminder(false),
      settings.breakIntervalMinutes * 60 * 1000
    );
  }
  if (settings.hydrationReminderEnabled) {
    hydrationDueAt = Date.now() + settings.hydrationIntervalMinutes * 60 * 1000;
    hydrationTimer = setTimeout(
      () => triggerHydrationReminder(false),
      settings.hydrationIntervalMinutes * 60 * 1000
    );
  }
  publishSnapshot();
}

function setDistractionStatus(partial: Partial<DistractionStatus>): void {
  distractionStatus = { ...distractionStatus, ...partial };
  publishSnapshot();
}

async function checkDistractionNow(): Promise<void> {
  const settings = getSettings();
  if (!settings.distractionDetectionEnabled) return;

  try {
    const active = await readActiveWindow();
    const matchedRule = classifyDistraction(active, settings);
    const now = Date.now();

    setDistractionStatus({
      state: "watching",
      activeApp: active.appName,
      activeWindowTitle: active.windowTitle,
      matchedRule,
      lastCheckedAt: now,
      error: null
    });

    if (!focusActive || blockingMode === "focusWarning") return;
    if (!matchedRule) return;
    if (
      distractionStatus.lastWarningAt &&
      now - distractionStatus.lastWarningAt < DISTRACTION_WARNING_COOLDOWN_MS
    ) {
      return;
    }

    setDistractionStatus({ lastWarningAt: now });
    triggerFocusWarning(matchedRule.replace(/^(app|keyword):/, ""));
  } catch (error) {
    setDistractionStatus({
      state: isPermissionError(error) ? "permission-needed" : "error",
      error: error instanceof Error ? error.message : String(error),
      lastCheckedAt: Date.now()
    });
  }
}

function scheduleDistractionDetection(): void {
  if (distractionTimer) {
    clearInterval(distractionTimer);
    distractionTimer = null;
  }
  if (distractionStartupTimer) {
    clearTimeout(distractionStartupTimer);
    distractionStartupTimer = null;
  }

  const settings = getSettings();
  if (!settings.distractionDetectionEnabled) {
    setDistractionStatus({
      state: "idle",
      matchedRule: null,
      error: null
    });
    return;
  }

  setDistractionStatus({
    state: process.platform === "darwin" ? "watching" : "unsupported",
    error: process.platform === "darwin" ? null : text().system.unsupportedDistraction
  });

  if (process.platform !== "darwin") return;

  const firstCheckDelay = focusActive ? Math.max(0, settings.distractionGraceSeconds * 1000) : 0;
  distractionStartupTimer = setTimeout(() => {
    void checkDistractionNow();
    distractionTimer = setInterval(() => void checkDistractionNow(), DISTRACTION_CHECK_INTERVAL_MS);
  }, firstCheckDelay);
}

function resumeLongTermState(): void {
  blockingMode = null;
  hideBubble();
  if (focusActive) {
    setPetState("focusGuard");
    sendToAll("app:snapshot", snapshot());
    return;
  }
  setPetState("idle");
  sendToAll("app:snapshot", snapshot());
}

function happyFeedback(message: string | null = pick(text().bubble.woof), after?: () => void): void {
  if (blockingMode) return;
  const returnState = focusActive ? "focusGuard" : "idle";
  setPetState("happy");
  const aiReady = isAiReady();
  if (message) {
    showBubble({
      id: "happy",
      message,
      autoDismissMs: aiReady ? 4500 : 1800,
      actions: aiReady
        ? [{ id: "ai:open-chat", label: "聊一会儿", kind: "primary" }]
        : undefined
    });
  }
  setTimeout(() => {
    setPetState(returnState);
    if (!aiReady) hideBubble();
    after?.();
  }, 1900);
}

function isAiReady(): boolean {
  try {
    const settings = getAiService().loadSettings();
    return settings.apiKey.trim().length > 0;
  } catch {
    return false;
  }
}

function triggerBreakReminder(fromDemo: boolean): void {
  if (blockingMode === "focusWarning" || blockingMode === "breakRun") return;
  if (!fromDemo && (focusActive || breakMutedToday)) {
    scheduleReminderTimers();
    return;
  }
  ensurePetWindowVisible();
  blockingMode = "break";
  breakDueAt = null;
  publishSnapshot();
  setPetState("breakPrompt");
  const labels = text();
  showBubble({
    id: "break",
    message: pick(labels.bubble.breakReminder),
    actions: [
      { id: "break:done", label: labels.actions.breakDone, kind: "primary" },
      { id: "break:snooze", label: labels.actions.breakSnooze },
      { id: "break:mute", label: labels.actions.breakMute, kind: "danger" }
    ]
  });
}

function triggerHydrationReminder(fromDemo: boolean): void {
  if (blockingMode || (!fromDemo && focusActive)) {
    scheduleReminderTimers();
    return;
  }
  ensurePetWindowVisible();
  blockingMode = "hydration";
  hydrationDueAt = null;
  publishSnapshot();
  setPetState("hydrationPrompt");
  const labels = text();
  showBubble({
    id: "hydration",
    message: pick(labels.bubble.hydrationReminder),
    actions: [
      { id: "hydration:done", label: labels.actions.hydrationDone, kind: "primary" },
      { id: "hydration:snooze", label: labels.actions.hydrationSnooze }
    ]
  });
}

function triggerFocusWarning(rule?: string): void {
  if (blockingMode === "breakRun") return;
  ensurePetWindowVisible();
  if (!focusActive) startFocusMode();
  blockingMode = "focusWarning";
  updateStats((stats) => ({ ...stats, focusWarnings: stats.focusWarnings + 1 }));
  setPetState("focusAlert");
  sendToAll("app:snapshot", snapshot());
  const labels = text();
  showBubble({
    id: "focus-warning",
    message: pick(labels.bubble.focusWarning)(rule ?? "?"),
    actions: [
      { id: "focus:back", label: labels.actions.focusBack, kind: "primary" },
      { id: "focus:end", label: labels.actions.focusEnd }
    ]
  });
}

function startFocusMode(): void {
  if (focusActive || blockingMode) return;
  ensurePetWindowVisible();
  const settings = getSettings();
  focusActive = true;
  focusStartedAt = Date.now();
  blockingMode = null;
  setPetState("focusGuard");
  focusEndsAt = Date.now() + settings.focusDurationMinutes * 60 * 1000;
  sendToAll("app:snapshot", snapshot());
  showBubble({
    id: "focus-start",
    message: pick(text().bubble.focusStart)(settings.focusDurationMinutes),
    autoDismissMs: 4500
  });
  if (focusTimer) clearTimeout(focusTimer);
  focusTimer = setTimeout(
    () => stopFocusMode(true),
    settings.focusDurationMinutes * 60 * 1000
  );
  scheduleDistractionDetection();
  updateTrayMenu();
}

function stopFocusMode(completed: boolean): void {
  if (!focusActive) return;
  const startedAt = focusStartedAt ?? Date.now();
  const elapsedMinutes = Math.max(1, Math.round((Date.now() - startedAt) / 60000));
  focusActive = false;
  focusStartedAt = null;
  blockingMode = null;
  if (focusTimer) {
    clearTimeout(focusTimer);
    focusTimer = null;
  }
  focusEndsAt = null;
  scheduleDistractionDetection();
  updateStats((stats) => ({
    ...stats,
    focusMinutes: stats.focusMinutes + elapsedMinutes
  }));
  if (completed) {
    // Pomodoro success — pay the user, then check if a surprise gift
    // should drop. Vitals snapshot is republished after maybeDropGift so
    // the renderer sees the new coin total + pending gift in one update.
    getVitalsStore().earn(COIN_REWARDS.pomodoroComplete);
    getVitalsStore().recordPomodoro();
    maybeDropPomodoroGift();
  }
  sendToAll("app:snapshot", snapshot());
  setPetState("focusDone");
  showBubble({
    id: "focus-complete",
    message: completed ? pick(text().bubble.focusComplete) : pick(text().bubble.focusCancelled),
    autoDismissMs: 2800
  });
  setTimeout(() => {
    if (!focusActive && !blockingMode) {
      hideBubble();
      setPetState("idle");
    }
  }, 2900);
  updateTrayMenu();
}

function triggerDemo(trigger: DemoTrigger): void {
  ensurePetWindowVisible();
  if (trigger === "break") triggerBreakReminder(true);
  if (trigger === "hydration") triggerHydrationReminder(true);
  if (trigger === "focusWarning") triggerFocusWarning("Twitter");
  if (trigger === "happy") happyFeedback(pick(text().bubble.woof));
}

function handleBubbleAction(actionId: string): void {
  if (actionId === "break-run:done") {
    finishBreakRun();
    return;
  }
  if (actionId === "break:done") {
    updateStats((stats) => ({ ...stats, breaksTaken: stats.breaksTaken + 1 }));
    getVitalsStore().earn(COIN_REWARDS.breakLogged);
    startBreakRun();
    return;
  }
  if (actionId === "break:snooze") {
    resumeLongTermState();
    if (breakTimer) clearTimeout(breakTimer);
    breakDueAt = Date.now() + 10 * 60 * 1000;
    breakTimer = setTimeout(() => triggerBreakReminder(false), 10 * 60 * 1000);
    publishSnapshot();
    return;
  }
  if (actionId === "break:mute") {
    breakMutedToday = true;
    breakDueAt = null;
    blockingMode = null;
    sendToAll("app:snapshot", snapshot());
    setPetState("sad");
    showBubble({ id: "break-muted", message: pick(text().bubble.breakIgnore), autoDismissMs: 2600 });
    setTimeout(resumeLongTermState, 2700);
    return;
  }
  if (actionId === "hydration:done") {
    updateStats((stats) => ({ ...stats, watersLogged: stats.watersLogged + 1 }));
    getVitalsStore().earn(COIN_REWARDS.hydrationLogged);
    blockingMode = null;
    sendToAll("app:snapshot", snapshot());
    setPetState("drinking");
    hideBubble();
    setTimeout(() => {
      if (blockingMode) return;
      setPetState("hydrationDone");
      showBubble({ id: "hydration-complete", message: pick(text().bubble.hydrationDone), autoDismissMs: 1800 });
      setTimeout(() => {
        hideBubble();
        setPetState(focusActive ? "focusGuard" : "idle");
        scheduleReminderTimers();
      }, 1900);
    }, 2400);
    return;
  }
  if (actionId === "hydration:snooze") {
    resumeLongTermState();
    if (hydrationTimer) clearTimeout(hydrationTimer);
    hydrationDueAt = Date.now() + 15 * 60 * 1000;
    hydrationTimer = setTimeout(() => triggerHydrationReminder(false), 15 * 60 * 1000);
    publishSnapshot();
    return;
  }
  if (actionId === "focus:back") {
    blockingMode = null;
    sendToAll("app:snapshot", snapshot());
    setPetState("focusGuard");
    showBubble({ id: "focus-back", message: pick(text().bubble.focusBack), autoDismissMs: 1800 });
    setTimeout(() => {
      if (focusActive && !blockingMode) hideBubble();
    }, 1900);
    return;
  }
  if (actionId === "focus:end") {
    stopFocusMode(false);
    return;
  }
  if (actionId === "ai:open-chat") {
    void enterChatBubble();
    return;
  }
  if (actionId === "ai:open-window") {
    hideBubble();
    createChatWindow();
    return;
  }
  if (actionId === "ai:close-chat") {
    hideBubble();
    return;
  }

  // Vitals bubble actions ----------------------------------------------------
  if (actionId.startsWith("vitals:feed:")) {
    const itemId = actionId.slice("vitals:feed:".length);
    feedItemFromMenu(itemId);
    return;
  }
  if (actionId.startsWith("vitals:play:")) {
    const gameId = actionId.slice("vitals:play:".length);
    triggerMiniGame(gameId);
    return;
  }
  if (actionId.startsWith("vitals:companion:")) {
    const minutes = Number(actionId.slice("vitals:companion:".length));
    if (Number.isFinite(minutes) && minutes > 0) {
      startCompanionMinutes(minutes);
    }
    return;
  }
  if (actionId === "vitals:stroke") {
    triggerStroke();
    return;
  }
  if (actionId === "vitals:claim-gift") {
    const result = getVitalsStore().claimGift();
    if (result.gift) {
      const gift = result.gift;
      const parts: string[] = [];
      if (gift.coins) parts.push(`+${gift.coins} 🦴`);
      if (gift.itemId) {
        const item = getItemById(gift.itemId);
        if (item) parts.push(`+1 ${item.icon} ${item.label["zh-CN"]}`);
      }
      setPetState("happy");
      showBubble({
        id: "gift-claimed",
        message: `谢谢你！${parts.join(" · ")}`,
        autoDismissMs: 2400
      });
    }
    publishSnapshot();
    return;
  }
  if (actionId === "vitals:open-status") {
    hideBubble();
    createSettingsWindow();
    return;
  }
  if (actionId === "vitals:dismiss") {
    hideBubble();
    return;
  }
}

async function enterChatBubble(): Promise<void> {
  try {
    const list = await getAiService().listSessions();
    const session = list[0] ?? (await getAiService().newSession("聊一会儿"));
    showBubble({
      id: "ai-chat",
      message: "",
      mode: "chat",
      chat: { sessionId: session.id },
      actions: [
        { id: "ai:open-window", label: "完整窗口", kind: "secondary" },
        { id: "ai:close-chat", label: "收起", kind: "secondary" }
      ]
    });
  } catch (err) {
    console.error("Failed to enter chat bubble:", err);
  }
}

function registerIpc(): void {
  ipcMain.handle("app:get-snapshot", () => snapshot());
  ipcMain.on("app:open-release-notes", () => {
    void shell.openExternal(RELEASES_URL).catch((error) => {
      console.error("Failed to open AI-WorkPet releases:", error);
    });
  });
  ipcMain.on("pet:clicked", () => {
    if (blockingMode) return;
    lastUserInteractionAt = Date.now();
    togglePetPanel();
  });
  ipcMain.on("pet:context-menu", showPetContextMenu);
  ipcMain.on("pet:toggle-panel", () => {
    lastUserInteractionAt = Date.now();
    togglePetPanel();
  });
  ipcMain.on("app:open-settings", () => createSettingsWindow());
  ipcMain.on("pet:drag-start", (_event, offset: { offsetX: number; offsetY: number }) =>
    startPetDrag(offset)
  );
  ipcMain.on("pet:drag-stop", stopPetDrag);
  ipcMain.on("bubble:action", (_event, actionId: string) => {
    lastUserInteractionAt = Date.now();
    handleBubbleAction(actionId);
  });
  ipcMain.on("settings:update", (_event, partial: Partial<Settings>) => {
    setSettings({ ...getSettings(), ...partial });
  });
  ipcMain.on("demo:trigger", (_event, trigger: DemoTrigger) => triggerDemo(trigger));
  ipcMain.on("focus:start", startFocusMode);
  ipcMain.on("focus:stop", () => stopFocusMode(false));
  ipcMain.on("stats:reset-today", resetTodayStats);

  registerVitalsIpc();

  // AI subsystem (see docs/ai-design.md). Lazy-initialised so that any error
  // here does not break PawPal's existing reminder / focus / animation core.
  registerAiIpc();
}

let aiServiceSingleton: ChatService | null = null;
function getAiService(): ChatService {
  if (!aiServiceSingleton) {
    const settingsStore = new AiSettingsStore();
    const historyStore = new ChatHistoryStore();
    aiServiceSingleton = new ChatService(
      settingsStore,
      historyStore,
      buildAiVitalsContext
    );
  }
  return aiServiceSingleton;
}

/**
 * Build the runtime context block we prepend to the user's systemPrompt so
 * AI responses can naturally reference the pet's current state (hungry,
 * level, etc.). Kept short — this is overhead on every request and shouldn't
 * dominate token budget.
 */
function buildAiVitalsContext(): string {
  try {
    const v = getVitalsStore().get();
    const lvl = computeLevel(v.exp);
    const lastFedMs =
      v.cooldowns["feed:any"] !== undefined
        ? Date.now() - (v.cooldowns["feed:any"] - 60_000)
        : null;
    const lastFedHint =
      lastFedMs !== null && lastFedMs > 0
        ? `${Math.round(lastFedMs / 60_000)} 分钟前刚被投喂`
        : "今天还没被投喂";
    const playsTotal = Object.values(v.today.playCount).reduce(
      (sum, n) => sum + n,
      0
    );
    const companion =
      v.companionUntil && v.companionUntil > Date.now()
        ? `；正处于陪伴模式（剩余 ${Math.ceil(
            (v.companionUntil - Date.now()) / 60_000
          )} 分钟）`
        : "";
    return [
      "你是用户的桌面宠物。",
      `当前状态：饱腹度 ${Math.round(v.hunger)}/100、心情 ${Math.round(
        v.mood
      )}/100、精力 ${Math.round(v.energy)}/100。`,
      `等级 Lv${lvl.level}（${lvl.label}），${lastFedHint}，今天玩了 ${playsTotal} 次小游戏${companion}。`,
      "请用宠物视角回应主人，回应贴合上述状态（饿了想吃、困了想睡、满状态时撒娇等）。",
    ].join("\n");
  } catch {
    return "";
  }
}

let vitalsStoreSingleton: VitalsStore | null = null;
function getVitalsStore(): VitalsStore {
  if (!vitalsStoreSingleton) vitalsStoreSingleton = new VitalsStore();
  return vitalsStoreSingleton;
}

function currentVitalsContext(): RuntimeContext {
  const v = getVitalsStore().get();
  if (v.companionUntil && v.companionUntil > Date.now()) return "companion";
  if (focusActive) return "focus";
  if (blockingMode === "breakRun") return "break";
  return "idle";
}

function startVitalsTick(): void {
  if (vitalsTickTimer) clearInterval(vitalsTickTimer);
  vitalsTickTimer = setInterval(() => {
    getVitalsStore().tick(currentVitalsContext());
    publishSnapshot();
    maybeShowThresholdBubble();
  }, VITALS_TICK_MS);
}

const lastThresholdAt: Record<string, number> = {};
const THRESHOLD_COOLDOWN_MS = 10 * 60 * 1000;

function maybeShowThresholdBubble(): void {
  if (blockingMode) return;
  if (petWindowMode !== "compact") return; // panel/chat are open — don't compete with them.
  const v = getVitalsStore().get();
  const now = Date.now();

  // 1. Pending gift always wins — it's a positive surprise, short cooldown.
  if (v.pendingGift && (lastThresholdAt.gift ?? 0) + 60_000 < now) {
    lastThresholdAt.gift = now;
    setPetState("happy");
    showBubble({
      id: "vitals-gift",
      message: "看我捡到了什么！",
      autoDismissMs: 12_000,
      actions: [{ id: "vitals:claim-gift", label: "领取 🎁", kind: "primary" }]
    });
    return;
  }

  if (
    v.hunger < 30 &&
    (lastThresholdAt.hunger ?? 0) + THRESHOLD_COOLDOWN_MS < now
  ) {
    lastThresholdAt.hunger = now;
    const cheapest = pickFedCandidateFromInventory(v);
    setPetState("sad");
    showBubble({
      id: "vitals-hunger-low",
      message: "肚子饿了…",
      autoDismissMs: 8000,
      actions: cheapest
        ? [
            {
              id: `vitals:feed:${cheapest.id}`,
              label: `${cheapest.icon} 投喂`,
              kind: "primary"
            },
            { id: "vitals:open-status", label: "打开背包" }
          ]
        : [{ id: "vitals:open-status", label: "打开背包", kind: "primary" }]
    });
    return;
  }

  if (v.mood < 30 && (lastThresholdAt.mood ?? 0) + THRESHOLD_COOLDOWN_MS < now) {
    lastThresholdAt.mood = now;
    setPetState("sad");
    showBubble({
      id: "vitals-mood-low",
      message: "好无聊…陪我玩会儿？",
      autoDismissMs: 8000,
      actions: [
        { id: "vitals:play:frisbee", label: "🥏 接飞盘", kind: "primary" },
        { id: "vitals:stroke", label: "🐾 摸摸头" }
      ]
    });
    return;
  }

  if (
    v.energy < 20 &&
    (lastThresholdAt.energy ?? 0) + THRESHOLD_COOLDOWN_MS < now
  ) {
    lastThresholdAt.energy = now;
    setPetState("sleeping");
    showBubble({
      id: "vitals-energy-low",
      message: "困了…让我睡一会儿？",
      autoDismissMs: 8000,
      actions: [
        { id: "vitals:companion:30", label: "陪它睡 30min", kind: "primary" },
        { id: "vitals:dismiss", label: "等会再说" }
      ]
    });
    return;
  }

  // Proactive "wanna play?" — only after the user has been ignoring the pet
  // for a while and only if mood is sagging. Daily cap prevents nagging.
  const idleMs = now - lastUserInteractionAt;
  if (
    v.today.proactivePlayShown < 3 &&
    v.mood < 60 &&
    idleMs > 12 * 60 * 1000 &&
    (lastThresholdAt.proactive ?? 0) + THRESHOLD_COOLDOWN_MS < now
  ) {
    lastThresholdAt.proactive = now;
    getVitalsStore().incrementProactivePlayShown();
    setPetState("happy");
    showBubble({
      id: "vitals-proactive-play",
      message: "陪我玩一会儿？",
      autoDismissMs: 12_000,
      actions: [
        { id: "vitals:play:frisbee", label: "🥏 来啊", kind: "primary" },
        { id: "vitals:dismiss", label: "等会再说" }
      ]
    });
  }
}

function pickFedCandidateFromInventory(
  vitals: PetVitals
): { id: string; icon: string } | null {
  const lang = resolveLanguage(getSettings().language);
  const species = getPetSpecies(resolvePetAppearanceId(getSettings().petAppearanceId));
  const level = computeLevel(vitals.exp).level;
  const visible = visibleItemsFor(species, level);
  // Cheapest first — quickest path to recovery.
  const sorted = visible
    .map((it) => ({ item: it, count: vitals.inventory[it.id] ?? 0 }))
    .filter((entry) => entry.count > 0)
    .sort((a, b) => a.item.price - b.item.price);
  if (sorted.length === 0) return null;
  const top = sorted[0].item;
  // `lang` is read here just to silence lint about unused — labels live in
  // i18n elsewhere; emoji + id is what bubble actions need.
  void lang;
  return { id: top.id, icon: top.icon };
}

/**
 * After every 3rd Pomodoro of the day there's a 15% chance the pet drops a
 * surprise gift. Reward roll: 60% coin pile, 30% random cheap food, 10%
 * jackpot coin pile.
 */
function maybeDropPomodoroGift(): void {
  const v = getVitalsStore().get();
  if (v.pendingGift) return;
  if (v.today.pomodorosCompleted % 3 !== 0) return;
  if (Math.random() > 0.15) return;

  const roll = Math.random();
  if (roll < 0.6) {
    const coins = Math.floor(Math.random() * 16) + 5; // 5..20
    getVitalsStore().queueGift({ source: "pomodoro", coins });
  } else if (roll < 0.9) {
    // Pick a random non-locked item that applies to the active species.
    const species = getPetSpecies(resolvePetAppearanceId(getSettings().petAppearanceId));
    const level = computeLevel(v.exp).level;
    const candidates = visibleItemsFor(species, level).filter(
      (it) => (it.minLevel ?? 1) <= level
    );
    if (candidates.length > 0) {
      const pick = candidates[Math.floor(Math.random() * candidates.length)];
      getVitalsStore().queueGift({ source: "pomodoro", itemId: pick.id });
    } else {
      getVitalsStore().queueGift({ source: "pomodoro", coins: 10 });
    }
  } else {
    const coins = Math.floor(Math.random() * 16) + 20; // 20..35 jackpot
    getVitalsStore().queueGift({ source: "pomodoro", coins });
  }
}

function registerVitalsIpc(): void {
  const reply = <T>(payload: T): T => {
    publishSnapshot();
    return payload;
  };

  ipcMain.handle("vitals:get", () => getVitalsStore().get());

  ipcMain.handle("vitals:feed", (_event, itemId: string) =>
    reply(getVitalsStore().feed(itemId))
  );

  ipcMain.handle("vitals:buy", (_event, itemId: string, qty?: number) =>
    reply(getVitalsStore().buy(itemId, qty ?? 1))
  );

  ipcMain.handle(
    "vitals:play",
    (_event, gameId: string, score: number, requiredScore: number) => {
      const game = getGameById(gameId);
      if (!game) {
        return reply({ ok: false as const, reason: "unknown_game" as const });
      }
      const bonus = score >= requiredScore;
      const vitals = getVitalsStore().recordGamePlay(
        gameId,
        bonus,
        game.baseReward,
        game.bonusReward
      );
      return reply({ ok: true as const, bonus, score, vitals });
    }
  );

  ipcMain.handle("vitals:pet-stroke", () => reply(getVitalsStore().petStroke()));

  ipcMain.handle("vitals:start-companion", (_event, minutes: number) => {
    const ms = Math.max(1, Math.round(minutes)) * 60_000;
    return reply(getVitalsStore().startCompanion(ms));
  });

  ipcMain.handle("vitals:stop-companion", () =>
    reply(getVitalsStore().stopCompanion())
  );

  ipcMain.handle("vitals:claim-gift", () => reply(getVitalsStore().claimGift()));
}

function registerAiIpc(): void {
  ipcMain.handle("ai:get-settings", (): AiSettings => getAiService().loadSettings());
  ipcMain.handle("ai:save-settings", (_event, payload: AiSettings): AiSettings =>
    getAiService().saveSettings(payload)
  );

  ipcMain.handle("ai:list-sessions", () => getAiService().listSessions());
  ipcMain.handle("ai:get-session", (_event, id: string) => getAiService().getSession(id));
  ipcMain.handle("ai:new-session", (_event, title?: string) =>
    getAiService().newSession(title)
  );
  ipcMain.handle("ai:delete-session", (_event, id: string) =>
    getAiService().deleteSession(id)
  );

  ipcMain.handle(
    "ai:send",
    async (event, payload: { sessionId: string; userText: string }) => {
      const sender = event.sender;
      const requestId = randomUUID();
      await getAiService().send(
        payload.sessionId,
        payload.userText,
        {
          onDelta: (delta) => {
            if (!sender.isDestroyed()) {
              sender.send("ai:delta", { requestId, delta });
            }
          },
          onDone: (finalMessage) => {
            if (!sender.isDestroyed()) {
              sender.send("ai:done", { requestId, finalMessage });
            }
          },
          onError: (message) => {
            if (!sender.isDestroyed()) {
              sender.send("ai:error", { requestId, message });
            }
          },
        },
        requestId
      );
      return { requestId };
    }
  );

  ipcMain.on("ai:stop", (_event, requestId: string) => {
    getAiService().stop(requestId);
  });

  ipcMain.on("chat:open-window", () => {
    createChatWindow();
  });

  ipcMain.handle(
    "frisbee:report",
    async (_event, payload: { score: number; requiredScore: number; cancelled: boolean }) => {
      const game = getGameById("frisbee");
      if (!game) return null;
      if (payload.cancelled) {
        // No reward, but pet still feels played-with — small mood bump only.
        return null;
      }
      const bonus = payload.score >= payload.requiredScore;
      const vitals = getVitalsStore().recordGamePlay(
        "frisbee",
        bonus,
        game.baseReward,
        game.bonusReward
      );
      // After scoring, animate pet briefly then publish.
      setPetState(bonus ? "happy" : "breakDone");
      showBubble({
        id: "frisbee-result",
        message: bonus
          ? `精彩！${game.bonusReward.coins + game.baseReward.coins} 🦴 + ${game.bonusReward.mood + game.baseReward.mood} 心情`
          : `辛苦了，${game.baseReward.coins} 🦴 + ${game.baseReward.mood} 心情`,
        autoDismissMs: 3200
      });
      setTimeout(() => {
        if (!blockingMode) setPetState("idle");
      }, 3200);
      publishSnapshot();
      return vitals;
    }
  );

  ipcMain.on("frisbee:close", () => {
    if (frisbeeWindow && !frisbeeWindow.isDestroyed()) {
      frisbeeWindow.close();
    }
  });
}

protocol.registerSchemesAsPrivileged([
  { scheme: "pawpal-asset", privileges: { bypassCSP: true, supportFetchAPI: true } }
]);

app.whenReady().then(() => {
  protocol.handle("pawpal-asset", (request) => {
    let relativePath = "";
    try {
      const url = new URL(request.url);
      relativePath = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
    } catch {
      return new Response("Invalid asset URL", { status: 404 });
    }

    const base = app.isPackaged ? process.resourcesPath : process.cwd();
    const assetRoot = resolve(base, "pet_assets");
    const assetPath = resolve(base, relativePath);
    const isInsideAssetRoot = assetPath === assetRoot || assetPath.startsWith(`${assetRoot}${sep}`);

    if (!isInsideAssetRoot) {
      return new Response("Asset not found", { status: 404 });
    }

    return net.fetch(pathToFileURL(assetPath).href);
  });

  getStats();
  registerIpc();
  createPetWindow();
  createTray();
  scheduleReminderTimers();
  scheduleDistractionDetection();
  // Daily check-in claims a coin bonus and resets day-scoped vitals counters
  // if the user crossed midnight since last open.
  getVitalsStore().claimCheckin();
  startVitalsTick();
  if (IS_DEV) {
    createSettingsWindow();
  }

  app.on("activate", () => {
    if (!petWindow) createPetWindow();
  });
});

app.on("before-quit", () => {
  for (const timer of [
    breakRunTimer,
    breakRunCountdownTimer,
    breakRunMovementTimer,
    breakTimer,
    hydrationTimer,
    focusTimer,
    distractionTimer,
    distractionStartupTimer,
    bubbleTimer,
    dragTimer,
    dragSafetyTimer,
    vitalsTickTimer
  ]) {
    if (timer) clearTimeout(timer);
  }
  if (vitalsTickTimer) clearInterval(vitalsTickTimer);
});

app.on("window-all-closed", () => {
  // Keep the menu-bar utility alive after the settings window is closed.
});
