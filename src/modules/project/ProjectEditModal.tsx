import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { updateProject } from '@/db/project-dao';
import type { Project, StatusFull, ParamOption } from '@/types';

interface Props {
  item: Project;
  types: ParamOption[];
  onClose: () => void;
  onSaved: () => void;
}

export function ProjectEditModal({ item, types, onClose, onSaved }: Props) {
  const [form, setForm] = useState<Project>(item);
  const [saving, setSaving] = useState(false);
  useEffect(() => setForm(item), [item]);

  function patch<K extends keyof Project>(k: K, v: Project[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function save() {
    setSaving(true);
    try {
      await updateProject(form.id, {
        date: form.date,
        type_id: form.type_id,
        name: form.name,
        progress_note: form.progress_note,
        status: form.status,
        internal_pic: form.internal_pic,
        external_pic: form.external_pic,
        remark: form.remark,
      });
      onSaved();
      onClose();
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-40 bg-black/30 grid place-items-center px-4" onClick={onClose}>
      <div
        className="w-[560px] max-w-full max-h-[90vh] bg-canvas rounded-xl shadow-lg flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-line flex items-center justify-between">
          <div className="text-lg font-semibold">编辑项目</div>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="p-6 grid gap-3 overflow-y-auto">
          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-1">
              <span className="text-[11px] text-ink-3 font-medium tracking-wide">时间</span>
              <input type="date" className="input-lite" value={form.date}
                onChange={(e) => patch('date', e.target.value)} />
            </label>
            <label className="grid gap-1">
              <span className="text-[11px] text-ink-3 font-medium tracking-wide">类型</span>
              <select className="input-lite" value={form.type_id ?? ''}
                onChange={(e) => patch('type_id', e.target.value || null)}>
                <option value="">未指定</option>
                {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </label>
          </div>

          <label className="grid gap-1">
            <span className="text-[11px] text-ink-3 font-medium tracking-wide">项目名称</span>
            <input className="input-lite" value={form.name}
              onChange={(e) => patch('name', e.target.value)} />
          </label>

          <label className="grid gap-1">
            <span className="text-[11px] text-ink-3 font-medium tracking-wide">进度</span>
            <textarea rows={3} className="input-lite resize-none" value={form.progress_note ?? ''}
              onChange={(e) => patch('progress_note', e.target.value || null)} />
          </label>

          <label className="grid gap-1">
            <span className="text-[11px] text-ink-3 font-medium tracking-wide">状态</span>
            <select className="input-lite" value={form.status}
              onChange={(e) => patch('status', e.target.value as StatusFull)}>
              <option value="new">新建</option>
              <option value="following">跟进</option>
              <option value="closed">闭环</option>
            </select>
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-1">
              <span className="text-[11px] text-ink-3 font-medium tracking-wide">内部 PIC</span>
              <input className="input-lite" value={form.internal_pic ?? ''}
                onChange={(e) => patch('internal_pic', e.target.value || null)} />
            </label>
            <label className="grid gap-1">
              <span className="text-[11px] text-ink-3 font-medium tracking-wide">外部 PIC</span>
              <input className="input-lite" value={form.external_pic ?? ''}
                onChange={(e) => patch('external_pic', e.target.value || null)} />
            </label>
          </div>

          <label className="grid gap-1">
            <span className="text-[11px] text-ink-3 font-medium tracking-wide">备注</span>
            <textarea rows={2} className="input-lite resize-none" value={form.remark ?? ''}
              onChange={(e) => patch('remark', e.target.value || null)} />
          </label>
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
