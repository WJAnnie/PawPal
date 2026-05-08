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
  "sleeping",
];

interface AppearanceEditorProps {
  manifest: CustomAppearanceManifest;
  onSave: (next: CustomAppearanceManifest) => void;
  onCancel: () => void;
  // Stage A: optional, falls back to alert stub.
  // Stage B: wired to window.api.appearance IPC.
  onPickAsset?: (state: PetState) => void;
  onClearAsset?: (state: PetState) => void;
}

export function AppearanceEditor({
  manifest,
  onSave,
  onCancel,
  onPickAsset,
  onClearAsset,
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
      updatedAt: Date.now(),
    });
  };

  const handlePick = (state: PetState) => {
    if (onPickAsset) {
      onPickAsset(state);
    } else {
      window.alert(
        `[stub] 选择 ${state} 状态的素材文件 — 等阶段 B 接通 IPC 后生效`
      );
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