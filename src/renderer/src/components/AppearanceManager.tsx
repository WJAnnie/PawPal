import { useMemo, useState } from "react";
import type { Language, PetAppearanceId, PetState } from "../../../shared/types";
import type { CustomAppearanceManifest } from "../../../shared/customAppearance";
import { createAppearanceRegistry } from "../../../shared/appearanceRegistry";
import { AppearanceEditor } from "./AppearanceEditor";

interface AppearanceManagerProps {
  language: Language;
  selectedId: PetAppearanceId;
  // Stage A: undefined, Manager simulates with local state.
  // Stage B: customs come from window.pawpal.appearance.list().
  customs?: Record<string, CustomAppearanceManifest>;
  onSelect: (id: PetAppearanceId) => void;
  onCreate?: (name: string) => Promise<CustomAppearanceManifest> | CustomAppearanceManifest;
  onRename?: (bareId: string, newName: string) => void;
  onDelete?: (bareId: string) => void;
  onUpdateManifest?: (manifest: CustomAppearanceManifest) => void;
  // Stage B: per-state asset operations forwarded to AppearanceEditor.
  onPickAsset?: (
    bareId: string,
    state: PetState
  ) => Promise<CustomAppearanceManifest | null>;
  onClearAsset?: (
    bareId: string,
    state: PetState
  ) => Promise<CustomAppearanceManifest>;
}

export function AppearanceManager({
  language,
  selectedId,
  customs,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  onUpdateManifest,
  onPickAsset,
  onClearAsset,
}: AppearanceManagerProps) {
  // Stage A: when customs is not supplied (no IPC yet), use local state to make UI clickable.
  const [localCustoms, setLocalCustoms] = useState<Record<string, CustomAppearanceManifest>>({});
  const effectiveCustoms = customs ?? localCustoms;

  const [editingBareId, setEditingBareId] = useState<string | null>(null);

  // Inline create / rename inputs (Electron disables window.prompt by default).
  const [creatingName, setCreatingName] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ bareId: string; draft: string } | null>(null);

  const registry = useMemo(
    () => createAppearanceRegistry(effectiveCustoms),
    [effectiveCustoms]
  );
  const list = registry.listAll(language);

  const startCreate = () => {
    setCreatingName("");
  };

  const submitCreate = async () => {
    const name = (creatingName ?? "").trim();
    if (name.length === 0) {
      setCreatingName(null);
      return;
    }
    if (onCreate) {
      const created = await onCreate(name);
      setEditingBareId(created.id);
    } else {
      const bareId = `local-${Date.now()}`;
      const manifest: CustomAppearanceManifest = {
        id: bareId,
        name,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        assets: {},
        version: 1,
      };
      setLocalCustoms((prev) => ({ ...prev, [bareId]: manifest }));
      setEditingBareId(bareId);
    }
    setCreatingName(null);
  };

  const startRename = (bareId: string) => {
    const current = effectiveCustoms[bareId];
    if (!current) return;
    setRenaming({ bareId, draft: current.name });
  };

  const submitRename = () => {
    if (!renaming) return;
    const newName = renaming.draft.trim();
    const current = effectiveCustoms[renaming.bareId];
    if (newName.length === 0 || !current) {
      setRenaming(null);
      return;
    }
    if (onRename) {
      onRename(renaming.bareId, newName);
    } else {
      setLocalCustoms((prev) => ({
        ...prev,
        [renaming.bareId]: { ...prev[renaming.bareId], name: newName, updatedAt: Date.now() },
      }));
    }
    setRenaming(null);
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
          language={language}
          onSave={handleEditorSave}
          onCancel={() => setEditingBareId(null)}
          onPickAsset={
            onPickAsset
              ? (state) => onPickAsset(editingBareId, state)
              : undefined
          }
          onClearAsset={
            onClearAsset
              ? (state) => onClearAsset(editingBareId, state)
              : undefined
          }
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
          const isRenamingThis = renaming?.bareId === bareId;
          return (
            <li
              key={item.value}
              className={`appearance-manager__item${isSelected ? " is-selected" : ""}`}
            >
              {isRenamingThis ? (
                <>
                  <input
                    autoFocus
                    type="text"
                    className="appearance-manager__rename-input"
                    value={renaming.draft}
                    onChange={(e) => setRenaming({ ...renaming, draft: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") submitRename();
                      else if (e.key === "Escape") setRenaming(null);
                    }}
                    maxLength={30}
                  />
                  <button
                    type="button"
                    className="appearance-manager__rename-confirm"
                    onClick={submitRename}
                  >
                    ✓
                  </button>
                  <button
                    type="button"
                    className="appearance-manager__rename-cancel"
                    onClick={() => setRenaming(null)}
                  >
                    ✗
                  </button>
                </>
              ) : (
                <>
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
                        onClick={() => startRename(bareId)}
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
                </>
              )}
            </li>
          );
        })}
      </ul>

      {creatingName === null ? (
        <button
          type="button"
          className="appearance-manager__create-btn"
          onClick={startCreate}
        >
          + 创建新形象
        </button>
      ) : (
        <div className="appearance-manager__create-row">
          <input
            autoFocus
            type="text"
            className="appearance-manager__create-input"
            placeholder="形象名称(1-30 字)"
            value={creatingName}
            onChange={(e) => setCreatingName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submitCreate();
              else if (e.key === "Escape") setCreatingName(null);
            }}
            maxLength={30}
          />
          <button
            type="button"
            className="appearance-manager__create-confirm"
            onClick={() => void submitCreate()}
          >
            创建
          </button>
          <button
            type="button"
            className="appearance-manager__create-cancel"
            onClick={() => setCreatingName(null)}
          >
            取消
          </button>
        </div>
      )}
    </div>
  );
}