# Bug-fix 6-Phase Plan — 验证报告

- 日期:2026-05-08
- 验证人:Claude(代用户跑静态验证 + 抽测)
- 涉及分支:`feat/store-extraction` → `feat/display-position` → `feat/transparent-passthrough` → `feat/phase6-verification`
- Phase 1(纯函数 + 测试基础设施)随 Phase 2 的 vitest 锁定 commit 落地
- Phase 3 不在原进度列表内,跳过
- Phase 4 顺序紧跟 Phase 2(原列表跳序,实际依赖排列)

---

## 各 Phase commit 索引

| Phase | 分支 | Commit | 说明 |
|---|---|---|---|
| 1 | feat/store-extraction | `48e33f8` | `chore(deps)` 锁定 vitest@4.1.5 + @vitest/coverage-v8@4.1.5 到 devDependencies |
| 2 | feat/store-extraction | `8fc45f1` | `feat(main)` SettingsStore + 单测:cache + 归一化 + petPosition |
| 2 | feat/store-extraction | `91296a1` | `feat(main)` StatsStore + 单测:day rollover + history dedup |
| 2 | feat/store-extraction | `62eb2c3` | `refactor(main)` main.ts 路由到两个 store(净减 64 行) |
| 4 | feat/display-position | `8ba17bf` | `feat(settingsStore)` PetPosition 加可选 displayId(向后兼容) |
| 4 | feat/display-position | `0320ff1` | `feat(main)` 多屏插拔记忆:initialPetBounds 用 displayId 找 display,fallback primary |
| 5 | feat/transparent-passthrough | `4f88aa2` | `feat(pet)` 透明区穿透:setIgnoreMouseEvents + 三个 hit-area + IPC |
| 6 | feat/phase6-verification | `fbe4b9f` | `refactor(main)` 抽 resolvePassthrough/resolveStoredDisplayId 为纯函数 + 9 个单测 |

所有分支已 push 到 `origin`(除 phase6 当前会话尚未 push)。本地 main 停在 Phase 4(因主工作树 WIP 阻塞 Phase 5 fast-forward,用户决定不合入)。

---

## 自动化验证结果(2026-05-08 本会话末状态 — `feat/phase6-verification` 分支)

```
$ pnpm typecheck    → 全绿(无错)
$ pnpm test         → 86 / 86 passed (7 test files)
$ pnpm build        → 全绿(electron-vite main + preload + renderer 三件套)
```

测试矩阵明细:

| 测试文件 | 用例数 | 覆盖 |
|---|---|---|
| src/main/settingsStore.test.ts | 16 | 默认 / round-trip / 归一化 / patch / petPosition + displayId 兼容 |
| src/main/statsStore.test.ts | 12 | 同日 / 跨日 rollover / updateToday / resetToday / history dedup |
| src/main/windowDecisions.test.ts | 9 | passthrough 决策 + displayId 解析 |
| src/main/ai/settingsStore.test.ts | 10 | (既有,未改) |
| src/main/ai/sseParser.test.ts | (既有) | (既有) |
| src/shared/ai/chatCacheReloader.test.ts | (既有) | (既有) |
| src/shared/ai/profileSync.test.ts | (既有) | (既有) |

---

## 代码评估摘要

**重构前的痛点(Phase 2 之前)**:
- main.ts 直接持有 `electron-store` 实例,settings/stats 读写散落 10 处
- petPosition 只记 x/y,多屏拔插后会跳到错误屏幕
- 透明窗口 220×340 整块吃桌面点击
- 上述行为没有任何单测保护

**重构后**:
- main.ts 通过 SettingsStore + StatsStore 访问数据,每个 store ≤ 110 行,fake store 注入即可单测
- PetPosition 含 displayId,resolveStoredDisplayId 纯函数 — 多屏 fallback 行为有测试保护
- 透明窗口默认 setIgnoreMouseEvents(true, {forward:true}),renderer 通过 mouseEnter/Leave 控制 hit-area;panel/chat 模式 main 强制接收(永远不穿透)
- 9 个新决策测试 + 28 个新 store 测试覆盖核心行为

---

## 待用户手测的 GUI 验证清单

我不能跑 GUI,以下需用户在 dev 模式手测:

```bash
# 切到 phase6 分支跑 dev
git checkout feat/phase6-verification
pnpm install
pnpm dev
```

