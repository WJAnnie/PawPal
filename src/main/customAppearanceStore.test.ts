import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { CustomAppearanceStore } from "./customAppearanceStore";

interface FakeStore {
  get: (key: string, defaultValue?: unknown) => unknown;
  set: (key: string, value: unknown) => void;
  delete: (key: string) => void;
  has: (key: string) => boolean;
}

function makeFakeStore(): FakeStore {
  const map = new Map<string, unknown>();
  return {
    get: (key, defaultValue) => (map.has(key) ? map.get(key) : defaultValue),
    set: (key, value) => {
      map.set(key, value);
    },
    delete: (key) => {
      map.delete(key);
    },
    has: (key) => map.has(key)
  };
}

describe("CustomAppearanceStore", () => {
  let tmpDir: string;
  let fakeStore: FakeStore;
  let store: CustomAppearanceStore;
  let srcGif: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pawpal-cas-"));
    fakeStore = makeFakeStore();
    store = new CustomAppearanceStore({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      store: fakeStore as any,
      userDataDir: tmpDir
    });
    srcGif = path.join(tmpDir, "source.gif");
    fs.writeFileSync(
      srcGif,
      Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("list / getAllManifests", () => {
    it("returns empty when nothing stored", () => {
      expect(store.list()).toEqual([]);
      expect(store.getAllManifests()).toEqual({});
    });

    it("returns previously stored manifests on construction", () => {
      const manifest = {
        id: "abc123",
        name: "Test",
        createdAt: 1000,
        updatedAt: 1000,
        assets: {},
        version: 1 as const
      };
      fakeStore.set("customAppearances", { abc123: manifest });
      const fresh = new CustomAppearanceStore({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        store: fakeStore as any,
        userDataDir: tmpDir
      });
      expect(fresh.list()).toEqual([manifest]);
    });

    it("filters out invalid manifests so corrupted store does not crash app", () => {
      fakeStore.set("customAppearances", {
        good: {
          id: "good",
          name: "Valid",
          createdAt: 1,
          updatedAt: 1,
          assets: {},
          version: 1
        },
        bad: { foo: "bar" }
      });
      const fresh = new CustomAppearanceStore({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        store: fakeStore as any,
        userDataDir: tmpDir
      });
      expect(fresh.list()).toHaveLength(1);
      expect(fresh.list()[0].id).toBe("good");
    });
  });

  describe("create", () => {
    it("creates a manifest with non-empty id, given name, empty assets, version 1", () => {
      const m = store.create("My Pet");
      expect(m.name).toBe("My Pet");
      expect(typeof m.id).toBe("string");
      expect(m.id.length).toBeGreaterThan(0);
      expect(m.assets).toEqual({});
      expect(m.version).toBe(1);
      expect(m.createdAt).toBeGreaterThan(0);
      expect(m.updatedAt).toBe(m.createdAt);
    });

    it("trims whitespace from name", () => {
      const m = store.create("  Padded  ");
      expect(m.name).toBe("Padded");
    });

    it("persists to store so list() sees it", () => {
      const m = store.create("Persisted");
      expect(store.list()).toContainEqual(m);
    });

    it("rejects empty / whitespace-only name", () => {
      expect(() => store.create("")).toThrow();
      expect(() => store.create("   ")).toThrow();
    });

    it("rejects name longer than 30 chars", () => {
      expect(() => store.create("x".repeat(31))).toThrow();
    });

    it("generates unique ids across calls", () => {
      const ids = new Set<string>();
      for (let i = 0; i < 20; i++) {
        ids.add(store.create("N" + i).id);
      }
      expect(ids.size).toBe(20);
    });
  });

  describe("assignAsset", () => {
    it("copies source to userData/customAssets/<id>/<state>.<ext>", () => {
      const m = store.create("Test");
      const next = store.assignAsset(m.id, "happy", srcGif);
      expect(next.assets.happy).toBe(m.id + "/happy.gif");
      const dst = path.join(tmpDir, "customAssets", m.id, "happy.gif");
      expect(fs.existsSync(dst)).toBe(true);
      expect(fs.readFileSync(dst)).toEqual(fs.readFileSync(srcGif));
    });

    it("preserves source file extension", () => {
      const srcPng = path.join(tmpDir, "source.png");
      fs.writeFileSync(srcPng, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      const m = store.create("Test");
      const next = store.assignAsset(m.id, "idle", srcPng);
      expect(next.assets.idle).toBe(m.id + "/idle.png");
    });

    it("removes old file when reassigning same state with different ext", () => {
      const m = store.create("Test");
      store.assignAsset(m.id, "happy", srcGif);
      const srcPng = path.join(tmpDir, "src2.png");
      fs.writeFileSync(srcPng, Buffer.from([0x89]));
      store.assignAsset(m.id, "happy", srcPng);

      const oldFile = path.join(tmpDir, "customAssets", m.id, "happy.gif");
      const newFile = path.join(tmpDir, "customAssets", m.id, "happy.png");
      expect(fs.existsSync(oldFile)).toBe(false);
      expect(fs.existsSync(newFile)).toBe(true);
    });

    it("bumps updatedAt", async () => {
      const m = store.create("Test");
      await new Promise((r) => setTimeout(r, 5));
      const next = store.assignAsset(m.id, "idle", srcGif);
      expect(next.updatedAt).toBeGreaterThan(m.updatedAt);
    });

    it("throws when bareId not found", () => {
      expect(() => store.assignAsset("nonexistent", "idle", srcGif)).toThrow();
    });

    it("throws when source has no extension", () => {
      const noExt = path.join(tmpDir, "noext");
      fs.writeFileSync(noExt, Buffer.from([0x00]));
      const m = store.create("Test");
      expect(() => store.assignAsset(m.id, "idle", noExt)).toThrow();
    });

    it("creates customAssets directory tree if it does not exist", () => {
      const m = store.create("Test");
      const dir = path.join(tmpDir, "customAssets");
      expect(fs.existsSync(dir)).toBe(false);
      store.assignAsset(m.id, "idle", srcGif);
      expect(fs.existsSync(dir)).toBe(true);
    });
  });

  describe("clearAsset", () => {
    it("deletes file and removes assets[state]", () => {
      const m = store.create("Test");
      store.assignAsset(m.id, "happy", srcGif);
      const dst = path.join(tmpDir, "customAssets", m.id, "happy.gif");
      expect(fs.existsSync(dst)).toBe(true);

      const next = store.clearAsset(m.id, "happy");
      expect(next.assets.happy).toBeUndefined();
      expect(fs.existsSync(dst)).toBe(false);
    });

    it("is idempotent when state has no asset", () => {
      const m = store.create("Test");
      expect(() => store.clearAsset(m.id, "happy")).not.toThrow();
      expect(store.list()[0].assets.happy).toBeUndefined();
    });

    it("throws when bareId not found", () => {
      expect(() => store.clearAsset("nonexistent", "idle")).toThrow();
    });

    it("does not affect other states", () => {
      const m = store.create("Test");
      store.assignAsset(m.id, "idle", srcGif);
      store.assignAsset(m.id, "happy", srcGif);
      store.clearAsset(m.id, "idle");
      const after = store.list()[0];
      expect(after.assets.idle).toBeUndefined();
      expect(after.assets.happy).toBe(m.id + "/happy.gif");
    });
  });

  describe("rename", () => {
    it("updates name and bumps updatedAt", async () => {
      const m = store.create("Old");
      await new Promise((r) => setTimeout(r, 5));
      const next = store.rename(m.id, "New");
      expect(next.name).toBe("New");
      expect(next.updatedAt).toBeGreaterThan(m.updatedAt);
    });

    it("trims new name", () => {
      const m = store.create("Old");
      const next = store.rename(m.id, "  Trimmed  ");
      expect(next.name).toBe("Trimmed");
    });

    it("rejects empty / too-long names", () => {
      const m = store.create("Original");
      expect(() => store.rename(m.id, "")).toThrow();
      expect(() => store.rename(m.id, "x".repeat(31))).toThrow();
    });

    it("throws when bareId not found", () => {
      expect(() => store.rename("nonexistent", "X")).toThrow();
    });
  });

  describe("remove", () => {
    it("deletes manifest from store", () => {
      const m = store.create("Test");
      store.remove(m.id);
      expect(store.list()).toEqual([]);
    });

    it("deletes asset folder recursively", () => {
      const m = store.create("Test");
      store.assignAsset(m.id, "idle", srcGif);
      store.assignAsset(m.id, "happy", srcGif);
      const dir = path.join(tmpDir, "customAssets", m.id);
      expect(fs.existsSync(dir)).toBe(true);

      store.remove(m.id);
      expect(fs.existsSync(dir)).toBe(false);
    });

    it("is no-op when bareId not found", () => {
      expect(() => store.remove("nonexistent")).not.toThrow();
    });

    it("does not affect other manifests", () => {
      const a = store.create("A");
      const b = store.create("B");
      store.remove(a.id);
      const remaining = store.list();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].id).toBe(b.id);
    });
  });
});