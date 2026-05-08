import Store from "electron-store";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  type CustomAppearanceManifest,
  isValidCustomAppearanceManifest,
  validateCustomAppearanceName
} from "../shared/customAppearance";
import type { PetState } from "../shared/types";

interface CustomAppearanceStoreSchema {
  customAppearances?: Record<string, CustomAppearanceManifest>;
}

interface ElectronStoreLike {
  get(key: string, defaultValue?: unknown): unknown;
  set(key: string, value: unknown): void;
  delete(key: string): void;
  has(key: string): boolean;
}

const KEY = "customAppearances";
const ASSETS_DIR_NAME = "customAssets";
const ID_BYTES = 6;

/**
 * Persists user-imported custom pet appearances. Each appearance owns a
 * folder userData/customAssets/<bareId>/ with per-state image files; the
 * manifest record is stored under the customAppearances root key of the
 * shared pawpal electron-store. Source files are copied into userData on
 * assignment so deleting the original on disk does not break the pet.
 *
 * Owns:
 * - manifest CRUD
 * - per-asset file copy / unlink under userData/customAssets/
 *
 * Does NOT own:
 * - file picker dialog (caller IPC concern)
 * - file size / extension policy gates (caller validates before assignAsset)
 * - customAppearances:updated IPC broadcast (caller wires after mutation)
 */
export class CustomAppearanceStore {
  private readonly store: ElectronStoreLike;
  private readonly userDataDir: string;
  private readonly assetsDir: string;

  constructor(opts?: { store?: ElectronStoreLike; userDataDir?: string }) {
    this.store =
      opts?.store ??
      (new Store<CustomAppearanceStoreSchema>({
        name: "pawpal"
      }) as unknown as ElectronStoreLike);
    this.userDataDir = opts?.userDataDir ?? "";
    this.assetsDir = path.join(this.userDataDir, ASSETS_DIR_NAME);
  }

  list(): CustomAppearanceManifest[] {
    return Object.values(this.getRegistry());
  }

  getAllManifests(): Record<string, CustomAppearanceManifest> {
    return this.getRegistry();
  }

  create(name: string): CustomAppearanceManifest {
    const validation = validateCustomAppearanceName(name);
    if (!validation.ok) {
      throw new Error("Invalid custom appearance name: " + validation.reason);
    }
    const id = crypto.randomBytes(ID_BYTES).toString("hex");
    const now = Date.now();
    const manifest: CustomAppearanceManifest = {
      id,
      name: name.trim(),
      createdAt: now,
      updatedAt: now,
      assets: {},
      version: 1
    };
    this.persistRegistry({ ...this.getRegistry(), [id]: manifest });
    return manifest;
  }

  assignAsset(
    bareId: string,
    state: PetState,
    srcPath: string
  ): CustomAppearanceManifest {
    const reg = this.getRegistry();
    const manifest = reg[bareId];
    if (!manifest) {
      throw new Error("Custom appearance not found: " + bareId);
    }
    const ext = path.extname(srcPath).toLowerCase();
    if (!ext) {
      throw new Error("Source file has no extension: " + srcPath);
    }

    const dir = path.join(this.assetsDir, bareId);
    fs.mkdirSync(dir, { recursive: true });

    const oldRel = manifest.assets[state];
    if (oldRel) {
      const oldAbs = path.join(this.assetsDir, oldRel);
      if (fs.existsSync(oldAbs)) fs.unlinkSync(oldAbs);
    }

    const filename = state + ext;
    fs.copyFileSync(srcPath, path.join(dir, filename));

    const next: CustomAppearanceManifest = {
      ...manifest,
      assets: { ...manifest.assets, [state]: path.posix.join(bareId, filename) },
      updatedAt: Date.now()
    };
    this.persistRegistry({ ...reg, [bareId]: next });
    return next;
  }

  clearAsset(bareId: string, state: PetState): CustomAppearanceManifest {
    const reg = this.getRegistry();
    const manifest = reg[bareId];
    if (!manifest) {
      throw new Error("Custom appearance not found: " + bareId);
    }
    const oldRel = manifest.assets[state];
    if (oldRel) {
      const oldAbs = path.join(this.assetsDir, oldRel);
      if (fs.existsSync(oldAbs)) fs.unlinkSync(oldAbs);
    }
    const nextAssets = { ...manifest.assets };
    delete nextAssets[state];
    const next: CustomAppearanceManifest = {
      ...manifest,
      assets: nextAssets,
      updatedAt: Date.now()
    };
    this.persistRegistry({ ...reg, [bareId]: next });
    return next;
  }

  rename(bareId: string, newName: string): CustomAppearanceManifest {
    const validation = validateCustomAppearanceName(newName);
    if (!validation.ok) {
      throw new Error("Invalid custom appearance name: " + validation.reason);
    }
    const reg = this.getRegistry();
    const manifest = reg[bareId];
    if (!manifest) {
      throw new Error("Custom appearance not found: " + bareId);
    }
    const next: CustomAppearanceManifest = {
      ...manifest,
      name: newName.trim(),
      updatedAt: Date.now()
    };
    this.persistRegistry({ ...reg, [bareId]: next });
    return next;
  }

  remove(bareId: string): void {
    const reg = this.getRegistry();
    if (!reg[bareId]) return;
    const dir = path.join(this.assetsDir, bareId);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    const nextReg = { ...reg };
    delete nextReg[bareId];
    this.persistRegistry(nextReg);
  }

  private getRegistry(): Record<string, CustomAppearanceManifest> {
    const stored = this.store.get(KEY) as
      | Record<string, unknown>
      | undefined;
    if (!stored) return {};
    const result: Record<string, CustomAppearanceManifest> = {};
    for (const [id, value] of Object.entries(stored)) {
      if (isValidCustomAppearanceManifest(value)) {
        result[id] = value;
      }
    }
    return result;
  }

  private persistRegistry(
    next: Record<string, CustomAppearanceManifest>
  ): void {
    this.store.set(KEY, next);
  }
}
