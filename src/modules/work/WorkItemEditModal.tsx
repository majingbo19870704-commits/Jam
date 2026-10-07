import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { updateWorkItem } from '@/db/work-item-dao';
import type { WorkItem, Priority, ReminderRepeat, StatusFull, ParamOption } from '@/types';

interface Props {
  item: WorkItem;
  types: ParamOption[];
  onClose: () => void;
  onSaved: () => void;
}

/**
 * 工作事项编辑弹窗
 * - 只在"编辑"按钮点击时打开
 * - 顶部无 "工作事项 · #N" 占位
 * - 底部保存 / 取消按钮
 */
export function WorkItemEditModal({ item, types, onClose, onSaved }: Props) {
  const [form, setForm] = useState<WorkItem>(item);
  const [saving, setSaving] = useState(false);
  useEffect(() => setForm(item), [item]);

  function patch<K extends keyof WorkItem>(k: K, v: WorkItem[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function save() {
    setSaving(true);
    try {
      // 完成时间填了 → 自动闭环；反之若手动改状态为非闭环则清空完成时间
      const next: Partial<WorkItem> = { ...form };
      if (form.completed_at && form.status !== 'closed') next.status = 'closed';
      if (!form.completed_at && form.status === 'closed') next.completed_at = null;

      await updateWorkItem(form.id, {
        date: next.date,
        type_id: next.type_id,
        priority: next.priority,
        description: next.description,
        progress_note: next.progress_note,
        planned_at: next.planned_at,
        reminder_at: next.reminder_at,
        reminder_repeat: next.reminder_repeat,
        completed_at: next.completed_at,
        status: next.status,
        internal_pic: next.internal_pic,
        external_pic: next.external_pic,
        remark: next.remark,
      });
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 bg-black/30 grid place-items-center px-4"
      onClick={onClose}
    >
      <div
        className="w-[560px] max-w-full max-h-[90vh] bg-canvas rounded-xl shadow-lg flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-line flex items-center justify-between">
          <div className="text-lg font-semibold">编辑事项</div>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="p-6 grid gap-3 overflow-y-auto">
          <FieldRow>
            <Field label="日期">
              <input type="date" className="input-lite" value={form.date}
                onChange={(e) => patch('date', e.target.value)} />
            </Field>
            <Field label="类型">
              <select className="input-lite" value={form.type_id ?? ''}
                onChange={(e) => patch('type_id', e.target.value || null)}>
                <option value="">未指定</option>
                {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </Field>
          </FieldRow>

          <FieldRow>
            <Field label="优先级">
              <select className="input-lite" value={form.priority}
                onChange={(e) => patch('priority', e.target.value as Priority)}>
                <option value="high">高</option>
                <option value="mid">中</option>
                <option value="low">低</option>
              </select>
            </Field>
            <Field label="状态">
              <select className="input-lite" value={form.status}
                onChange={(e) => patch('status', e.target.value as StatusFull)}>
                <option value="new">新建</option>
                <option value="following">跟进</option>
                <option value="closed">闭环</option>
              </select>
            </Field>
          </FieldRow>

          <Field label="描述">
            <textarea rows={3} className="input-lite resize-none" value={form.description}
              onChange={(e) => patch('description', e.target.value)} />
          </Field>

          <Field label="进度">
            <textarea rows={3} className="input-lite resize-none" value={form.progress_note ?? ''}
              onChange={(e) => patch('progress_note', e.target.value || null)} />
          </Field>

          <FieldRow>
            <Field label="计划时间">
              <input type="date" className="input-lite" value={form.planned_at ?? ''}
                onChange={(e) => patch('planned_at', e.target.value || null)} />
            </Field>
            <Field label="单次提醒">
              <input type="datetime-local" className="input-lite" value={form.reminder_at ?? ''}
                onChange={(e) => patch('reminder_at', e.target.value || null)} />
            </Field>
          </FieldRow>

          <Field label="提醒重复">
            <select className="input-lite" value={form.reminder_repeat ?? 'none'}
              disabled={!form.reminder_at}
              onChange={(e) => patch('reminder_repeat', e.target.value as ReminderRepeat)}>
              <option value="none">不重复</option>
              <option value="daily">每天</option>
              <option value="weekly">每周</option>
              <option value="monthly">每月</option>
            </select>
          </Field>

          <FieldRow>
            <Field label="完成时间">
              <input type="date" className="input-lite" value={form.completed_at ?? ''}
                onChange={(e) => patch('completed_at', e.target.value || null)} />
            </Field>
            <div />
          </FieldRow>

          <FieldRow>
            <Field label="内部 PIC">
              <input className="input-lite" value={form.internal_pic ?? ''}
                onChange={(e) => patch('internal_pic', e.target.value || null)} />
            </Field>
            <Field label="外部 PIC">
              <input className="input-lite" value={form.external_pic ?? ''}
                onChange={(e) => patch('external_pic', e.target.value || null)} />
            </Field>
          </FieldRow>

          <Field label="备注">
            <textarea rows={2} className="input-lite resize-none" value={form.remark ?? ''}
              onChange={(e) => patch('remark', e.target.value || null)} />
          </Field>
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

function FieldRow({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-3">{children}</div>;
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1">
      <span className="text-[11px] text-ink-3 font-medium tracking-wide">{label}</span>
      {children}
    </label>
  );
}
