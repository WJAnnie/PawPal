# 自定义形象系统 — 设计文档

- 状态:Draft
- 日期:2026-05-07
- 作者:WJAnnie + Claude
- 关联分支:`feat/custom-appearance` (待创建)
- 关联会话:bug 修复 6-Phase Plan(运行于另一会话)

---

## 1. 目标 / Goal

让用户在不修改源码的前提下,能在应用内导入本地 GIF / PNG / WEBP 文件,组成"自己的桌面宠物形象"并切换使用。

### 1.1 In Scope (v1)

- 用户可通过设置面板 UI 创建多个自定义形象。
- 每个形象可逐状态(共 14 个 PetState)指定本地素材文件;允许部分状态留空。
- 选定文件后,应用立即将文件**复制**到 `userData/customAssets/<id>/` 内,后续不依赖原文件位置。
- 形象列表支持:创建 / 重命名 / 切换 / 删除。
- 切换到自定义形象后,PetView 正常驱动状态机,缺失状态按 fallback 表回退。

### 1.2 Out of Scope (留 v2)

- 缩略图 / 网格化形象选择器 UI。
- 形象包导出为 zip / 安装包。
- 社区形象包下载 / 分享。
- 多帧动画的逐帧编辑(v1 仍把每个状态视为单文件)。
- 跨设备同步。

### 1.3 Non-goals

- **不**做素材压缩 / 格式转换。原文件什么样就什么样。
- **不**支持手绘 / 内置编辑器。
- **不**做哈希去重(用户可能重复上传同一个 GIF,占点空间可接受)。

---

## 2. 关键决策汇总

| # | 维度 | 决定 | 决策原因 |
|---|---|---|---|
| 1 | 素材组织 | UI 内逐状态选文件 | 零门槛,无需用户记住命名约定 |
| 2 | 存储策略 | 复制到 `userData/customAssets/<id>/` | 自包含、稳定;原文件改名/删除不影响 |
| 3 | 多套管理 | v1 多套 + 命名 + 切换 + 删除;v2 加缩略图等 CRUD | v1 控制实现量,数据结构留接口给 v2 |
| 4 | Fallback 策略 | 纯内部:沿用现有 `STATE_FALLBACKS`,最终落到 `idle` | 保持单一形象的视觉一致性,绝不跨形象借素材 |
| 5 | 类型系统 | `PetAppearanceId = BuiltinAppearanceId \| \`custom:${string}\`` | 内置 ID 仍享受字面量类型;运行时分支用 `startsWith("custom:")` |
| 6 | 模块边界 | 新建 `appearanceRegistry.ts` 适配层,`petAppearances.ts` 几乎不动 | 与 bug 修复分支冲突最小化 |

---

## 3. 总体架构

```
┌─────────────────────────────────────────────────────────────┐
│  Renderer (React)                                            │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  AppearanceManager (新组件,设置 tab 内)              │  │
│  │  ├ 形象列表 (内置 2 + 自定义 N)                      │  │
│  │  ├ [+] 创建新形象 → AppearanceEditor                 │  │
│  │  └ 操作:切换默认 / 重命名 / 删除                    │  │
│  └──────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  AppearanceEditor (新组件)                           │  │
│  │  ├ 形象名称输入                                       │  │
│  │  ├ 14 状态列表 × [选择文件] / [清除] / 当前文件名     │  │
│  │  └ [保存] [取消]                                     │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                              │
│  PetView (现有,接入 registry.resolve)                       │
└─────────────────────────────────────────────────────────────┘
                           ↑↓ IPC
┌─────────────────────────────────────────────────────────────┐
│  Main (Electron)                                             │
│  customAppearanceStore.ts                                    │
│  + IPC handlers (appearance:*)                               │
│  + pet-assets:// protocol 扩展                               │
└─────────────────────────────────────────────────────────────┘
                           ↑
┌─────────────────────────────────────────────────────────────┐
│  Shared (纯 TS,无副作用,可测)                              │
│  types.ts + petAppearances.ts (改名内部) + customAppearance  │
│  + appearanceRegistry.ts (适配层)                            │
└─────────────────────────────────────────────────────────────┘
```

---

## 4. 模块清单

