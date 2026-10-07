import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { updateFile, type ProjectFile } from '@/db/project-file-dao';
import type { MaterialFileParameter } from '@/types';

interface Props {
  item: ProjectFile;
  types: MaterialFileParameter[];
  onClose: () => void;
  onSaved: () => void;
}

export function FileEditModal({ item, types, onClose, onSaved }: Props) {
  const [form, setForm] = useState<ProjectFile>(item);
  const [saving, setSaving] = useState(false);
  useEffect(() => setForm(item), [item]);

  function patch<K extends keyof ProjectFile>(k: K, v: ProjectFile[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function save() {
    setSaving(true);
    try {
      await updateFile(form.id, {
        file_parameter_id: form.file_parameter_id, display_name: form.display_name,
        status: form.status, remark: form.remark,
      });
      onSaved(); onClose();
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-40 bg-black/30 grid place-items-center px-4" onClick={onClose}>
      <div className="w-[520px] max-w-full max-h-[90vh] bg-canvas rounded-xl shadow-lg flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-line flex items-center justify-between">
          <div className="text-lg font-semibold">编辑文件</div>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="p-6 grid gap-3 overflow-y-auto">
          <F label="文件类型">
            <select className="input-lite" value={form.file_parameter_id ?? ''}
              onChange={(e) => patch('file_parameter_id', e.target.value || null)}>
              <option value="">未指定</option>
              {types.map((t) => <option key={t.id} value={t.id}>{t.file_type}</option>)}
            </select>
          </F>
          <F label="文件显示名">
            <input className="input-lite" value={form.display_name}
              onChange={(e) => patch('display_name', e.target.value)} />
          </F>
          <F label="路径（只读）">
            <input className="input-lite" value={form.rel_path} readOnly disabled />
          </F>
          <F label="状态">
            <select className="input-lite" value={form.status}
              onChange={(e) => patch('status', e.target.value as 'valid' | 'invalid')}>
              <option value="valid">有效</option>
              <option value="invalid">无效</option>
            </select>
          </F>
          <F label="备注">
            <textarea rows={3} className="input-lite resize-none" value={form.remark ?? ''}
              onChange={(e) => patch('remark', e.target.value || null)} />
          </F>
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
