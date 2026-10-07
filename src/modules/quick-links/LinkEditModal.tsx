import { useEffect, useState } from 'react';
import { X, Link2, FolderOpen } from 'lucide-react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import type { QuickLink, QuickLinkGroup } from '@/db/quick-link-dao';

interface Props {
  initial?: Partial<QuickLink>;
  groups: QuickLinkGroup[];
  onClose: () => void;
  onSave: (v: {
    groupId: string | null;
    kind: 'url' | 'path';
    name: string;
    url_or_path: string;
    remark?: string;
  }) => Promise<void>;
}

export function LinkEditModal({ initial, groups, onClose, onSave }: Props) {
  const [kind, setKind] = useState<'url' | 'path'>(initial?.kind ?? 'url');
  const [name, setName] = useState(initial?.name ?? '');
  const [target, setTarget] = useState(initial?.url_or_path ?? '');
  const [groupId, setGroupId] = useState<string | null>(initial?.group_id ?? null);
  const [remark, setRemark] = useState(initial?.remark ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // 自动从 URL 提取域名作为默认名称
    if (kind === 'url' && target && !name) {
      try {
        const u = new URL(target);
        setName(u.hostname.replace(/^www\./, ''));
      } catch { /* ignore */ }
    }
  }, [target, kind, name]);

  async function pickPath() {
    const p = await openDialog({
      directory: false, multiple: false,
      title: '选择文件或文件夹',
    });
    if (p) {
      const path = typeof p === 'string' ? p : (p as any).path ?? '';
      setTarget(path);
      if (!name) {
        const seg = path.split(/[/\\]/).filter(Boolean);
        setName(seg[seg.length - 1] ?? '');
      }
    }
  }
  async function pickDir() {
    const p = await openDialog({
      directory: true, multiple: false,
      title: '选择文件夹',
    });
    if (p) {
      const path = typeof p === 'string' ? p : (p as any).path ?? '';
      setTarget(path);
      if (!name) {
        const seg = path.split(/[/\\]/).filter(Boolean);
        setName(seg[seg.length - 1] ?? '');
      }
    }
  }

  async function submit() {
    setError(null);
    if (!name.trim()) { setError('名称不能为空'); return; }
    if (!target.trim()) { setError('目标不能为空'); return; }
    if (kind === 'url' && !/^(https?:\/\/|ftp:\/\/)/i.test(target)) {
      setError('URL 必须以 http:// 或 https:// 开头');
      return;
    }
    setSaving(true);
    try {
      await onSave({
        kind, name: name.trim(),
        url_or_path: target.trim(),
        groupId, remark: remark.trim() || undefined,
      });
      onClose();
    } catch (e) { setError(String(e)); }
    finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-40 bg-black/30 grid place-items-center px-4" onClick={onClose}>
      <div className="w-[480px] max-w-full max-h-[90vh] bg-canvas rounded-xl shadow-lg flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-line flex items-center justify-between">
          <div className="text-lg font-semibold">{initial?.id ? '编辑链接' : '新建链接'}</div>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="p-6 grid gap-3 overflow-y-auto">
          {/* 类型切换 */}
          <div className="grid grid-cols-2 gap-2">
            <button
              className={`p-3 rounded-lg border flex items-center gap-2.5 ${kind === 'url' ? 'border-accent bg-accent-tint text-accent' : 'border-line hover:border-line-strong'}`}
              onClick={() => setKind('url')}
            >
              <Link2 size={16} />
              <div className="text-left">
                <div className="text-sm font-semibold">网址</div>
                <div className="text-[11px] text-ink-3">在浏览器打开</div>
              </div>
            </button>
            <button
              className={`p-3 rounded-lg border flex items-center gap-2.5 ${kind === 'path' ? 'border-accent bg-accent-tint text-accent' : 'border-line hover:border-line-strong'}`}
              onClick={() => setKind('path')}
            >
              <FolderOpen size={16} />
              <div className="text-left">
                <div className="text-sm font-semibold">本地路径</div>
                <div className="text-[11px] text-ink-3">在文件管理器打开</div>
              </div>
            </button>
          </div>

          <label className="grid gap-1">
            <span className="text-[11px] text-ink-3 font-medium tracking-wide">名称</span>
            <input className="input-lite" value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例：GitHub / 项目材料文件夹" />
          </label>

          <label className="grid gap-1">
            <span className="text-[11px] text-ink-3 font-medium tracking-wide">
              {kind === 'url' ? '网址（URL）' : '本地路径'}
            </span>
            <div className="flex gap-2">
              <input className="input-lite flex-1" value={target}
                onChange={(e) => setTarget(e.target.value)}
                placeholder={kind === 'url' ? 'https://…' : 'C:\\Users\\… 或 D:\\projects\\…'} />
              {kind === 'path' && (
                <>
                  <button className="btn" onClick={pickPath} type="button">选文件</button>
                  <button className="btn" onClick={pickDir} type="button">选文件夹</button>
                </>
              )}
            </div>
          </label>

          <label className="grid gap-1">
            <span className="text-[11px] text-ink-3 font-medium tracking-wide">分组</span>
            <select className="input-lite" value={groupId ?? ''}
              onChange={(e) => setGroupId(e.target.value || null)}>
              <option value="">未分组</option>
              {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </label>

          <label className="grid gap-1">
            <span className="text-[11px] text-ink-3 font-medium tracking-wide">备注（可选）</span>
            <textarea rows={2} className="input-lite resize-none" value={remark}
              onChange={(e) => setRemark(e.target.value)} />
          </label>

          {error && <div className="text-danger text-xs">{error}</div>}
        </div>

        <div className="px-6 py-4 border-t border-line flex gap-2 justify-end">
          <button className="btn" onClick={onClose}>取消</button>
          <button className="btn btn-primary" onClick={submit} disabled={saving}>
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}