| 模块 | 位置 | 职责 | v1 改动类型 |
|---|---|---|---|
| `src/shared/types.ts` | shared | `PetAppearanceId` 字面量 union → 加入 `custom:${string}` | 改 |
| `src/shared/petAppearances.ts` | shared | 重命名 `PET_APPEARANCES` → `BUILTIN_APPEARANCES`,导出 `getBuiltinAsset` | 改(只重命名导出) |
| `src/shared/customAppearance.ts` | shared | `CustomAppearanceManifest` 类型 + 校验函数 | **新增** |
| `src/shared/appearanceRegistry.ts` | shared | 适配层,`resolve(id, state)` 统一入口 | **新增** |
| `src/main/customAppearanceStore.ts` | main | 文件操作 + 持久化 | **新增** |
| `src/main/main.ts` | main | 注册 `appearance:*` IPC + 扩展 `pet-assets://` | 改(等 bug Phase 2 后) |
| `src/main/config.ts` | main | 持久化 `customAppearances` 字段 | 改(等 bug Phase 2 后) |
| `src/preload/index.ts` | preload | 暴露 `window.api.appearance.*` | 改(等 bug Phase 2 后) |
| `src/renderer/src/components/AppearanceManager.tsx` | renderer | 形象列表 UI | **新增** |
| `src/renderer/src/components/AppearanceEditor.tsx` | renderer | 14 状态选文件 UI | **新增** |
| `src/renderer/src/components/PetView.tsx` | renderer | 接入 registry.resolve | 改(最后阶段) |

---

## 5. 数据结构

### 5.1 类型定义(可直接落代码)

```ts
// src/shared/types.ts (改)
export type BuiltinAppearanceId = "lovartPuppy" | "lineDog";
export type CustomAppearanceId = `custom:${string}`;
export type PetAppearanceId = BuiltinAppearanceId | CustomAppearanceId;

// src/shared/customAppearance.ts (新)
export type CustomAppearanceManifest = {
  id: string;                                    // 不带 custom: 前缀
  name: string;                                  // 用户取的名字,1-30 字
  createdAt: number;                             // Unix ms
  updatedAt: number;                             // Unix ms
  assets: Partial<Record<PetState, string>>;     // 相对 customAssets/<id>/ 的文件名
  version: 1;                                    // schema 版本,未来迁移用
};

export type CustomAppearancesConfig = {
  appearances: Record<string, CustomAppearanceManifest>;  // key = id (不带前缀)
};
```

### 5.2 类型守卫与转换

```ts
// src/shared/customAppearance.ts
export function isCustomAppearanceId(id: PetAppearanceId): id is CustomAppearanceId {
  return typeof id === "string" && id.startsWith("custom:");
}

export function customIdToBareId(id: CustomAppearanceId): string {
  return id.slice("custom:".length);
}

export function bareIdToCustomId(bareId: string): CustomAppearanceId {
  return `custom:${bareId}`;
}
```

### 5.3 Registry 接口

```ts
// src/shared/appearanceRegistry.ts (新)
export interface AppearanceRegistry {
  resolve(id: PetAppearanceId, state: PetState): PetAssetDefinition;
  listAll(language: Language): Array<{ value: PetAppearanceId; label: string }>;
  getSpecies(id: PetAppearanceId): PetSpecies;
}

export function createAppearanceRegistry(
  customs: Record<string, CustomAppearanceManifest>
): AppearanceRegistry;
```

---

## 6. 关键数据流

### 6.1 用户给某状态指定文件

```
1. 用户在 AppearanceEditor 里点 [选择文件] 旁边的 happy
2. renderer:
     window.api.appearance.pickAndAssign(customId, "happy")
3. main:
     dialog.showOpenDialog({
       filters: [{ name: "Image", extensions: ["gif", "png", "webp"] }]
     })
4. main: validateFile(srcPath) — 大小、扩展名、可读
5. main: copyToUserData(srcPath, customId, "happy")
       → userData/customAssets/<bareId>/happy.<ext>
6. main: customAppearanceStore.assignAsset(bareId, "happy", relPath)
       → 更新内存中的 manifest + 持久化 config.json
7. main 返回 { success, manifest } 给 renderer
8. renderer 收到结果,刷新 Editor 视图
```

### 6.2 渲染期解析

```
1. PetView 从 settings 读到 petAppearanceId = "custom:abc123"
2. PetView 调用 registry.resolve(id, currentState)
3. registry:
   if isCustom(id):
     manifest = customs[bareId(id)]
     def = manifest.assets[state]
       ?? manifest.assets[STATE_FALLBACKS[state]]
       ?? manifest.assets["idle"]
       ?? BUILTIN_APPEARANCES.lineDog.fallback   // 最后保底
     return { path: `pet-assets://custom/${bareId}/${def}` }
   else:
     return getBuiltinAsset(id, state)
