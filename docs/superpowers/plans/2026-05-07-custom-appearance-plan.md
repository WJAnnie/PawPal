# 自定义形象系统 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户在桌面宠物应用里通过 UI 逐状态选本地 GIF/PNG/WEBP 文件,组成多套自定义形象并切换使用。

**Architecture:** 三层结构(shared 纯函数 / main 端 store + IPC / renderer UI),通过新增的 `appearanceRegistry.ts` 适配层统一解析内置与自定义形象。错峰并行:阶段 A(纯前端 + 纯函数 + 单测)立即可启动,阶段 B(main 端 store)等 bug 修复分支 Phase 2 落地后再做,阶段 C(PetView + protocol 扩展)最后接通。

**Tech Stack:** TypeScript, Electron, React 19, vitest 4.1.5, electron-store, pnpm 9.15.9

**Spec:** `docs/superpowers/specs/2026-05-07-custom-appearance-design.md`

**重要原则:**
- 阶段 A 严守"不动 `main.ts` / `config.ts` / `preload/index.ts`",降低与 bug 修复分支冲突。
- TDD:每个纯函数/适配层任务先写测试再实现。UI 组件骨架不强求测试(v1 用手测)。
- 频繁 commit:每个 Task 完成后立即 commit,粒度小、回滚容易。

**Spec 与代码现状的修正:**
- spec §4 写"挂在 `AiSettingsSection`",代码探测显示宠物形象选择实际在 `src/renderer/src/components/SettingsView.tsx`,plan 跟随代码现状,把 AppearanceManager 挂在 SettingsView 内现有"宠物形象" pref-block 下方。

---

## 阶段 A:纯前端 + 纯函数(立即可启动)

### Task A1:锁定 vitest 到 devDependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 检查现状**

```bash
grep -E "\"vitest\":|\"@vitest" package.json
```

Expected: 没有任何输出(空) — 确认 vitest 当前未在 devDependencies 中显式声明。

- [ ] **Step 2: 锁定版本**

```bash
pnpm add -D vitest@4.1.5 @vitest/coverage-v8@4.1.5
```

Expected:`package.json` 的 `devDependencies` 里多出两行 `"vitest": "^4.1.5"` 和 `"@vitest/coverage-v8": "^4.1.5"`,`pnpm-lock.yaml` 更新。

- [ ] **Step 3: 验证 test 命令可跑**

```bash
pnpm test
```

Expected: vitest 启动,因为还没有 `*.test.ts` 文件,会输出 "No test files found" 但**不会因依赖缺失报错**。

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore(deps): pin vitest and @vitest/coverage-v8 to devDependencies

vitest was used (config + scripts) but never declared, making the test
toolchain fragile against pnpm install --frozen-lockfile. Pin both at 4.1.5."
```

---

### Task A2:创建 feature 分支

**Files:** 无文件改动,仅 git 操作。

- [ ] **Step 1: 确认基线**

```bash
git status
git log --oneline -3
```

Expected: HEAD 在最新的 main 分支(包含 Task A1 的 commit),工作树有"其他半成品改动"是正常的(我们不动它们)。

- [ ] **Step 2: 创建并切换分支**

```bash
git checkout -b feat/custom-appearance
git status
```

Expected:输出 `On branch feat/custom-appearance`,工作树状态保持不变。

- [ ] **Step 3: (可选) push 分支建立 upstream**

跳过此步骤,等 Task A11 收尾再 push。

---

### Task A3:扩展 PetAppearanceId 类型

**Files:**
- Modify: `src/shared/types.ts:3`

- [ ] **Step 1: 写期望的类型测试(用 ts-expect-error 风格)**

Create: `src/shared/__tests__/types.test.ts`

```ts
import { describe, it, expectTypeOf } from "vitest";
import type { BuiltinAppearanceId, CustomAppearanceId, PetAppearanceId } from "../types";

describe("PetAppearanceId types", () => {
  it("BuiltinAppearanceId is a literal union of two ids", () => {
    expectTypeOf<BuiltinAppearanceId>().toEqualTypeOf<"lovartPuppy" | "lineDog">();
  });

  it("CustomAppearanceId is a template literal type with custom: prefix", () => {
    const a: CustomAppearanceId = "custom:abc";
    const b: CustomAppearanceId = "custom:";
    expectTypeOf(a).toEqualTypeOf<CustomAppearanceId>();
    expectTypeOf(b).toEqualTypeOf<CustomAppearanceId>();
  });

  it("PetAppearanceId accepts both builtin and custom forms", () => {
    const x: PetAppearanceId = "lovartPuppy";
    const y: PetAppearanceId = "lineDog";
    const z: PetAppearanceId = "custom:my-cat";
    expectTypeOf(x).toEqualTypeOf<PetAppearanceId>();
    expectTypeOf(y).toEqualTypeOf<PetAppearanceId>();
    expectTypeOf(z).toEqualTypeOf<PetAppearanceId>();
  });
});
```

- [ ] **Step 2: 运行测试确认失败(类型还没扩展)**

```bash
pnpm test -- src/shared/__tests__/types.test.ts
```

Expected: 类型错误(`Type '"custom:abc"' is not assignable to type 'PetAppearanceId'`)。

- [ ] **Step 3: 修改 `src/shared/types.ts:3`**

替换原来的:

```ts
export type PetAppearanceId = "lovartPuppy" | "lineDog";
```

为:

```ts
export type BuiltinAppearanceId = "lovartPuppy" | "lineDog";
export type CustomAppearanceId = `custom:${string}`;
export type PetAppearanceId = BuiltinAppearanceId | CustomAppearanceId;
```

- [ ] **Step 4: 运行测试确认通过**

```bash
pnpm test -- src/shared/__tests__/types.test.ts
pnpm typecheck
```

Expected: 测试 PASS;`pnpm typecheck` 全绿。

- [ ] **Step 5: Commit**

```bash
git add src/shared/types.ts src/shared/__tests__/types.test.ts
git commit -m "feat(types): extend PetAppearanceId to support custom: prefix

