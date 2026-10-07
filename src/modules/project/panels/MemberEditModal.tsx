import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { updateMember, type ProjectMember } from '@/db/project-member-dao';

interface Props {
  item: ProjectMember;
  onClose: () => void;
  onSaved: () => void;
}

export function MemberEditModal({ item, onClose, onSaved }: Props) {
  const [form, setForm] = useState<ProjectMember>(item);
  const [saving, setSaving] = useState(false);
  useEffect(() => setForm(item), [item]);

  function patch<K extends keyof ProjectMember>(k: K, v: ProjectMember[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function save() {
    setSaving(true);
    try {
      await updateMember(form.id, {
        company: form.company, department: form.department,
        name: form.name, role: form.role,
        phone: form.phone, remark: form.remark,
      });
      onSaved(); onClose();
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-40 bg-black/30 grid place-items-center px-4" onClick={onClose}>
      <div className="w-[520px] max-w-full max-h-[90vh] bg-canvas rounded-xl shadow-lg flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-line flex items-center justify-between">
          <div className="text-lg font-semibold">编辑成员</div>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="p-6 grid gap-3 overflow-y-auto">
          <div className="grid grid-cols-2 gap-3">
            <F label="公司"><input className="input-lite" value={form.company ?? ''} onChange={(e) => patch('company', e.target.value || null)} /></F>
            <F label="部门"><input className="input-lite" value={form.department ?? ''} onChange={(e) => patch('department', e.target.value || null)} /></F>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <F label="姓名"><input className="input-lite" value={form.name} onChange={(e) => patch('name', e.target.value)} /></F>
            <F label="职责"><input className="input-lite" value={form.role ?? ''} onChange={(e) => patch('role', e.target.value || null)} /></F>
          </div>
          <F label="电话"><input className="input-lite" value={form.phone ?? ''} onChange={(e) => patch('phone', e.target.value || null)} /></F>
          <F label="备注"><textarea rows={3} className="input-lite resize-none" value={form.remark ?? ''} onChange={(e) => patch('remark', e.target.value || null)} /></F>
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
