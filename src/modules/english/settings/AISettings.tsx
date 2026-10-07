import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, ExternalLink, X } from 'lucide-react';
import { open as openExternal } from '@tauri-apps/plugin-shell';
import {
  listAIProviders,
  createAIProvider,
  updateAIProvider,
  deleteAIProvider,
  type AIProvider,
} from '@/db/translator-providers-dao';
import { AI_TEMPLATES, findAI } from '@/lib/translator-templates';

export function AISettings() {
  const [items, setItems] = useState<AIProvider[]>([]);
  const [editing, setEditing] = useState<AIProvider | null>(null);
  const [creating, setCreating] = useState(false);

  async function refresh() {
    setItems(await listAIProviders());
  }
  useEffect(() => {
    refresh();
  }, []);

  async function toggle(id: string, v: boolean) {
    await updateAIProvider(id, { is_enabled: v ? 1 : 0 });
    await refresh();
  }
  async function del(id: string) {
    if (!confirm('确认删除此 AI 服务？')) return;
    await deleteAIProvider(id);
    await refresh();
  }

  return (
    <div className="card">
      <div className="card-title">
        <h3>AI 翻译</h3>
        <button className="btn btn-primary !py-1 !px-3 text-xs" onClick={() => setCreating(true)}>
          <Plus size={12} /> 新增 AI
        </button>
      </div>
      <div className="card-body">
        {items.length === 0 && (
          <div className="text-ink-3 text-sm text-center py-6">
            还没有 AI 服务实例，点右上"新增 AI"添加
          </div>
        )}
        {items.length > 0 && (
          <table className="table w-full">
            <thead>
              <tr>
                <th className="w-16">序号</th>
                <th>服务商</th>
                <th className="!text-left">显示名</th>
                <th>模型</th>
                <th>启用</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => {
                const tpl = findAI(it.provider);
                return (
                  <tr key={it.id}>
                    <td className="num text-ink-3">{i + 1}</td>
                    <td>{tpl?.name ?? it.provider}</td>
                    <td className="!text-left">{it.display_name}</td>
                    <td className="num text-[12px] text-ink-3">{it.model || '默认'}</td>
                    <td>
                      <input
                        type="checkbox"
                        checked={it.is_enabled === 1}
                        onChange={(e) => toggle(it.id, e.target.checked)}
                      />
                    </td>
                    <td>
                      <div className="flex gap-1 justify-center">
                        <button
                          className="btn btn-ghost !py-0.5 !px-2 text-xs text-accent"
                          onClick={() => setEditing(it)}
                        >
                          <Pencil size={12} /> 编辑
                        </button>
                        <button
                          className="btn btn-ghost !py-0.5 !px-2 text-xs text-danger"
                          onClick={() => del(it.id)}
                        >
                          <Trash2 size={12} /> 删除
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {(creating || editing) && (
        <AIEditModal
          item={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={refresh}
        />
      )}
    </div>
  );
}

function AIEditModal({
  item,
  onClose,
  onSaved,
}: {
  item: AIProvider | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [provider, setProvider] = useState(item?.provider ?? 'deepseek');
  const [displayName, setDisplayName] = useState(item?.display_name ?? '');
  const [baseUrl, setBaseUrl] = useState(item?.base_url ?? '');
  const [apiKey, setApiKey] = useState(item?.api_key ?? '');
  const [model, setModel] = useState(item?.model ?? '');
  const [saving, setSaving] = useState(false);

  const tpl = findAI(provider);

  useEffect(() => {
    if (!item && tpl) {
      setDisplayName(tpl.name);
      setBaseUrl(tpl.baseUrl);
      setModel('');
    }
  }, [provider, item, tpl]);

  async function save() {
    if (!displayName.trim()) {
      alert('请填显示名');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        provider,
        display_name: displayName.trim(),
        base_url: baseUrl.trim() || tpl?.baseUrl || '',
        api_key: apiKey.trim(),
        model: model.trim() || (null as any),
      };
      if (item) {
        await updateAIProvider(item.id, payload);
      } else {
        await createAIProvider(payload);
      }
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 bg-black/30 grid place-items-center px-4" onClick={onClose}>
      <div
        className="w-[520px] max-w-full max-h-[90vh] bg-canvas rounded-xl shadow-lg flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-line flex items-center justify-between">
          <div className="text-lg font-semibold">{item ? '编辑 AI 服务' : '新增 AI 服务'}</div>
          <button className="icon-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="p-6 grid gap-3 overflow-y-auto">
          <label className="grid gap-1">
            <span className="text-[11px] text-ink-3">服务商</span>
            <select
              className="input-lite"
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              disabled={!!item}
            >
              {AI_TEMPLATES.map((t) => (
                <option key={t.provider} value={t.provider}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>

          {tpl && (
            <div className="p-3 rounded-lg bg-paper text-xs text-ink-3">
              <div className="mb-1">{tpl.description}</div>
              <div>{tpl.applyHint}</div>
              {tpl.applyUrl && (
                <div className="mt-1">
                  <button
                    type="button"
                    onClick={() => openExternal(tpl.applyUrl)}
                    className="text-accent inline-flex items-center gap-1 hover:underline"
                  >
                    <ExternalLink size={11} /> 前往申请 API Key →
                  </button>
                </div>
              )}
            </div>
          )}

          <label className="grid gap-1">
            <span className="text-[11px] text-ink-3">显示名</span>
            <input
              className="input-lite"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </label>
          <label className="grid gap-1">
            <span className="text-[11px] text-ink-3">Base URL</span>
            <input
              className="input-lite"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={tpl?.baseUrl || 'https://…/v1'}
            />
          </label>
          <label className="grid gap-1">
            <span className="text-[11px] text-ink-3">
              API Key <span className="text-danger">*</span>
            </span>
            <input
              type="password"
              className="input-lite"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-…"
            />
          </label>
          <label className="grid gap-1">
            <span className="text-[11px] text-ink-3">
              Model（可选，默认 {tpl?.defaultModel || '—'}）
            </span>
            <input
              className="input-lite"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder={tpl?.defaultModel}
            />
          </label>
        </div>
        <div className="px-6 py-4 border-t border-line flex gap-2 justify-end">
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}