4. PetView 渲染 <img src="pet-assets://...">
```

### 6.3 切换形象

```
1. 用户在 AppearanceManager 点击某个形象
2. renderer: 触发 settings.update({ petAppearanceId: <new id> })
3. 通过现有 settings IPC,持久化
4. settings:updated 广播 → PetView 重渲染
```

---

## 7. 错误处理矩阵

| 场景 | 检测点 | 处理 |
|---|---|---|
| 选了非 GIF/PNG/WEBP | dialog 过滤 + main 二次校验 | 返回错误,renderer toast 提示 |
| 文件 > 10MB | main `fs.stat` | 弹确认对话框 |
| 文件不可读 / 已被删除 | main `fs.copyFile` 抛错 | 返回错误,renderer toast 提示 |
| 复制时磁盘满 | `fs.copyFile` ENOSPC | 返回错误,renderer toast 提示 |
| 切换到已删除的自定义形象 | settings 读取时 registry.resolve 找不到 | 自动切回 `lineDog`,记日志 |
| `userData/customAssets/<id>/` 存在但 config 没该 id | 应用启动时扫描 | 清理孤儿目录 |
| `assets[state]` 指向的文件不存在 | registry.resolve | fallback 链;若全失败用 lineDog idle |
| 用户取的名字重复 | renderer + main 都校验 | 自动 append `(2)` |

---

## 8. 测试策略

| 测试层 | 工具 | 阶段 1 写 | 阶段 2 写 | 阶段 3 写 |
|---|---|---|---|---|
| **纯函数单测** | vitest | ✅ `customAppearance` 校验 + `appearanceRegistry.resolve` 全分支 + fallback 链 | | |
| **IPC 集成测** | vitest + tmp userData 目录 | | ✅ Store CRUD + 文件复制 + 孤儿目录清理 | |
| **UI 手测** | 手动 checklist | | | ✅ 创建 / 改名 / 切换 / 删除流程 + 错误提示 |

### 8.1 单测必须覆盖的场景

- `isCustomAppearanceId` 对各种输入返回正确
- `appearanceRegistry.resolve`:
  - 内置 ID 走原路径
  - 自定义 ID 命中 → 用 manifest
  - 自定义 ID 命中但 state 缺失 → 走 STATE_FALLBACKS
  - 自定义 ID 命中但 state 和 fallback 都缺失 → 走 idle
  - 自定义 ID 命中但什么都没有 → 走 lineDog idle
  - 自定义 ID 不存在(已删除/损坏) → 走 lineDog idle

### 8.2 集成测必须覆盖的场景

- 创建新形象 → 目录创建,config 写入
- assignAsset → 文件复制到正确路径,manifest 更新
- assignAsset 同一 state 第二次 → 旧文件删除,新文件覆盖
- 删除形象 → 目录清空,config 删除
- 启动扫描:有孤儿目录 → 删除
- 启动扫描:有孤儿 config 项(目录被外部删了)→ 移除该项

---

## 9. v1 错峰并行实施计划

### 9.1 三阶段时间线

```
                   Bug 修复分支            形象系统分支 (feat/custom-appearance)
                   ─────────────────       ──────────────────────────────────
[现在]              Phase 1 进行中          ┌ 阶段 A — 纯前端/纯函数 (今天就开)
                    Phase 2 待开始          │  • 创建 feat/custom-appearance 分支
                                            │  • 改 types.ts (类型扩展)
                                            │  • 新增 customAppearance.ts
                                            │  • 新增 appearanceRegistry.ts
                                            │  • 单元测试 (8.1 全部场景)
                                            │  • AppearanceEditor 组件 UI 骨架
                                            │  • AppearanceManager 组件 UI 骨架
                                            │  • 用 mock data 在 storybook/手测页面验证
                                            │  ✅ 完全不碰 main.ts/config.ts/preload
                                            │
[等待节点]          Phase 2 完成,settings   │   ⬇ rebase / merge
                    store 抽出落地           │
                                            │
                    Phase 3-6 继续           ├ 阶段 B — 后端 (Phase 2 完成后)
                                            │  • customAppearanceStore.ts
                                            │  • IPC handlers (appearance:*)
                                            │  • config.ts 加 customAppearances 字段
                                            │  • preload 暴露 window.api.appearance
                                            │  • Editor 组件接 IPC
                                            │  • 集成测试 (8.2 全部场景)
                                            │
[最后合并]          全部完成 → main          ⬇
                                            └ 阶段 C — 集成 (Phase 6 完成后)
                                               • PetView.tsx 接 registry
                                               • pet-assets:// 协议扩展支持
                                                 custom/<id>/<file>
                                               • 端到端手测
                                               • 合并到 main
