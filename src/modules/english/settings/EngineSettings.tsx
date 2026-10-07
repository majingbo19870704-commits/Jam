import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, ExternalLink, X } from 'lucide-react';
import { open as openExternal } from '@tauri-apps/plugin-shell';
import {
  listEngineProviders, createEngineProvider, updateEngineProvider, deleteEngineProvider,
  type EngineProvider,
} from '@/db/translator-providers-dao';
import { ENGINE_TEMPLATES, findEngine } from '@/lib/translator-templates';

export function EngineSettings() {
  const [items, setItems] = useState<EngineProvider[]>([]);
  const [editing, setEditing] = useState<EngineProvider | null>(null);
  const [creating, setCreating] = useState(false);

  async function refresh() {
    setItems(await listEngineProviders());
  }
  useEffect(() => { refresh(); }, []);

  async function toggle(id: string, v: boolean) {
    await updateEngineProvider(id, { is_enabled: v ? 1 : 0 });
    await refresh();
  }
  async function del(id: string) {
    if (!confirm('确认删除此引擎？')) return;
    await deleteEngineProvider(id);
    await refresh();
  }

  return (
    <div className="card">
      <div className="card-title">
        <h3>引擎翻译</h3>
        <button className="btn btn-primary !py-1 !px-3 text-xs" onClick={() => setCreating(true)}>
          <Plus size={12} /> 新增引擎
        </button>
      </div>
      <div className="card-body">
        {items.length === 0 && (
          <div className="text-ink-3 text-sm text-center py-6">
            还没有引擎实例，点右上"新增引擎"添加一家
          </div>
        )}
        {items.length > 0 && (
          <table className="table w-full">
            <thead>
              <tr>
                <th className="w-12">#</th>
                <th>类型</th>
                <th className="!text-left">显示名</th>
                <th>启用</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => {
                const tpl = findEngine(it.provider);
                return (
                  <tr key={it.id}>
                    <td className="num text-ink-3">{i + 1}</td>
                    <td>{tpl?.name ?? it.provider}</td>
                    <td className="!text-left">{it.display_name}</td>
                    <td>
                      <input type="checkbox" checked={it.is_enabled === 1}
                        onChange={(e) => toggle(it.id, e.target.checked)} />
                    </td>
                    <td>
                      <div className="flex gap-1 justify-center">
                        <button className="btn btn-ghost !py-0.5 !px-2 text-xs text-accent"
                          onClick={() => setEditing(it)}><Pencil size={12} /> 编辑</button>
                        <button className="btn btn-ghost !py-0.5 !px-2 text-xs text-danger"
                          onClick={() => del(it.id)}><Trash2 size={12} /> 删除</button>
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
        <EngineEditModal
          item={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={refresh}
        />
      )}
    </div>
  );
}

function EngineEditModal({ item, onClose, onSaved }: {
  item: EngineProvider | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [provider, setProvider] = useState(item?.provider ?? 'baidu');
  const [displayName, setDisplayName] = useState(item?.display_name ?? '');
  const [creds, setCreds] = useState<Record<string, string>>(
    item ? safeParse(item.credentials) : {},
  );
  const [saving, setSaving] = useState(false);

  const tpl = findEngine(provider);

  useEffect(() => {
    if (!item && tpl) {
      setDisplayName(tpl.name);
      // 切换类型时清空之前的凭据
      setCreds({});
    }
  }, [provider, item, tpl]);

  async function save() {
    if (!displayName.trim()) { alert('请填显示名'); return; }
    setSaving(true);
    try {
      if (item) {
        await updateEngineProvider(item.id, {
          display_name: displayName.trim(),
          credentials: creds,
        });
      } else {
        await createEngineProvider({ provider, display_name: displayName.trim(), credentials: creds });
      }
      onSaved();
      onClose();
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-40 bg-black/30 grid place-items-center px-4" onClick={onClose}>
      <div className="w-[520px] max-w-full max-h-[90vh] bg-canvas rounded-xl shadow-lg flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-line flex items-center justify-between">
          <div className="text-lg font-semibold">{item ? '编辑引擎' : '新增引擎'}</div>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="p-6 grid gap-3 overflow-y-auto">
          <label className="grid gap-1">
            <span className="text-[11px] text-ink-3">类型</span>
            <select className="input-lite" value={provider}
              onChange={(e) => setProvider(e.target.value)}
              disabled={!!item}>
              {ENGINE_TEMPLATES.map((t) => (
                <option key={t.provider} value={t.provider}>{t.name}</option>
              ))}
            </select>
          </label>

          {tpl && (
            <div className="p-3 rounded-lg bg-paper text-xs text-ink-3">
              <div className="mb-1">{tpl.description}</div>
              <div>额度：{tpl.applyHint}</div>
              {tpl.applyUrl && (
                <div className="mt-1">
                  <button type="button"
                    onClick={() => openExternal(tpl.applyUrl)}
                    className="text-accent inline-flex items-center gap-1 hover:underline">
                    <ExternalLink size={11} /> 前往申请 →
                  </button>
                </div>
              )}
            </div>
          )}

          <label className="grid gap-1">
            <span className="text-[11px] text-ink-3">显示名</span>
            <input className="input-lite" value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="例：百度翻译 - 我的账号" />
          </label>

          {tpl?.fields.map((f) => (
            <label key={f.key} className="grid gap-1">
              <span className="text-[11px] text-ink-3">
                {f.label}{f.required && <span className="text-danger ml-0.5">*</span>}
              </span>
              <input type={f.password ? 'password' : 'text'} className="input-lite"
                placeholder={f.placeholder}
                value={creds[f.key] ?? ''}
                onChange={(e) => setCreds({ ...creds, [f.key]: e.target.value })} />
            </label>
          ))}
        </div>
        <div className="px-6 py-4 border-t border-line flex gap-2 justify-end">
          <button className="btn" onClick={onClose}>取消</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}

function safeParse(s: string | null | undefined): Record<string, string> {
  if (!s) return {};
  try { return JSON.parse(s); } catch { return {}; }
}