Introduce BuiltinAppearanceId (literal union) and CustomAppearanceId
(template literal). PetAppearanceId is now their union, preserving
literal-type checking for builtin ids while allowing dynamic custom ids."
```

---

### Task A4:创建 customAppearance.ts(类型 + 守卫 + 校验)

**Files:**
- Create: `src/shared/customAppearance.ts`
- Create: `src/shared/__tests__/customAppearance.test.ts`

- [ ] **Step 1: 写测试(全部场景)**

Create: `src/shared/__tests__/customAppearance.test.ts`

```ts
import { describe, it, expect } from "vitest";
import {
  isCustomAppearanceId,
  isBuiltinAppearanceId,
  customIdToBareId,
  bareIdToCustomId,
  validateCustomAppearanceName,
  isValidCustomAppearanceManifest,
  type CustomAppearanceManifest
} from "../customAppearance";

describe("isCustomAppearanceId", () => {
  it("returns true for ids with custom: prefix", () => {
    expect(isCustomAppearanceId("custom:abc")).toBe(true);
    expect(isCustomAppearanceId("custom:")).toBe(true);
  });

  it("returns false for builtin ids", () => {
    expect(isCustomAppearanceId("lovartPuppy")).toBe(false);
    expect(isCustomAppearanceId("lineDog")).toBe(false);
  });
});

describe("isBuiltinAppearanceId", () => {
  it("returns true for the two builtin ids", () => {
    expect(isBuiltinAppearanceId("lovartPuppy")).toBe(true);
    expect(isBuiltinAppearanceId("lineDog")).toBe(true);
  });

  it("returns false for custom ids", () => {
    expect(isBuiltinAppearanceId("custom:abc")).toBe(false);
  });
});

describe("customIdToBareId / bareIdToCustomId", () => {
  it("strips and re-adds the custom: prefix", () => {
    expect(customIdToBareId("custom:abc")).toBe("abc");
    expect(bareIdToCustomId("abc")).toBe("custom:abc");
  });

  it("round-trips correctly", () => {
    const id = "custom:my-cat-2026" as const;
    expect(bareIdToCustomId(customIdToBareId(id))).toBe(id);
  });
});

describe("validateCustomAppearanceName", () => {
  it("rejects empty / whitespace-only names", () => {
    expect(validateCustomAppearanceName("")).toEqual({ ok: false, reason: "empty" });
    expect(validateCustomAppearanceName("   ")).toEqual({ ok: false, reason: "empty" });
  });

  it("rejects names longer than 30 characters", () => {
    const long = "a".repeat(31);
    expect(validateCustomAppearanceName(long)).toEqual({ ok: false, reason: "too-long" });
  });

  it("accepts normal names", () => {
    expect(validateCustomAppearanceName("My Cat")).toEqual({ ok: true });
    expect(validateCustomAppearanceName("a")).toEqual({ ok: true });
    expect(validateCustomAppearanceName("a".repeat(30))).toEqual({ ok: true });
  });
});