```

### 9.2 阶段 A 任务粒度(可马上启动)

A1. 建分支 `feat/custom-appearance`,基线 = 当前 main
A2. **修 `package.json`:把 `vitest` + `@vitest/coverage-v8` 显式加到 `devDependencies`**(详见 9.4)
A3. 改 `src/shared/types.ts`:`PetAppearanceId` 类型扩展
A4. 新建 `src/shared/customAppearance.ts`:类型 + 类型守卫 + 校验函数
A5. 新建 `src/shared/appearanceRegistry.ts`:`createAppearanceRegistry` + `resolve` 实现
A6. 写单元测试,对应 8.1 全部场景(文件命名 `*.test.ts`,放在被测文件同级或 `__tests__/` 下,符合 vitest.config 的 include glob)
A7. 重命名 `PET_APPEARANCES` → `BUILTIN_APPEARANCES`,导出 `getBuiltinAsset`;**全局搜索现有调用点(主要是 `PetView.tsx`、`AiSettingsSection.tsx`)逐一更新**
A8. 新建 `AppearanceEditor.tsx`:UI 骨架(选文件按钮先用 stub,onClick 弹 alert)
A9. 新建 `AppearanceManager.tsx`:UI 骨架,**包含 创建 / 重命名 / 删除 / 切换默认 四个按钮**(都用本地 state,先 stub 不连 IPC)
A10. 在 AiSettingsSection 加一个"形象"子 tab,挂载 Manager
A11. 阶段 A 内部 PR / commit:`pnpm test` 全绿、`pnpm typecheck` 全绿、UI 走得通(用 mock data)

### 9.3 阶段 A 完成 / 阶段 B 启动条件

- bug 修复分支 Phase 2(抽 settingsStore + statsStore)合到 main
- 此时 `feat/custom-appearance` rebase 到最新 main
- 检查冲突点:`config.ts`、`main.ts` 是否符合预期

### 9.4 测试基础设施

仓库当前状态(2026-05-07 实际查证):

- ✅ `package.json` `scripts` 已有 `"test": "vitest run"` 和 `"test:watch": "vitest"`
- ✅ `vitest.config.ts` 已存在,`include: ["src/**/*.{test,spec}.{ts,tsx}"]`,`environment: "node"`
- ✅ `node_modules/.pnpm/vitest@4.1.5` 已落盘,`@vitest/coverage-v8@4.1.5` 也在
- ❌ **但 `package.json` 的 `devDependencies` 里没有 `vitest` 和 `@vitest/coverage-v8` 的显式声明** — 下次 `pnpm install --frozen-lockfile` 或干净环境装机时,这些可能丢失或变成 transitive 依赖,不稳

**阶段 A 第一步必须做**:

```bash
pnpm add -D vitest@4.1.5 @vitest/coverage-v8@4.1.5
```

这是阻塞性的 — 在没把版本钉到 devDependencies 之前,任何写测试的工作都建立在脆弱基础上。

阶段 A 不需要新增 happy-dom / jsdom,因为本期所有单测都是纯函数(types、registry、manifest 校验),environment: "node" 足够。UI 是手测。

若与 bug 修复分支的 Phase 1(纯函数+测试基础设施)产生冲突,以 bug 修复分支为准、本分支跟随其选定的 vitest 版本与配置。

---

## 10. v2 范围(显式 out of v1)

- 形象网格选择器 + 缩略图(自动取 idle 首帧)
- 右键菜单:复制 / 重命名 / 删除 / 设为默认
- 形象包导出 zip(含 manifest + 资源)
- 形象包导入 zip
- 14 状态外的扩展状态(若新增的话)
- 多帧序列编辑(每个 state 用一个数组而非单文件)— 当前 schema 已留接口空间,届时 `assets[state]` 改成 `string | string[]`

---

## 11. 风险与缓解

| 风险 | 严重度 | 缓解 |
|---|---|---|
| `vitest` 未 declare 在 `devDependencies`,下次干净装机会掉 | 高 | 阶段 A 第 2 步 `pnpm add -D vitest@4.1.5 @vitest/coverage-v8@4.1.5` |
| bug 修复分支大改 `main.ts`,阶段 B 时冲突剧烈 | 中 | 阶段 A 严守"不动 main.ts",冲突仅限 IPC 注册行 |
| `pet-assets://` 协议改造影响内置形象加载 | 中 | 协议处理函数加单测,扩展时不动原 builtin 路径分支 |
| `PET_APPEARANCES` 改名为 `BUILTIN_APPEARANCES` 漏改调用点 | 中 | 阶段 A 借助 TS 编译错误强制定位所有调用,`pnpm typecheck` 必须全绿 |
| 用户大量上传超大 GIF 撑爆磁盘 | 低 | v1 弹 10MB 警告,v2 再考虑配额 |
| 配置文件升级路径(v1 → v2 schema 变化) | 低 | manifest 已带 `version: 1` 字段 |

---

## 12. 待办与后续

完成此 spec 用户审批后:
- 调用 `superpowers:writing-plans` skill 生成详细实施 plan
- 实施 plan 落到 `docs/superpowers/plans/2026-05-07-custom-appearance-plan.md`
- 阶段 A 任务以 plan 中的形式跟踪,逐一打勾完成

---

## 13. 引用

- 现有形象数据结构:`src/shared/petAppearances.ts`
- 现有形象类型:`src/shared/types.ts`
- 现有渲染逻辑:`src/renderer/src/components/PetView.tsx`
- bug 修复 Plan:运行于另一会话(Phase 1-6,关注 Phase 2 完成节点)
