import { useEffect, useState } from "react";
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
  "sleeping",
];

interface AppearanceEditorProps {
  manifest: CustomAppearanceManifest;
  onSave: (next: CustomAppearanceManifest) => void;
  onCancel: () => void;
  // Stage A: optional, falls back to alert stub.
  // Stage B: returns the updated manifest from main-process IPC; null when user cancels picker.
  onPickAsset?: (state: PetState) => Promise<CustomAppearanceManifest | null>;
  onClearAsset?: (state: PetState) => Promise<CustomAppearanceManifest>;
}

export function AppearanceEditor({
  manifest,
  onSave,
  onCancel,
  onPickAsset,
  onClearAsset,
}: AppearanceEditorProps) {
  const [name, setName] = useState(manifest.name);
  // Mirror of latest persisted manifest. Stage B: each pick/clear updates from IPC reply
  // and main-process is source of truth. Stage A: local-only updates.
  const [currentAssets, setCurrentAssets] = useState(manifest.assets);

  // If parent feeds a fresher manifest (e.g. appearance:updated event), keep mirror in sync
  // unless the user is mid-edit on the name field.
  useEffect(() => {
    setCurrentAssets(manifest.assets);
  }, [manifest]);

  const nameValidation = validateCustomAppearanceName(name);

  const handleSave = () => {
    if (!nameValidation.ok) return;
    onSave({
      ...manifest,
      name: name.trim(),
      assets: currentAssets,
      updatedAt: Date.now(),
    });
  };

  const handlePick = async (state: PetState) => {
    if (onPickAsset) {
      try {
        const updated = await onPickAsset(state);
        if (updated) setCurrentAssets(updated.assets);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        window.alert(`选择文件失败:${msg}`);
      }
    } else {
      window.alert(
        `[stub] 选择 ${state} 状态的素材文件 — 等阶段 B 接通 IPC 后生效`
      );
    }
  };

  const handleClear = async (state: PetState) => {
    if (onClearAsset) {
      try {
        const updated = await onClearAsset(state);
        setCurrentAssets(updated.assets);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        window.alert(`清除失败:${msg}`);
      }
    } else {
      setCurrentAssets((prev) => {
        const next = { ...prev };
        delete next[state];
        return next;
      });
    }
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
          const fileName = currentAssets[state];
          return (
            <li key={state} className="appearance-editor__state-row">
              <span className="appearance-editor__state-label">{state}</span>
              <span className="appearance-editor__file-name">
                {fileName ?? "(未设置)"}
              </span>
              <button
                type="button"
                className="appearance-editor__pick-btn"
                onClick={() => void handlePick(state)}
              >
                选择文件
              </button>
              <button
                type="button"
                className="appearance-editor__clear-btn"
                onClick={() => void handleClear(state)}
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