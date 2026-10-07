import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { updateRisk, type ProjectRisk } from '@/db/project-risk-dao';
import type { ParamOption } from '@/types';

interface Props {
  item: ProjectRisk;
  types: ParamOption[];
  onClose: () => void;
  onSaved: () => void;
}

export function RiskEditModal({ item, types, onClose, onSaved }: Props) {
  const [form, setForm] = useState<ProjectRisk>(item);
  const [saving, setSaving] = useState(false);
  useEffect(() => setForm(item), [item]);

  function patch<K extends keyof ProjectRisk>(k: K, v: ProjectRisk[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function save() {
    setSaving(true);
    try {
      await updateRisk(form.id, {
        type_id: form.type_id, level: form.level, risk: form.risk,
        countermeasure: form.countermeasure, progress_note: form.progress_note,
        status: form.status, remark: form.remark,
      });
      onSaved(); onClose();
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-40 bg-black/30 grid place-items-center px-4" onClick={onClose}>
      <div className="w-[560px] max-w-full max-h-[90vh] bg-canvas rounded-xl shadow-lg flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-line flex items-center justify-between">
          <div className="text-lg font-semibold">编辑风险</div>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="p-6 grid gap-3 overflow-y-auto">
          <div className="grid grid-cols-2 gap-3">
            <F label="类型">
              <select className="input-lite" value={form.type_id ?? ''}
                onChange={(e) => patch('type_id', e.target.value || null)}>
                <option value="">未指定</option>
                {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </F>
            <F label="等级">
              <select className="input-lite" value={form.level}
                onChange={(e) => patch('level', e.target.value as ProjectRisk['level'])}>
                <option value="high">高</option>
                <option value="mid">中</option>
                <option value="low">低</option>
              </select>
            </F>
          </div>
          <F label="风险"><textarea rows={2} className="input-lite resize-none" value={form.risk} onChange={(e) => patch('risk', e.target.value)} /></F>
          <F label="对策"><textarea rows={2} className="input-lite resize-none" value={form.countermeasure ?? ''} onChange={(e) => patch('countermeasure', e.target.value || null)} /></F>
          <F label="进度"><textarea rows={2} className="input-lite resize-none" value={form.progress_note ?? ''} onChange={(e) => patch('progress_note', e.target.value || null)} /></F>
          <F label="状态">
            <select className="input-lite" value={form.status}
              onChange={(e) => patch('status', e.target.value as ProjectRisk['status'])}>
              <option value="following">跟进</option>
              <option value="closed">闭环</option>
            </select>
          </F>
          <F label="备注"><textarea rows={2} className="input-lite resize-none" value={form.remark ?? ''} onChange={(e) => patch('remark', e.target.value || null)} /></F>
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

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1">
      <span className="text-[11px] text-ink-3 font-medium tracking-wide">{label}</span>
      {children}
    </label>
  );
}
