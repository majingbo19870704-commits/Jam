import { useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  Download,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  Upload,
  ZoomIn,
} from 'lucide-react';
import { ResizableTh } from '@/components/ResizableTh';
import { loadWidths, saveWidths } from '@/lib/column-widths';
import { withTransaction } from '@/db/client';
import { cell, exportReport, formatImportSummary, readImportRows } from '@/lib/report-excel';
import { useTableZoom } from '@/hooks/useTableZoom';
import { InlineText } from '@/components/inline';
import {
  createMember,
  listMembers,
  softDeleteMembers,
  updateMember,
  type ProjectMember,
} from '@/db/project-member-dao';
import { MemberEditModal } from './MemberEditModal';

interface Props {
  projectId: string;
  focusedItemId?: string | null;
}

const DEFAULT_WIDTHS: Record<string, number> = {
  check: 16,
  seq: 56,
  company: 140,
  department: 120,
  name: 120,
  role: 140,
  phone: 120,
  remark: 200,
  ops: 130,
};

export function MemberPanel({ projectId, focusedItemId }: Props) {
  const TABLE_ID = `project_member.${projectId}.v1`;
  const [items, setItems] = useState<ProjectMember[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [keyword, setKeyword] = useState('');
  const [editing, setEditing] = useState<ProjectMember | null>(null);
  const [loading, setLoading] = useState(true);

  const [widths, setWidths] = useState<Record<string, number>>(() =>
    loadWidths(TABLE_ID, DEFAULT_WIDTHS),
  );
  const zoomCtl = useTableZoom(TABLE_ID);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const addBtnRef = useRef<HTMLDivElement>(null);

  async function refresh() {
    setLoading(true);
    try {
      setItems(await listMembers(projectId));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    refresh();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    if (!focusedItemId || loading || !items.some((item) => item.id === focusedItemId)) return;
    setSelected(new Set([focusedItemId]));
    window.setTimeout(() => document.getElementById(`project-member-${focusedItemId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 40);
  }, [focusedItemId, items, loading]);

  useEffect(() => {
    if (!addMenuOpen) return;
    const on = (e: MouseEvent) => {
      if (!addBtnRef.current?.contains(e.target as Node)) setAddMenuOpen(false);
    };
    window.addEventListener('mousedown', on);
    return () => window.removeEventListener('mousedown', on);
  }, [addMenuOpen]);

  async function addAt(where: 'end' | 'above' | 'below') {
    setAddMenuOpen(false);
    let insertAt: Parameters<typeof createMember>[1] = 'end';
    if (where !== 'end') {
      if (selected.size !== 1) {
        alert('请先勾选一行作为参考位置');
        return;
      }
      const target = items.find((i) => i.id === Array.from(selected)[0]);
      if (!target) return;
      insertAt = where === 'above' ? { beforeSeq: target.seq_no } : { afterSeq: target.seq_no };
    }
    const created = await createMember(projectId, insertAt);
    await refresh();
    setSelected(new Set([created.id]));
  }

  async function handleDelete(ids: string[]) {
    if (!ids.length) return;
    if (!confirm(`确认删除 ${ids.length} 条？`)) return;
    await softDeleteMembers(ids);
    setSelected(new Set());
    await refresh();
  }
  async function patch(id: string, p: Partial<ProjectMember>) {
    await updateMember(id, p);
    await refresh();
  }
  function setColWidth(k: string, w: number) {
    setWidths((p) => ({ ...p, [k]: w }));
  }
  function commitColWidths() {
    saveWidths(TABLE_ID, widths);
  }
  const totalWidth = Object.values(widths).reduce((a, b) => a + b, 0);

  const filtered = keyword.trim()
    ? items.filter((m) =>
        [m.company, m.department, m.name, m.role, m.phone, m.remark]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(keyword.trim().toLowerCase()),
      )
    : items;

  async function handleExport(template = false) {
    const ok = await exportReport({
      title: '项目成员',
      fileStem: template ? '项目成员导入模板' : '项目成员报表',
      rows: template ? [] : filtered,
      columns: [
        { title: '公司', value: (item: ProjectMember) => item.company, width: 22 },
        { title: '部门', value: (item: ProjectMember) => item.department, width: 18 },
        { title: '姓名', value: (item: ProjectMember) => item.name, width: 16 },
        { title: '职责', value: (item: ProjectMember) => item.role, width: 22 },
        { title: '电话', value: (item: ProjectMember) => item.phone, width: 18 },
        { title: '备注', value: (item: ProjectMember) => item.remark, width: 28 },
      ],
    });
    if (ok) alert(template ? '已生成导入模板。' : `已导出 ${filtered.length} 名成员。`);
  }

  async function handleImport() {
    try {
      const rows = await readImportRows();
      if (!rows) return;
      let imported = 0;
      const errors: string[] = [];
      await withTransaction(async () => {
      for (const { rowNo, values } of rows) {
        const name = cell(values, '姓名');
        if (!name) {
          errors.push(`第 ${rowNo} 行：姓名不能为空`);
          continue;
        }
        const created = await createMember(projectId);
        await updateMember(created.id, {
          company: cell(values, '公司') || null,
          department: cell(values, '部门') || null,
          name,
          role: cell(values, '职责') || null,
          phone: cell(values, '电话') || null,
          remark: cell(values, '备注') || null,
        });
        imported++;
      }
      });
      await refresh();
      alert(formatImportSummary(imported, errors));
    } catch (error) {
      alert(`导入失败：${String(error)}`);
    }
  }

  return (
    <div className="grid gap-4">
      {/* 搜索栏 */}
      <div className="card">
        <div className="card-body py-3 flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-2 flex-1 min-w-[200px] px-3 py-1.5 border border-line-strong rounded bg-canvas">
            <Search size={14} className="text-ink-3" />
            <input
              className="flex-1 outline-none text-sm bg-transparent"
              placeholder="搜索姓名、公司、部门、职责、电话、备注…"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
          </div>
          <button className="btn" onClick={() => setKeyword('')}>
            <RotateCcw size={12} /> 重置
          </button>
        </div>
      </div>

      {/* 操作栏 + 表格 */}
      <div className="card">
        <div className="px-4 py-3 border-b border-line flex items-center gap-2 flex-wrap">
          <div className="relative" ref={addBtnRef}>
            <button className="btn btn-primary" onClick={() => setAddMenuOpen((v) => !v)}>
              <Plus size={12} strokeWidth={2.5} /> 新增成员
              <ChevronDown size={12} />
            </button>
            {addMenuOpen && (
              <div className="absolute top-full left-0 mt-1 w-44 bg-canvas border border-line rounded-lg shadow-lg py-1 z-20 text-sm">
                <button
                  className="w-full text-left px-3 py-1.5 hover:bg-paper"
                  onClick={() => addAt('end')}
                >
                  在末尾新增
                </button>
                <button
                  className="w-full text-left px-3 py-1.5 hover:bg-paper disabled:opacity-40"
                  disabled={selected.size !== 1}
                  onClick={() => addAt('above')}
                >
                  在选中行上方插入
                </button>
                <button
                  className="w-full text-left px-3 py-1.5 hover:bg-paper disabled:opacity-40"
                  disabled={selected.size !== 1}
                  onClick={() => addAt('below')}
                >
                  在选中行下方插入
                </button>
              </div>
            )}
          </div>
          <span className="text-xs text-ink-3">
            {items.length} 人 · 选中 {selected.size}
          </span>
          <div className="flex-1" />
          <button className="btn" onClick={() => void handleExport(true)}>
            <Download size={12} /> 模板
          </button>
          <button className="btn" onClick={() => void handleImport()}>
            <Upload size={12} /> 导入
          </button>
          <button className="btn" onClick={() => void handleExport()}>
            <Download size={12} /> 导出
          </button>
          <button
            className="btn btn-danger disabled:opacity-40"
            onClick={() => handleDelete(Array.from(selected))}
            disabled={selected.size === 0}
          >
            <Trash2 size={12} /> 删除
          </button>
          <button
            className="btn btn-ghost !px-2"
            title="Ctrl + 滚轮缩放；点此重置为 100%"
            onClick={() => zoomCtl.reset()}
          >
            <ZoomIn size={12} />{' '}
            <span className="num text-xs">{Math.round(zoomCtl.zoom * 100)}%</span>
          </button>
        </div>

        <div className="overflow-x-auto" ref={zoomCtl.bindRef}>
          <div
            style={{
              transform: `scale(${zoomCtl.zoom})`,
              transformOrigin: '0 0',
              width: totalWidth,
              marginBottom: `${(zoomCtl.zoom - 1) * -60}px`,
            }}
          >
            <table className="table" style={{ width: totalWidth, tableLayout: 'fixed' }}>
              <colgroup>
                {Object.entries(widths).map(([k, w]) => (
                  <col key={k} style={{ width: w }} />
                ))}
              </colgroup>
              <thead>
                <tr>
                  <ResizableTh
                    colKey="check"
                    width={widths.check}
                    onWidthChange={(w) => setColWidth('check', w)}
                    onWidthCommit={commitColWidths}
                    align="center"
                  >
                    <input
                      type="checkbox"
                      checked={selected.size > 0 && selected.size === filtered.length}
                      onChange={(e) =>
                        setSelected(
                          e.target.checked ? new Set(filtered.map((i) => i.id)) : new Set(),
                        )
                      }
                    />
                  </ResizableTh>
                  {(
                    [
                      'seq',
                      'company',
                      'department',
                      'name',
                      'role',
                      'phone',
                      'remark',
                      'ops',
                    ] as const
                  ).map((k) => (
                    <ResizableTh
                      key={k}
                      colKey={k}
                      width={widths[k]}
                      onWidthChange={(w) => setColWidth(k, w)}
                      onWidthCommit={commitColWidths}
                      align="center"
                    >
                      {COL_LABEL[k]}
                    </ResizableTh>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={9} className="text-center text-ink-3 py-8">
                      加载中…
                    </td>
                  </tr>
                )}
                {!loading && filtered.length === 0 && (
                  <tr>
                    <td colSpan={9} className="text-center text-ink-3 py-10">
                      暂无成员，点左上「新增成员」创建第一条
                    </td>
                  </tr>
                )}
                {filtered.map((m) => (
                  <tr id={`project-member-${m.id}`} key={m.id}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selected.has(m.id)}
                        onChange={(e) =>
                          setSelected((s) => {
                            const n = new Set(s);
                            if (e.target.checked) n.add(m.id);
                            else n.delete(m.id);
                            return n;
                          })
                        }
                      />
                    </td>
                    <td className="num text-ink-3">{m.seq_no}</td>
                    <td className="!text-left">
                      <InlineText
                        value={m.company ?? ''}
                        onChange={(v) => patch(m.id, { company: v || null })}
                        placeholder="双击输入..."
                      />
                    </td>
                    <td className="!text-left">
                      <InlineText
                        value={m.department ?? ''}
                        onChange={(v) => patch(m.id, { department: v || null })}
                        placeholder="双击输入..."
                      />
                    </td>
                    <td>
                      <InlineText
                        value={m.name}
                        onChange={(v) => patch(m.id, { name: v })}
                        placeholder="双击输入..."
                      />
                    </td>
                    <td className="!text-left">
                      <InlineText
                        value={m.role ?? ''}
                        onChange={(v) => patch(m.id, { role: v || null })}
                        placeholder="双击输入..."
                      />
                    </td>
                    <td>
                      <InlineText
                        value={m.phone ?? ''}
                        onChange={(v) => patch(m.id, { phone: v || null })}
                        placeholder="双击输入..."
                      />
                    </td>
                    <td className="!text-left">
                      <InlineText
                        value={m.remark ?? ''}
                        onChange={(v) => patch(m.id, { remark: v || null })}
                        placeholder="双击输入..."
                      />
                    </td>
                    <td>
                      <div className="flex gap-1 justify-center">
                        <button
                          className="btn btn-ghost !py-0.5 !px-2 text-xs text-accent"
                          onClick={() => setEditing(m)}
                        >
                          编辑
                        </button>
                        <button
                          className="btn btn-ghost !py-0.5 !px-2 text-xs text-danger"
                          onClick={() => handleDelete([m.id])}
                        >
                          删除
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {editing && (
        <MemberEditModal item={editing} onClose={() => setEditing(null)} onSaved={refresh} />
      )}
    </div>
  );
}

const COL_LABEL: Record<string, string> = {
  seq: '序号',
  company: '公司',
  department: '部门',
  name: '姓名',
  role: '职责',
  phone: '电话',
  remark: '备注',
  ops: '操作',
};