describe("isValidCustomAppearanceManifest", () => {
  const valid: CustomAppearanceManifest = {
    id: "abc",
    name: "Test",
    createdAt: 1,
    updatedAt: 1,
    assets: { idle: "idle.gif" },
    version: 1
  };

  it("accepts a valid manifest", () => {
    expect(isValidCustomAppearanceManifest(valid)).toBe(true);
  });

  it("rejects null / non-object", () => {
    expect(isValidCustomAppearanceManifest(null)).toBe(false);
    expect(isValidCustomAppearanceManifest("string")).toBe(false);
    expect(isValidCustomAppearanceManifest(42)).toBe(false);
  });

  it("rejects manifests missing required fields", () => {
    expect(isValidCustomAppearanceManifest({ ...valid, id: "" })).toBe(false);
    expect(isValidCustomAppearanceManifest({ ...valid, name: "" })).toBe(false);
    expect(isValidCustomAppearanceManifest({ ...valid, version: 2 })).toBe(false);
    const noAssets = { ...valid } as Record<string, unknown>;
    delete noAssets.assets;
    expect(isValidCustomAppearanceManifest(noAssets)).toBe(false);
  });
});
```

- [ ] **Step 2: 运行测试确认失败(模块不存在)**

```bash
pnpm test -- src/shared/__tests__/customAppearance.test.ts
```

Expected: 失败,提示 `Cannot find module "../customAppearance"`。

- [ ] **Step 3: 实现 customAppearance.ts**

Create: `src/shared/customAppearance.ts`

```ts
import type {
  BuiltinAppearanceId,
  CustomAppearanceId,
  PetAppearanceId,
  PetState
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
```

- [ ] **Step 4: 运行测试确认通过**

```bash
pnpm test -- src/shared/__tests__/customAppearance.test.ts
pnpm typecheck
```

Expected: 全部测试 PASS,`pnpm typecheck` 全绿。

- [ ] **Step 5: Commit**

```bash
git add src/shared/customAppearance.ts src/shared/__tests__/customAppearance.test.ts
git commit -m "feat(shared): add CustomAppearanceManifest type, guards, and validators

Introduces CustomAppearanceManifest schema (with version: 1),
type-narrowing guards (isCustom/isBuiltin), bare-id <-> custom-id
converters, name validation (1-30 chars), and a runtime manifest
validator for use in IPC and config-load paths."
```

---

### Task A5:重命名 PET_APPEARANCES → BUILTIN_APPEARANCES,导出 STATE_FALLBACKS 与 getBuiltinAsset

**Files:**
- Modify: `src/shared/petAppearances.ts`

- [ ] **Step 1: 阅读现有文件**

```bash
cat src/shared/petAppearances.ts
```

记下:`PET_APPEARANCES` 在 line 28、171、181、191 出现;`STATE_FALLBACKS` 是 module-private(line 22),需要 export 给 registry 复用;`getPetAssetDefinition` 重命名为 `getBuiltinAsset`(语义更清晰);其他函数(`resolvePetAppearanceId`、`petAppearanceOptions`、`getPetSpecies`)签名要扩展为 `BuiltinAppearanceId`,因为它们仅处理内置。

- [ ] **Step 2: 修改 petAppearances.ts**

Modify: `src/shared/petAppearances.ts`

第 1-3 行(import 块)替换为:

```ts
import type { BuiltinAppearanceId, Language, PetAppearanceId, PetState } from "./types";
import type { PetSpecies } from "./petSpecies";
```

注意 `PetAppearanceId` 仍然 import,因为 manifest 类型需要;但 `BUILTIN_APPEARANCES` 会用 `BuiltinAppearanceId` 作 key。

第 10-16 行(`PetAppearanceManifest` 类型)的 `id` 字段改为 `BuiltinAppearanceId`:

```ts
export type PetAppearanceManifest = {
  id: BuiltinAppearanceId;
  species: PetSpecies;
  label: Record<Language, string>;
  fallback: PetAssetDefinition;
  states: Partial<Record<PetState, PetAssetDefinition>>;
};
```

第 22-26 行(`STATE_FALLBACKS`)加 `export`:

```ts
export const STATE_FALLBACKS: Partial<Record<PetState, PetState>> = {
  breakDone: "happy",
  hydrationDone: "happy",
  focusDone: "happy"
};
```

第 28 行整体重命名,把 `PET_APPEARANCES` 改成 `BUILTIN_APPEARANCES`,key 类型改成 `BuiltinAppearanceId`:

```ts
export const BUILTIN_APPEARANCES: Record<BuiltinAppearanceId, PetAppearanceManifest> = {
```

第 166-168 行(`resolvePetAppearanceId`)签名改为返回 `BuiltinAppearanceId`(只解析内置):

```ts
export function resolvePetAppearanceId(value: unknown): BuiltinAppearanceId {
  return value === "lineDog" ? "lineDog" : "lovartPuppy";
}
```

第 170-175 行(`petAppearanceOptions`)签名也改为 builtin-only:

```ts
export function petAppearanceOptions(
  language: Language
): Array<{ value: BuiltinAppearanceId; label: string }> {
  return Object.values(BUILTIN_APPEARANCES).map((appearance) => ({
    value: appearance.id,
    label: appearance.label[language]
  }));
}
```

第 177-188 行(`getPetAssetDefinition`)重命名为 `getBuiltinAsset`,签名改为接受 `BuiltinAppearanceId`:

```ts
export function getBuiltinAsset(
  appearanceId: BuiltinAppearanceId,
  state: PetState
): PetAssetDefinition {
  const appearance = BUILTIN_APPEARANCES[appearanceId];
  const fallbackState = STATE_FALLBACKS[state];
  return (
    appearance.states[state] ??
    (fallbackState ? appearance.states[fallbackState] : undefined) ??
    appearance.fallback
  );
}

// 兼容别名:让阶段 A 期间未迁移的调用点继续工作。
// 阶段 C(PetView 接 registry 时)会移除这个别名。
export const getPetAssetDefinition = getBuiltinAsset;
```

第 190-192 行(`getPetSpecies`)签名改为 `BuiltinAppearanceId`:

```ts
export function getPetSpecies(appearanceId: BuiltinAppearanceId): PetSpecies {
  return BUILTIN_APPEARANCES[appearanceId].species;
}
```

- [ ] **Step 3: 运行 typecheck 找出所有断裂调用点**

```bash
pnpm typecheck 2>&1 | grep -E "petAppearances|PET_APPEARANCES|getPetAssetDefinition" | head -20
```

Expected: 部分调用点(`main.ts`、`assets.ts`、`SettingsView.tsx`、`HoverPanel.tsx`)可能 squawks,因为它们传 `PetAppearanceId` 给现在只接受 `BuiltinAppearanceId` 的函数。

- [ ] **Step 4: 修复 src/renderer/src/assets.ts 的调用点**

Modify: `src/renderer/src/assets.ts`

把第 21、32 行附近(调用 `getPetAssetDefinition` 的地方)的参数类型从 `PetAppearanceId` 改为接受 `BuiltinAppearanceId`(由调用方先 resolve)。打开文件,找到:

```ts
const asset = getPetAssetDefinition(resolvedAppearanceId, state);
```

确认 `resolvedAppearanceId` 是 `resolvePetAppearanceId()` 的返回值(已经是 `BuiltinAppearanceId`),所以不需要改。

- [ ] **Step 5: 验证全部 typecheck 通过**

```bash
pnpm typecheck
```

Expected: 全绿。如果仍有错误,逐一查看错误位置并按照"传 PetAppearanceId 的地方,先 resolvePetAppearanceId() 收敛到 builtin"的原则修复。

- [ ] **Step 6: 单元测试 / 现有测试不能掉**

```bash
pnpm test
```

Expected: PASS(包括新加的 customAppearance 测试和 types 测试)。

- [ ] **Step 7: Commit**

```bash
git add src/shared/petAppearances.ts src/renderer/src/assets.ts
git commit -m "refactor(shared): rename PET_APPEARANCES to BUILTIN_APPEARANCES

Renames the registry constant and getPetAssetDefinition to clarify it only
holds builtin appearances. Tightens function signatures so they accept
BuiltinAppearanceId only — callers must resolvePetAppearanceId() first.
Exports STATE_FALLBACKS for reuse by the new appearanceRegistry adapter.

Adds getPetAssetDefinition as a temporary alias for getBuiltinAsset so
unmigrated callsites continue to compile during stage A. The alias will
be removed when PetView switches to registry.resolve() in stage C."
```

---

### Task A6:创建 appearanceRegistry.ts 适配层

**Files:**
- Create: `src/shared/appearanceRegistry.ts`
- Create: `src/shared/__tests__/appearanceRegistry.test.ts`

- [ ] **Step 1: 写测试(覆盖 spec §8.1 全部场景)**

Create: `src/shared/__tests__/appearanceRegistry.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { createAppearanceRegistry } from "../appearanceRegistry";
import { BUILTIN_APPEARANCES } from "../petAppearances";
import type { CustomAppearanceManifest } from "../customAppearance";

const customs: Record<string, CustomAppearanceManifest> = {
  "my-cat": {
    id: "my-cat",
    name: "My Cat",
    createdAt: 1,
    updatedAt: 1,
    assets: {
      idle: "idle.gif",
      happy: "happy.gif",
      sad: "sad.gif"
    },
    version: 1
  },
  "empty-pet": {
    id: "empty-pet",
    name: "Empty",
    createdAt: 2,
    updatedAt: 2,
    assets: {},
    version: 1
  }
};

describe("AppearanceRegistry.resolve", () => {
  it("routes builtin id to BUILTIN_APPEARANCES", () => {
    const registry = createAppearanceRegistry(customs);
    const def = registry.resolve("lineDog", "idle");
    const expected = BUILTIN_APPEARANCES.lineDog.states.idle;
    expect(def).toEqual(expected);
  });

  it("returns custom asset when state is set", () => {
    const registry = createAppearanceRegistry(customs);
    expect(registry.resolve("custom:my-cat", "happy")).toEqual({
      path: "pet-assets://custom/my-cat/happy.gif"
    });
  });

  it("falls back via STATE_FALLBACKS when state missing", () => {
    const registry = createAppearanceRegistry(customs);
    // breakDone -> happy via STATE_FALLBACKS
    expect(registry.resolve("custom:my-cat", "breakDone")).toEqual({
      path: "pet-assets://custom/my-cat/happy.gif"
    });
  });

  it("falls back to idle when no STATE_FALLBACKS hit", () => {
    const registry = createAppearanceRegistry(customs);
    // sitting has no fallback in STATE_FALLBACKS, falls back to idle
    expect(registry.resolve("custom:my-cat", "sitting")).toEqual({
      path: "pet-assets://custom/my-cat/idle.gif"
    });
  });

  it("falls back to lineDog idle when custom manifest is empty", () => {
    const registry = createAppearanceRegistry(customs);
    expect(registry.resolve("custom:empty-pet", "happy")).toEqual(
      BUILTIN_APPEARANCES.lineDog.states.idle
    );
  });

  it("falls back to lineDog idle when custom id does not exist", () => {
    const registry = createAppearanceRegistry(customs);
    expect(registry.resolve("custom:does-not-exist", "happy")).toEqual(
      BUILTIN_APPEARANCES.lineDog.states.idle
    );
  });

  it("falls back to lineDog idle when registry has no customs at all", () => {
    const registry = createAppearanceRegistry({});
    expect(registry.resolve("custom:any", "idle")).toEqual(
      BUILTIN_APPEARANCES.lineDog.states.idle
    );
  });
});

describe("AppearanceRegistry.listAll", () => {
  it("returns builtin + custom ids in zh-CN", () => {
    const registry = createAppearanceRegistry(customs);
    const list = registry.listAll("zh-CN");
    expect(list).toContainEqual({ value: "lovartPuppy", label: "金毛 puppy (beta)" });
    expect(list).toContainEqual({ value: "lineDog", label: "线条小狗" });
    expect(list).toContainEqual({ value: "custom:my-cat", label: "My Cat" });
    expect(list).toContainEqual({ value: "custom:empty-pet", label: "Empty" });
  });

  it("uses English labels in en", () => {
    const registry = createAppearanceRegistry(customs);
    const list = registry.listAll("en");
    expect(list).toContainEqual({ value: "lineDog", label: "Line Dog" });
  });
});

describe("AppearanceRegistry.getSpecies", () => {
  it("returns species from BUILTIN_APPEARANCES for builtin ids", () => {
    const registry = createAppearanceRegistry(customs);
    expect(registry.getSpecies("lineDog")).toBe("dog");
    expect(registry.getSpecies("lovartPuppy")).toBe("dog");
  });

  it("returns dog for custom ids in v1", () => {
    const registry = createAppearanceRegistry(customs);
    expect(registry.getSpecies("custom:my-cat")).toBe("dog");
  });
});

describe("AppearanceRegistry.hasAppearance", () => {
  it("returns true for known builtin and known custom", () => {
    const registry = createAppearanceRegistry(customs);
    expect(registry.hasAppearance("lineDog")).toBe(true);
    expect(registry.hasAppearance("custom:my-cat")).toBe(true);
  });

  it("returns false for unknown custom", () => {
    const registry = createAppearanceRegistry(customs);
    expect(registry.hasAppearance("custom:nope")).toBe(false);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
pnpm test -- src/shared/__tests__/appearanceRegistry.test.ts
```

Expected: 失败,提示 `Cannot find module "../appearanceRegistry"`。

- [ ] **Step 3: 实现 appearanceRegistry.ts**

Create: `src/shared/appearanceRegistry.ts`

```ts
import {
  BUILTIN_APPEARANCES,
  STATE_FALLBACKS,
  getBuiltinAsset,
  type PetAssetDefinition
} from "./petAppearances";
import {
  isCustomAppearanceId,
  customIdToBareId,
  type CustomAppearanceManifest
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
        label: a.label[language]
      }));
      const custom = Object.values(customs).map((m) => ({
        value: `custom:${m.id}` as PetAppearanceId,
        label: m.name
      }));
      return [...builtin, ...custom];
    },

    getSpecies(id) {
      if (isCustomAppearanceId(id)) {
        // v1: custom 形象统一视为 dog,v2 在 manifest 里加 species 字段后再扩展
        return "dog";
      }
      return BUILTIN_APPEARANCES[id].species;
    },

    hasAppearance(id) {
      if (isCustomAppearanceId(id)) {
        return customIdToBareId(id) in customs;
      }
      return id === "lovartPuppy" || id === "lineDog";
    }
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
```

- [ ] **Step 4: 运行测试确认全部通过**

```bash
pnpm test -- src/shared/__tests__/appearanceRegistry.test.ts
pnpm typecheck
```

Expected: 全绿。

- [ ] **Step 5: 跑全量测试,确认其他测试没被破坏**

```bash
pnpm test
```

Expected: 所有 *.test.ts 都 PASS。

- [ ] **Step 6: Commit**

```bash
git add src/shared/appearanceRegistry.ts src/shared/__tests__/appearanceRegistry.test.ts
git commit -m "feat(shared): add appearanceRegistry adapter for builtin + custom

Introduces createAppearanceRegistry(customs) returning a unified
resolve/listAll/getSpecies/hasAppearance interface. resolve() routes
builtin ids to getBuiltinAsset and custom ids through a fallback chain
(state -> STATE_FALLBACKS[state] -> idle -> lineDog idle).

Includes full coverage of spec §8.1 fallback scenarios."
```

---

### Task A7:AppearanceEditor 组件骨架

**Files:**
- Create: `src/renderer/src/components/AppearanceEditor.tsx`

- [ ] **Step 1: 创建组件文件**

Create: `src/renderer/src/components/AppearanceEditor.tsx`

```tsx
import { useState } from "react";
import type { PetState } from "../../../shared/types";
import type { CustomAppearanceManifest } from "../../../shared/customAppearance";
import { validateCustomAppearanceName } from "../../../shared/customAppearance";

const ALL_STATES: PetState[] = [
  "idle",
  "sitting",
  "happy",
  "breakPrompt",
  "breakRunning",
  "breakDone",
  "hydrationPrompt",
  "drinking",
  "hydrationDone",
  "focusGuard",
  "focusAlert",
  "focusDone",
  "sad",
  "sleeping"
];

interface AppearanceEditorProps {
  manifest: CustomAppearanceManifest;
  onSave: (next: CustomAppearanceManifest) => void;
  onCancel: () => void;
  // 阶段 A: stub。阶段 B 接通后改为 (state) => Promise<{ ok, fileName? }>
  onPickAsset?: (state: PetState) => void;
  onClearAsset?: (state: PetState) => void;
}

export function AppearanceEditor({
  manifest,
  onSave,
  onCancel,
  onPickAsset,
  onClearAsset
}: AppearanceEditorProps) {
  const [name, setName] = useState(manifest.name);
  const [assets, setAssets] = useState(manifest.assets);

  const nameValidation = validateCustomAppearanceName(name);

  const handleSave = () => {
    if (!nameValidation.ok) return;
    onSave({
      ...manifest,
      name: name.trim(),
      assets,
      updatedAt: Date.now()
    });
  };

  const handlePick = (state: PetState) => {
    if (onPickAsset) {
      onPickAsset(state);
    } else {
      // 阶段 A stub:占位提醒
      window.alert(`[stub] 选择 ${state} 状态的素材文件 — 等阶段 B 接通 IPC 后生效`);
    }
  };

  const handleClear = (state: PetState) => {
    if (onClearAsset) {
      onClearAsset(state);
    }
    setAssets((prev) => {
      const next = { ...prev };
      delete next[state];
      return next;
    });
  };

  return (
    <div className="appearance-editor">
      <div className="appearance-editor__header">
        <label className="appearance-editor__name-label">
          形象名称
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={30}
            className="appearance-editor__name-input"
          />
        </label>
        {!nameValidation.ok && (
          <span className="appearance-editor__name-error">
            {nameValidation.reason === "empty" ? "名称不能为空" : "名称最长 30 字"}
          </span>
        )}
      </div>

      <ul className="appearance-editor__states">
        {ALL_STATES.map((state) => {
          const fileName = assets[state];
          return (
            <li key={state} className="appearance-editor__state-row">
              <span className="appearance-editor__state-label">{state}</span>
              <span className="appearance-editor__file-name">
                {fileName ?? "(未设置)"}
              </span>
              <button
                type="button"
                className="appearance-editor__pick-btn"
                onClick={() => handlePick(state)}
              >
                选择文件
              </button>
              <button
                type="button"
                className="appearance-editor__clear-btn"
                onClick={() => handleClear(state)}
                disabled={!fileName}
              >
                清除
              </button>
            </li>
          );
        })}
      </ul>

      <div className="appearance-editor__actions">
        <button
          type="button"
          className="appearance-editor__save-btn"
          onClick={handleSave}
          disabled={!nameValidation.ok}
        >
          保存
        </button>
        <button
          type="button"
          className="appearance-editor__cancel-btn"
          onClick={onCancel}
        >
          取消
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 验证 typecheck 通过**

```bash
pnpm typecheck
```

Expected: 全绿。

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/AppearanceEditor.tsx
git commit -m "feat(renderer): add AppearanceEditor component skeleton

Renders the 14-state editor UI with name input, per-state pick/clear
buttons, and save/cancel actions. The pick/clear callbacks accept
optional handler props so stage A can run with stubs (window.alert)
and stage B can wire IPC handlers without component changes."
```

---

### Task A8:AppearanceManager 组件骨架(4 按钮 stub)

**Files:**
- Create: `src/renderer/src/components/AppearanceManager.tsx`

- [ ] **Step 1: 创建组件**

Create: `src/renderer/src/components/AppearanceManager.tsx`

```tsx
import { useMemo, useState } from "react";
import type { Language, PetAppearanceId } from "../../../shared/types";
import type { CustomAppearanceManifest } from "../../../shared/customAppearance";
import { bareIdToCustomId } from "../../../shared/customAppearance";
import { createAppearanceRegistry } from "../../../shared/appearanceRegistry";
import { AppearanceEditor } from "./AppearanceEditor";

interface AppearanceManagerProps {
  language: Language;
  selectedId: PetAppearanceId;
  // 阶段 A: undefined,Manager 用本地 state 模拟。阶段 B: 来自 IPC。
  customs?: Record<string, CustomAppearanceManifest>;
  onSelect: (id: PetAppearanceId) => void;
  onCreate?: (name: string) => Promise<CustomAppearanceManifest> | CustomAppearanceManifest;
  onRename?: (bareId: string, newName: string) => void;
  onDelete?: (bareId: string) => void;
  onUpdateManifest?: (manifest: CustomAppearanceManifest) => void;
}

export function AppearanceManager({
  language,
  selectedId,
  customs,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  onUpdateManifest
}: AppearanceManagerProps) {
  // 阶段 A: 如果 customs 没传(还没接 IPC),用本地 state 让 UI 走得通
  const [localCustoms, setLocalCustoms] = useState<Record<string, CustomAppearanceManifest>>({});
  const effectiveCustoms = customs ?? localCustoms;

  const [editingBareId, setEditingBareId] = useState<string | null>(null);

  const registry = useMemo(
    () => createAppearanceRegistry(effectiveCustoms),
    [effectiveCustoms]
  );
  const list = registry.listAll(language);

  const handleCreate = async () => {
    const name = window.prompt("形象名称(1-30 字)");
    if (!name || name.trim().length === 0) return;

    if (onCreate) {
      const created = await onCreate(name.trim());
      setEditingBareId(created.id);
    } else {
      // 阶段 A stub:本地生成
      const bareId = `local-${Date.now()}`;
      const manifest: CustomAppearanceManifest = {
        id: bareId,
        name: name.trim(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        assets: {},
        version: 1
      };
      setLocalCustoms((prev) => ({ ...prev, [bareId]: manifest }));
      setEditingBareId(bareId);
    }
  };

  const handleRename = (bareId: string) => {
    const current = effectiveCustoms[bareId];
    if (!current) return;
    const newName = window.prompt("新名称", current.name);
    if (!newName || newName.trim().length === 0) return;

    if (onRename) {
      onRename(bareId, newName.trim());
    } else {
      setLocalCustoms((prev) => ({
        ...prev,
        [bareId]: { ...prev[bareId], name: newName.trim(), updatedAt: Date.now() }
      }));
    }
  };

  const handleDelete = (bareId: string) => {
    if (!window.confirm("确定删除该自定义形象?")) return;

    if (onDelete) {
      onDelete(bareId);
    } else {
      setLocalCustoms((prev) => {
        const next = { ...prev };
        delete next[bareId];
        return next;
      });
    }
    if (editingBareId === bareId) setEditingBareId(null);
  };

  const handleEditorSave = (next: CustomAppearanceManifest) => {
    if (onUpdateManifest) {
      onUpdateManifest(next);
    } else {
      setLocalCustoms((prev) => ({ ...prev, [next.id]: next }));
    }
    setEditingBareId(null);
  };

  if (editingBareId) {
    const editing = effectiveCustoms[editingBareId];
    if (editing) {
      return (
        <AppearanceEditor
          manifest={editing}
          onSave={handleEditorSave}
          onCancel={() => setEditingBareId(null)}
        />
      );
    }
  }

  return (
    <div className="appearance-manager">
      <ul className="appearance-manager__list">
        {list.map((item) => {
          const isCustom = item.value.startsWith("custom:");
          const bareId = isCustom ? item.value.slice("custom:".length) : null;
          const isSelected = item.value === selectedId;
          return (
            <li
              key={item.value}
              className={`appearance-manager__item${isSelected ? " is-selected" : ""}`}
            >
              <button
                type="button"
                className="appearance-manager__select-btn"
                onClick={() => onSelect(item.value)}
              >
                {item.label}
                {isSelected && " ✓"}
              </button>
              {isCustom && bareId && (
                <>
                  <button
                    type="button"
                    className="appearance-manager__edit-btn"
                    onClick={() => setEditingBareId(bareId)}
                  >
                    编辑
                  </button>
                  <button
                    type="button"
                    className="appearance-manager__rename-btn"
                    onClick={() => handleRename(bareId)}
                  >
                    重命名
                  </button>
                  <button
                    type="button"
                    className="appearance-manager__delete-btn"
                    onClick={() => handleDelete(bareId)}
                  >
                    删除
                  </button>
                </>
              )}
            </li>
          );
        })}
      </ul>

      <button
        type="button"
        className="appearance-manager__create-btn"
        onClick={handleCreate}
      >
        + 创建新形象
      </button>
    </div>
  );
}

// 用于在阶段 A 测试时把 bareId 作为 PetAppearanceId 传递
export const _bareIdToCustomId = bareIdToCustomId;
```

- [ ] **Step 2: 验证 typecheck**

```bash
pnpm typecheck
```

Expected: 全绿。

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/AppearanceManager.tsx
git commit -m "feat(renderer): add AppearanceManager component skeleton

Renders the appearance list (builtin + custom) with select/edit/rename/
delete actions for custom items. All four mutation handlers accept
optional callback props (onCreate/onRename/onDelete/onUpdateManifest)
so stage A runs with local state stubs and stage B wires IPC without
component rewrites."
```

---

### Task A9:把 AppearanceManager 集成进 SettingsView

**Files:**
- Modify: `src/renderer/src/components/SettingsView.tsx`(line 286-297 附近)

- [ ] **Step 1: 阅读现状**

```bash
sed -n '280,300p' src/renderer/src/components/SettingsView.tsx
```

记下当前形象选择 pref-block 的结构(用 `petAppearanceOptions` + 自定义 select 控件)。

- [ ] **Step 2: 在文件顶部加 import**

Modify: `src/renderer/src/components/SettingsView.tsx`(line 1-10 附近 import 块)

加入:

```ts
import { AppearanceManager } from "./AppearanceManager";
```

- [ ] **Step 3: 在现有形象选择 pref-block 下方挂载 AppearanceManager**

找到 line 285-297 附近的 `<span className="pref-block__label">{labels.petAppearance}</span>` 块,在它结束的 `</label>` 后(或 pref-block 结束前的合适位置)加入:

```tsx
<div className="pref-block__advanced">
  <details>
    <summary>自定义形象 (实验)</summary>
    <AppearanceManager
      language={language}
      selectedId={draft.petAppearanceId}
      onSelect={(id) => updateDraft({ petAppearanceId: id })}
    />
  </details>
</div>
```

注意:**保留现有的形象 select**,不直接替换。Manager 作为 `<details>` 折叠在下方,默认折叠态。这样:
- v1 阶段 A 不破坏现有"切换内置形象"的体验
- 用户主动展开 `<details>` 才看到自定义形象功能
- 阶段 C 完工后再考虑是否合并/移除原 select

- [ ] **Step 4: 运行 typecheck**

```bash
pnpm typecheck
```

Expected: 全绿。注意 `updateDraft({ petAppearanceId: id })` — `id` 是 `PetAppearanceId`(可能是 custom:),`updateDraft` 接受的 `Settings.petAppearanceId` 也是 `PetAppearanceId`,类型一致。

- [ ] **Step 5: 启动 dev 验证 UI 走得通**

```bash
pnpm dev
```

打开应用,进入设置面板,看到:
1. 原"宠物形象"区域仍存在,可切换 lovartPuppy / lineDog
2. 下方有 `<details>自定义形象 (实验)</details>`,展开后看到 Manager
3. 点 [+ 创建新形象] → 弹 prompt → 填名字 → 进入 Editor → 看到 14 个 state 行,每行有"选择文件"(stub) / "清除" 按钮
4. 取消回到列表,看到刚创建的形象在列表里
5. 切换它(点击形象名),宠物 PetView 因为没素材 → fallback 到 lineDog idle(因为 registry.resolve 已实现这个保底)

注意阶段 A 的 Manager 用本地 state,**重启应用会丢**。这是预期的 — 持久化是阶段 B 的工作。

如果 PetView 因为收到 custom: 形象切换 invalid asset 而崩溃 / 报错,记录现象,但不在阶段 A 修(这是阶段 C 工作)。可以在 prompt 里直接选 builtin 形象规避。

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/SettingsView.tsx
git commit -m "feat(renderer): mount AppearanceManager under SettingsView

Adds an experimental \"自定义形象\" details section under the existing
appearance picker. Stage A uses local component state (resets on reload);
stage B will replace these with IPC-backed customs."
```

---

### Task A10:阶段 A 收尾 — typecheck 全绿、test 全绿、push 分支

**Files:** 无新文件改动。

- [ ] **Step 1: 跑全量校验**

```bash
pnpm typecheck && pnpm test && pnpm build
```

Expected: 三个命令都成功退出。`pnpm build` 是为了确保 electron-vite 也能正常打包(不只是 typecheck 过)。如果 build 失败,通常是 pet-assets:// 协议处理在 main.ts 没扩展导致的运行时问题(运行 PetView 用到 custom: 时才触发),不是 build 问题 — 仔细看错误确认。

- [ ] **Step 2: 看一眼分支差异**

```bash
git log --oneline main..HEAD
git diff --stat main..HEAD
```

Expected: 8-10 个 commit(每个 Task 至少一个),改动主要集中在 `src/shared/`、`src/renderer/src/components/AppearanceManager.tsx`、`AppearanceEditor.tsx`、`SettingsView.tsx`。**`main.ts` / `config.ts` / `preload/index.ts` 应该是 0 改动**(除了 Task A1 的 package.json)。

- [ ] **Step 3: Push 分支**

```bash
git push -u origin feat/custom-appearance
```

Expected: 分支推送成功。

- [ ] **Step 4: 阶段 A 完成,等待节点**

阶段 A 至此完成。等待 bug 修复分支的 Phase 2(抽 settingsStore + statsStore)落地到 main 后,再启动阶段 B。

可以在等待期做的事:
- 追加更多单元测试覆盖 registry 的边角场景
- 给 AppearanceManager / AppearanceEditor 加 CSS(在 styles.css 加新 class)
- 写阶段 B 的 IPC handler 接口的 mock 版本,让 UI 用 mock 走流程

---

## 阶段 B:main 端 store + IPC(等 bug 修复 Phase 2)

**启动条件:** bug 修复分支 Phase 2(`抽 settingsStore + statsStore`)合到 main,且 `feat/custom-appearance` 分支已经 rebase 到最新 main。

**预期工作:**

### Task B1:rebase 到最新 main 并解冲突

- [ ] `git fetch origin && git rebase origin/main`
- [ ] 解决 `package.json` 冲突(我们 Task A1 加的 vitest 与 bug 修复分支可能冲突 — 取并集)
- [ ] 解决其他冲突(预期较少,因为阶段 A 没动 main 端文件)
- [ ] `pnpm install && pnpm test && pnpm typecheck` 全绿
- [ ] `git push --force-with-lease`

### Task B2:`src/main/customAppearanceStore.ts` 实现

**Files:**
- Create: `src/main/customAppearanceStore.ts`
- Create: `src/main/__tests__/customAppearanceStore.test.ts`

参照 spec §6.1 数据流和 §8.2 测试场景实现:
- `list()` / `create(name)` / `assignAsset(bareId, state, srcPath)` / `clearAsset(bareId, state)` / `rename(bareId, newName)` / `remove(bareId)` / `getAllManifests()`
- `assignAsset` 内部:`fs.copyFile(srcPath, userData/customAssets/<bareId>/<state>.<ext>)`,旧文件存在则先 unlink,再 update manifest 持久化
- 启动扫描清理孤儿目录 / 孤儿 config 项
- 接 settingsStore(rebase 后已存在),customs 持久化挂在 settingsStore 旁边或独立 customStore — 跟 bug 修复分支 Phase 2 选定的 store 模式保持一致

集成测试在临时 `userData` 目录(用 `os.tmpdir()` + `mkdtempSync`)跑,覆盖 spec §8.2 全部场景。

### Task B3:IPC handlers + preload 暴露

**Files:**
- Modify: `src/main/main.ts`(注册 `appearance:list` / `appearance:create` / `appearance:rename` / `appearance:delete` / `appearance:pickAndAssign` / `appearance:clearAsset`)
- Modify: `src/preload/index.ts`(暴露 `window.api.appearance.*`)

`appearance:pickAndAssign` 在主进程内部调 `dialog.showOpenDialog({ filters: [{ name: "Image", extensions: ["gif","png","webp"] }] })`,然后 `validateFile`(extensions、size <= 10MB、可读)、`copyToUserData`、`assignAsset`、返回新 manifest。

### Task B4:把 Manager / Editor 接到 IPC

**Files:**
- Modify: `src/renderer/src/components/AppearanceManager.tsx`(把 `customs` / `onCreate` / `onRename` / `onDelete` / `onUpdateManifest` 全部从 `window.api.appearance` 喂入)
- Modify: `src/renderer/src/components/AppearanceEditor.tsx`(`onPickAsset` / `onClearAsset` 接 `window.api.appearance.pickAndAssign` / `clearAsset`)

`SettingsView.tsx` 改造一次:用 `useEffect` + `window.api.appearance.list()` 拉取 customs,传给 Manager。

### Task B5:阶段 B 收尾 + commit + push

- [ ] `pnpm test` 包括新增的集成测试全绿
- [ ] 手测一遍创建 / 改名 / 选文件(用真实 GIF) / 删除流程
- [ ] commit 每个子任务,push

---

## 阶段 C:接 PetView + protocol 扩展(最后一步)

**启动条件:** bug 修复分支全部 6 个 Phase 完成合到 main。

### Task C1:扩展 `pet-assets://` 协议处理

**Files:**
- Modify: `src/main/main.ts`(协议注册函数)

把现有 protocol handler(目前只解析 `pet_assets/...`)扩展为识别两种 host:
- `pet-assets://builtin/...`(向后兼容,把现有 `pet-assets://path-to-builtin` 视为 builtin)
- `pet-assets://custom/<bareId>/<file>`(新)→ 解析到 `userData/customAssets/<bareId>/<file>`

加单测覆盖两种 host 的路径生成与拒绝越权(防止 `..` 跨目录访问)。

### Task C2:PetView 接 registry.resolve

**Files:**
- Modify: `src/renderer/src/components/PetView.tsx`(line 65-66)
- Modify: `src/renderer/src/assets.ts`(把 `getPetAsset` 内部从 `getPetAssetDefinition` 改为 `registry.resolve`)
- Modify: `src/shared/petAppearances.ts`(移除 Task A5 加的 `getPetAssetDefinition` 兼容别名)
- Modify: `src/main/main.ts`(`getPetSpecies` / `resolvePetAppearanceId` 调用点改为通过 registry,因为现在可能是 custom)

把 renderer 侧的 registry 实例从 IPC 拉来的 customs 构造,在 React Context 或 props 里下传给 PetView。

### Task C3:孤儿形象切换处理(spec §7)

如果 settings.petAppearanceId 是 custom: 但该 id 已被删除,启动时 `registry.hasAppearance` 检测到 false,自动切回 lineDog 并写日志。

### Task C4:端到端手测 + 合并到 main

完整跑一遍:
1. 创建一个自定义形象,起名"测试猫"
2. 选一个 GIF 给 idle 状态
3. 切换到这个形象 → 看到 PetView 显示 GIF
4. 切到 happy 状态(用 demo 触发器)→ 因为没设 happy,fallback 到 idle(同一 GIF)
5. 选另一个 GIF 给 happy → 切 happy 状态 → 看到新 GIF
6. 删除该形象 → settings 自动切回 lineDog
7. 重启应用 → 设置仍是 lineDog,新创建的"测试猫"还在(因为没删它,只是切回)

验证全部走通后 → PR / merge 到 main。

---

## Self-Review Notes

- **Spec 覆盖度**:spec §1-13 各小节均有 plan 任务对应。§5 类型 → A3/A4。§6 数据流 → 阶段 B/C。§7 错误矩阵 → 主要在阶段 B(IPC handler)实现,§7 最后两条(切换到已删除/资源缺失)在阶段 C Task C3。§8 测试 → A4/A6 覆盖单测,B2 覆盖集成测,C4 覆盖手测。§9 阶段拆分 → 直接对应 plan 三阶段。§11 风险 → A1(vitest 锁定)、A5(rename 漏调用点用 typecheck 兜底)。
- **类型一致性**:`PetAppearanceId` / `BuiltinAppearanceId` / `CustomAppearanceId` 在 A3 定义后,A4-A9 / B2-B4 / C2 全部一致使用。`getBuiltinAsset` 在 A5 定义,A6 import。`createAppearanceRegistry(customs)` 签名在 A6 定义,A8/B4 一致使用。`STATE_FALLBACKS` 在 A5 export 后 A6 import。
- **占位符扫描**:`pet-assets://custom/<bareId>/<file>` 是协议路径模式,不是 placeholder。其他 `<id>` `<state>` 等模板符号都在带具体例子的代码块内(如 `pet-assets://custom/my-cat/happy.gif` 在 Task A6 测试里出现实际值)。
