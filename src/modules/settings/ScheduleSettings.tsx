import { Check, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import { addOption, renameOption, softDeleteOption } from '@/db/param-dao';
import { listScheduleTypes, setScheduleTypeColor, type ScheduleType } from '@/db/schedule-type-dao';

export function ScheduleSettings() {
  const [types, setTypes] = useState<ScheduleType[]>([]);
  const [newName, setNewName] = useState('');
  const [editing, setEditing] = useState<Record<string, string>>({});

  const refresh = async () => setTypes(await listScheduleTypes());
  useEffect(() => { void refresh(); }, []);

  const saveName = async (item: ScheduleType) => {
    const value = (editing[item.id] ?? item.name).trim();
    if (value && value !== item.name) await renameOption(item.id, value);
    setEditing((current) => { const next = { ...current }; delete next[item.id]; return next; });
    await refresh();
  };

  return <section className="card">
    <div className="card-title"><div><h3>日程设置</h3><p className="mt-1 text-xs font-normal text-ink-3">维护日程类型与颜色；日历页面会立即使用这里的定义。</p></div></div>
    <div className="card-body space-y-3">
      <div className="flex max-w-md gap-2"><input className="input-lite min-w-0 flex-1" value={newName} onChange={(event) => setNewName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void addOption('schedule_type', newName).then(() => { setNewName(''); return refresh(); }); }} placeholder="新增日程类型，例如：健康" /><button type="button" className="btn btn-primary" disabled={!newName.trim()} onClick={() => void addOption('schedule_type', newName).then(() => { setNewName(''); return refresh(); })}><Plus size={15} />新增</button></div>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {types.map((item) => <div key={item.id} className="flex items-center gap-2 rounded-lg border border-line bg-canvas px-3 py-2"><input aria-label={`${item.name}颜色`} type="color" className="h-7 w-8 cursor-pointer rounded border border-line bg-transparent p-0.5" value={item.color} onChange={(event) => void setScheduleTypeColor(item.id, event.target.value).then(refresh)} />{editing[item.id] !== undefined ? <input autoFocus className="input-lite min-w-0 flex-1 py-1" value={editing[item.id]} onChange={(event) => setEditing((current) => ({ ...current, [item.id]: event.target.value }))} onKeyDown={(event) => { if (event.key === 'Enter') void saveName(item); if (event.key === 'Escape') setEditing((current) => { const next = { ...current }; delete next[item.id]; return next; }); }} /> : <button type="button" className="min-w-0 flex-1 truncate text-left text-sm" onClick={() => setEditing((current) => ({ ...current, [item.id]: item.name }))}>{item.name}</button>}{editing[item.id] !== undefined && <button type="button" className="icon-btn text-accent" aria-label="保存类型名称" onClick={() => void saveName(item)}><Check size={15} /></button>}<button type="button" className="icon-btn text-danger" aria-label={`删除${item.name}`} onClick={() => { if (window.confirm(`删除日程类型“${item.name}”？`)) void softDeleteOption(item.id).then(refresh); }}><Trash2 size={15} /></button></div>)}
      </div>
    </div>
  </section>;
}
