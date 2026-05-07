import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const APP_NAME = "AI-WorkPet";
export const STORE_NAME = "pawpal";
export const RELEASES_URL = "https://github.com/WJAnnie/PawPal/releases";

export const PET_WINDOW = {
  width: 220,
  height: 340
} as const;

export const PET_WINDOW_CHAT = {
  width: 360,
  height: 540
} as const;

export const PET_WINDOW_PANEL = {
  width: 380,
  height: 560
} as const;

export const SETTINGS_WINDOW = {
  width: 760,
  height: 680
} as const;

export const CHAT_WINDOW = {
  width: 880,
  height: 640
} as const;

export const FRISBEE_WINDOW = {
  width: 360,
  height: 280
} as const;

export const PRELOAD_PATH = join(__dirname, "../preload/index.cjs");
export const RENDERER_HTML_PATH = join(__dirname, "../renderer/index.html");
export const IS_DEV = Boolean(process.env.ELECTRON_RENDERER_URL);

export const DISTRACTION_CHECK_INTERVAL_MS = 3000;
export const DISTRACTION_WARNING_COOLDOWN_MS = 60_000;
export const BREAK_RUN_DURATION_MS = 60_000;
export const BREAK_RUN_TICK_MS = 16;
