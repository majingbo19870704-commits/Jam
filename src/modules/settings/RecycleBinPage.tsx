import { useEffect, useState } from 'react';
import { RotateCcw, Trash2, ArrowLeft, Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { emptyAll, listRecycle, purgeRow, restoreRow } from '@/db/recycle-dao';

interface Row {
  table: string;
  source: string;
  id: string;
  summary: string;
  updated_at: string;
}

export function RecycleBinPage() {
  const nav = useNavigate();
  const [items, setItems] = useState<Row[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [keyword, setKeyword] = useState('');
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    try { setItems(await listRecycle()); }
    finally { setLoading(false); }
  }
  useEffect(() => { refresh(); }, []);

  const filtered = keyword.trim()
    ? items.filter((r) => (r.source + r.summary).toLowerCase().includes(keyword.trim().toLowerCase()))
    : items;

  async function handleRestore(rows: Row[]) {
    for (const r of rows) await restoreRow(r.table, r.id);
    setSelected(new Set());
    await refresh();
  }
  async function handlePurge(rows: Row[]) {
    if (!confirm(`确认永久删除 ${rows.length} 条？此操作不可恢复。`)) return;
    for (const r of rows) await purgeRow(r.table, r.id);
    setSelected(new Set());
    await refresh();
  }
  async function handleEmpty() {
    if (!confirm('清空回收站？所有软删除数据将被永久删除，此操作不可恢复。')) return;
    const n = await emptyAll();
    alert(`已永久删除 ${n} 条`);
    await refresh();
  }

  const selectedRows = filtered.filter((r) => selected.has(r.id));

  return (
    <div className="p-6 max-w-[1200px] mx-auto">
      <div className="flex items-center gap-2 text-sm text-ink-3 mb-3">
        <button className="hover:text-accent flex items-center gap-1"
          onClick={() => nav('/settings')}>
          <ArrowLeft size={14} /> 系统设置
        </button>
        <span className="text-ink-4">/</span>
        <span className="text-ink font-medium">回收站</span>
      </div>

      <div className="card">
        <div className="px-4 py-3 border-b border-line flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-2 flex-1 min-w-[240px] max-w-[400px] px-3 py-1.5 border border-line-strong rounded bg-canvas">
            <Search size={14} className="text-ink-3" />
            <input
              className="flex-1 outline-none text-sm bg-transparent"
              placeholder="搜索来源、摘要…"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
          </div>
          <span className="text-xs text-ink-3">{filtered.length} 条 · 选中 {selected.size}</span>
          <div className="flex-1" />
          <button className="btn disabled:opacity-40"
            disabled={selected.size === 0}
            onClick={() => handleRestore(selectedRows)}>
            <RotateCcw size={12} /> 还原
          </button>
          <button className="btn btn-danger disabled:opacity-40"
            disabled={selected.size === 0}
            onClick={() => handlePurge(selectedRows)}>
            <Trash2 size={12} /> 永久删除
          </button>
          <button className="btn btn-danger" onClick={handleEmpty}>
            <Trash2 size={12} /> 清空回收站
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="table w-full">
            <thead>
              <tr>
                <th className="w-9">
                  <input type="checkbox"
                    checked={selected.size > 0 && selected.size === filtered.length}
                    onChange={(e) => setSelected(e.target.checked
                      ? new Set(filtered.map((i) => i.id)) : new Set())} />
                </th>
                <th className="w-32">来源</th>
                <th className="!text-left">摘要</th>
                <th className="w-44">删除时间</th>
                <th className="w-40">操作</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={5} className="text-center text-ink-3 py-8">加载中…</td></tr>}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={5} className="text-center text-ink-3 py-10">
                  {keyword ? '没有匹配的记录' : '回收站是空的 🎉'}
                </td></tr>
              )}
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td>
                    <input type="checkbox" checked={selected.has(r.id)}
                      onChange={(e) => setSelected((s) => {
                        const n = new Set(s);
                        if (e.target.checked) n.add(r.id); else n.delete(r.id);
                        return n;
                      })} />
                  </td>
                  <td><span className="chip">{r.source}</span></td>
                  <td className="!text-left truncate max-w-[500px]" title={r.summary}>{r.summary}</td>
                  <td className="num text-ink-3">{formatRelative(r.updated_at)}</td>
                  <td>
                    <div className="flex gap-1 justify-center">
                      <button className="btn btn-ghost !py-0.5 !px-2 text-xs text-accent"
                        onClick={() => handleRestore([r])}>还原</button>
                      <button className="btn btn-ghost !py-0.5 !px-2 text-xs text-danger"
                        onClick={() => handlePurge([r])}>永久删除</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="px-4 py-2 text-[11.5px] text-ink-4 border-t border-line">
          还原：数据恢复到原模块；永久删除：从数据库彻底移除，不可恢复。
        </div>
      </div>
    </div>
  );
}

function formatRelative(iso: string): string {
  const now = new Date();
  const d = new Date(iso);
  const diff = (now.getTime() - d.getTime()) / 1000;
  if (diff < 60) return '刚刚';
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