### Phase 2 验证(SettingsStore + StatsStore)
- [ ] 设置面板改语言(中→英)→ 关闭应用 → 重启 → 仍是英文
- [ ] 设置面板改宠物形象(lovartPuppy ↔ lineDog)→ 关闭 → 重启 → 形象保持
- [ ] 改 break/hydration/focus 时长 → 关闭 → 重启 → 时长保持
- [ ] 触发一次 break-done → stats.breaksTaken +1 → 重启 → 数字保持
- [ ] 触发一次 hydration-done → stats.watersLogged +1 → 重启 → 数字保持
- [ ] 跑完一次 25min 番茄 → stats.focusMinutes 增加 → 重启 → 数字保持
- [ ] 把系统时间设到明天 → 重启 → 看 stats 数字归零、历史里出现昨日条目
- [ ] 没有任何 console error / 崩溃

### Phase 4 验证(petPosition + displayId)
- [ ] 单屏拖宠物到屏幕另一角 → 退出 → 重启 → 位置保持
- [ ] **有第二屏时**:把宠物拖到第二屏 → 退出 → 重启 → 仍在第二屏
- [ ] 拔掉第二屏的连接 → 重启应用 → 宠物 fallback 到主屏(不是消失)
- [ ] 重新插上第二屏 → 拖宠物到第二屏 → 退出 → 重启 → 宠物在第二屏
- [ ] 旧用户(petPosition 只有 x/y 没 displayId)→ 启动不报错,首次保存自动 backfill displayId

### Phase 5 验证(透明穿透 + hit-area)
- [ ] 鼠标移到宠物窗口透明角落 → 看到 cursor 落在桌面图标上(可点击桌面)
- [ ] 鼠标移到 sprite 本身 → 可以拖动宠物
- [ ] 显示气泡(触发 demo break)→ 鼠标移到气泡 → 气泡按钮可点
- [ ] 启动 focus mode → focus-badge 显示 → 鼠标移到 badge 上 → 可读取(不穿透)
- [ ] 打开状态面板(panel 模式)→ 鼠标在面板任意位置都正常响应
- [ ] 打开 AI 聊天气泡 → 鼠标在聊天框正常响应
- [ ] 关闭 panel 回到 compact → 透明角恢复穿透
- [ ] 拖动 sprite → 拖动正常(没有因 ignore 中断)

---

## PR 草稿

**标题**:`feat: extract stores + record display + transparent corner passthrough`

**描述**:

```markdown
## Summary

Cleanup pass on the main process state ownership and a few quality-of-life
fixes for transparent / multi-monitor users.

- **Stores**: settings + stats + petPosition + statsHistory now live in
  dedicated SettingsStore / StatsStore classes (`src/main/settingsStore.ts`
  / `statsStore.ts`). main.ts no longer holds an electron-store instance.
  Both stores have fake-store-injected unit tests.
- **Multi-monitor memory**: `PetPosition` carries an optional `displayId`.
  On launch we look up the stored display via `screen.getAllDisplays()`;
  if it's gone (laptop dock unplugged, USB monitor disconnected) we fall
  back to the primary display. Legacy data without `displayId` keeps loading.
- **Transparent corner passthrough**: pet window defaults to
  `setIgnoreMouseEvents(true, {forward:true})`. Renderer flips it off via
  the new `pawpal.petSetMousePassthrough` IPC when the cursor enters the
  sprite, bubble, or focus-badge hit-areas. Panel and chat modes always
  receive events regardless of renderer intent.
- **Decision logic**: `resolvePassthrough` and `resolveStoredDisplayId`
  hoisted into `windowDecisions.ts` (no electron import) for unit testing.

## Test plan

- [x] `pnpm typecheck` — clean
- [x] `pnpm test` — 86 / 86 (7 files)
- [x] `pnpm build` — main + preload + renderer all green
- [ ] Manual: settings persist across restart
- [ ] Manual: stats persist + day rollover
- [ ] Manual: pet position survives display unplug/re-plug
- [ ] Manual: transparent corners pass clicks to desktop
- [ ] Manual: panel/chat fully interactive

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

---

## 已知未解决项

1. **Phase 5 跟主工作树 WIP 冲突**:用户主工作树有 `PetView.tsx` / `styles.css` / `HoverActions.tsx` / `VitalsToast.tsx` 未提交改动跟 Phase 5 重叠,本地 fast-forward 受阻。
   - 建议:先 commit/stash WIP,再合入 Phase 5/6
2. **Phase 6 分支尚未 push**(当前会话末状态)
   - 建议:`git push -u origin feat/phase6-verification`
3. **e2e 测试**:本次没装 Playwright(避免引入新依赖)。决策逻辑通过纯函数 + vitest 已覆盖,GUI 行为只能手测
4. **未推 origin/main**:本地 main 因 WIP 卡在 Phase 4 commit,合入策略由用户定
