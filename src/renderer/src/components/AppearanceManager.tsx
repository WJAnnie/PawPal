import { useMemo, useState } from "react";
import type { Language, PetAppearanceId } from "../../../shared/types";
import type { CustomAppearanceManifest } from "../../../shared/customAppearance";
import { createAppearanceRegistry } from "../../../shared/appearanceRegistry";
import { AppearanceEditor } from "./AppearanceEditor";

interface AppearanceManagerProps {
  language: Language;
  selectedId: PetAppearanceId;
  // Stage A: undefined, Manager simulates with local state.
  // Stage B: customs come from window.api.appearance.list().
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
  onUpdateManifest,
}: AppearanceManagerProps) {
  // Stage A: when customs is not supplied (no IPC yet), use local state to make UI clickable.
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
      const bareId = `local-${Date.now()}`;
      const manifest: CustomAppearanceManifest = {
        id: bareId,
        name: name.trim(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        assets: {},
        version: 1,
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
        [bareId]: { ...prev[bareId], name: newName.trim(), updatedAt: Date.now() },
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