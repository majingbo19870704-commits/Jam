import { useEffect, useMemo, useRef, useState } from 'react';
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
import {
  cell,
  exportReport,
  formatImportSummary,
  optionId,
  readImportRows,
} from '@/lib/report-excel';
import { useTableZoom } from '@/hooks/useTableZoom';
import {
  createRisk,
  listRisks,
  softDeleteRisks,
  updateRisk,
  type ProjectRisk,
} from '@/db/project-risk-dao';
import { listByGroup } from '@/db/param-dao';
import { InlineSelect, InlineText, PriorityChip, StatusChip } from '@/components/inline';
import type { ParamOption } from '@/types';

function rowClassByStatus(s: 'new' | 'following' | 'closed'): string {
  if (s === 'new') return 'row-new';
  if (s === 'following') return 'row-follow';
  return 'row-closed';
}
import { RiskEditModal } from './RiskEditModal';

interface Props {
  projectId: string;
  focusedItemId?: string | null;
}

const DEFAULT_WIDTHS: Record<string, number> = {
  check: 16,
  seq: 56,
  type: 96,
  level: 72,
  risk: 240,
  countermeasure: 220,
  progress: 200,
  status: 88,
  remark: 180,
  ops: 130,
};

export function RiskPanel({ projectId, focusedItemId }: Props) {
  const TABLE_ID = `project_risk.${projectId}.v1`;
  const [items, setItems] = useState<ProjectRisk[]>([]);
  const [types, setTypes] = useState<ParamOption[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [keyword, setKeyword] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [levelFilter, setLevelFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [editing, setEditing] = useState<ProjectRisk | null>(null);
  const [loading, setLoading] = useState(true);

  const [widths, setWidths] = useState<Record<string, number>>(() =>
    loadWidths(TABLE_ID, DEFAULT_WIDTHS),
  );
  const zoomCtl = useTableZoom(TABLE_ID);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const addBtnRef = useRef<HTMLDivElement>(null);

  const typeMap = useMemo(() => {
    const m = new Map<string, string>();
    types.forEach((t) => m.set(t.id, t.name));
    return m;
  }, [types]);

  async function refresh() {
    setLoading(true);
    try {
      const [rs, ts] = await Promise.all([listRisks(projectId), listByGroup('risk_type')]);
      setItems(rs);
      setTypes(ts);
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
    window.setTimeout(() => document.getElementById(`project-risk-${focusedItemId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 40);
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
    let insertAt: Parameters<typeof createRisk>[1] = 'end';
    if (where !== 'end') {
      if (selected.size !== 1) {
        alert('请先勾选一行作为参考位置');
        return;
      }
      const target = items.find((i) => i.id === Array.from(selected)[0]);
      if (!target) return;
      insertAt = where === 'above' ? { beforeSeq: target.seq_no } : { afterSeq: target.seq_no };
    }
    const created = await createRisk(projectId, insertAt);
    await refresh();
    setSelected(new Set([created.id]));
  }

  async function handleDelete(ids: string[]) {
    if (!ids.length) return;
    if (!confirm(`确认删除 ${ids.length} 条？`)) return;
    await softDeleteRisks(ids);
    setSelected(new Set());
    await refresh();
  }
  async function patch(id: string, p: Partial<ProjectRisk>) {
    await updateRisk(id, p);
    await refresh();
  }
  function setColWidth(k: string, w: number) {
    setWidths((p) => ({ ...p, [k]: w }));
  }
  function commitColWidths() {
    saveWidths(TABLE_ID, widths);
  }
  const totalWidth = Object.values(widths).reduce((a, b) => a + b, 0);

  const filtered = items.filter((r) => {
    if (typeFilter && r.type_id !== typeFilter) return false;
    if (levelFilter && r.level !== levelFilter) return false;
    if (statusFilter && r.status !== statusFilter) return false;
    if (keyword.trim()) {
      const kw = keyword.trim().toLowerCase();
      const typeName = r.type_id ? (typeMap.get(r.type_id) ?? '') : '';
      const haystack = [
        typeName,
        r.level,
        r.risk,
        r.countermeasure,
        r.progress_note,
        r.status,
        r.remark,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(kw)) return false;
    }
    return true;
  });

  function resetFilters() {
    setKeyword('');
    setTypeFilter('');
    setLevelFilter('');
    setStatusFilter('');
  }

  async function handleExport(template = false) {
    const ok = await exportReport({
      title: '项目风险',
      fileStem: template ? '项目风险导入模板' : '项目风险报表',
      rows: template ? [] : filtered,
      columns: [
        {
          title: '类型',
          value: (item: ProjectRisk) =>
            item.type_id ? (typeMap.get(item.type_id) ?? item.type_id) : '',
          width: 14,
        },
        {
          title: '等级',
          value: (item: ProjectRisk) => ({ high: '高', mid: '中', low: '低' })[item.level],
          width: 10,
        },
        { title: '风险', value: (item: ProjectRisk) => item.risk, width: 34 },
        { title: '应对措施', value: (item: ProjectRisk) => item.countermeasure, width: 32 },
        { title: '进度', value: (item: ProjectRisk) => item.progress_note, width: 28 },
        {
          title: '状态',
          value: (item: ProjectRisk) => (item.status === 'closed' ? '闭环' : '跟进'),
          width: 10,
        },
        { title: '备注', value: (item: ProjectRisk) => item.remark, width: 28 },
      ],
    });
    if (ok) alert(template ? '已生成导入模板。' : `已导出 ${filtered.length} 条风险。`);
  }

  async function handleImport() {
    try {
      const rows = await readImportRows();
      if (!rows) return;
      let imported = 0;
      const errors: string[] = [];
      await withTransaction(async () => {
      for (const { rowNo, values } of rows) {
        const risk = cell(values, '风险');
        const typeValue = cell(values, '类型');
        const typeId = optionId(typeValue, types);
        const levelText = cell(values, '等级');
        const level =
          (
            { 高: 'high', 中: 'mid', 低: 'low', high: 'high', mid: 'mid', low: 'low' } as Record<
              string,
              ProjectRisk['level']
            >
          )[levelText] ?? (levelText ? undefined : 'mid');
        const statusText = cell(values, '状态');
        const status =
          (
            {
              跟进: 'following',
              闭环: 'closed',
              following: 'following',
              closed: 'closed',
            } as Record<string, ProjectRisk['status']>
          )[statusText] ?? (statusText ? undefined : 'following');
        if (!risk || !level || !status || (typeValue && !typeId)) {
          errors.push(`第 ${rowNo} 行：风险、类型、等级或状态不正确`);
          continue;
        }
        const created = await createRisk(projectId);
        await updateRisk(created.id, {
          type_id: typeId ?? null,
          level,
          risk,
          countermeasure: cell(values, '应对措施') || null,
          progress_note: cell(values, '进度') || null,
          status,
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
          <select
            className="input-lite"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            title="类型筛选"
          >
            <option value="">全部类型</option>
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <select
            className="input-lite"
            value={levelFilter}
            onChange={(e) => setLevelFilter(e.target.value)}
            title="等级筛选"
          >
            <option value="">全部等级</option>
            <option value="high">高</option>
            <option value="mid">中</option>
            <option value="low">低</option>
          </select>
          <select
            className="input-lite"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            title="状态筛选"
          >
            <option value="">全部状态</option>
            <option value="following">跟进</option>
            <option value="closed">闭环</option>
          </select>
          <div className="flex items-center gap-2 flex-1 min-w-[200px] px-3 py-1.5 border border-line-strong rounded bg-canvas">
            <Search size={14} className="text-ink-3" />
            <input
              className="flex-1 outline-none text-sm bg-transparent"
              placeholder="全表搜索  风险、对策、进度、类型、备注…"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
          </div>
          <button className="btn" onClick={resetFilters}>
            <RotateCcw size={12} /> 重置
          </button>
        </div>
      </div>

      {/* 操作栏 + 表格 */}
      <div className="card">
        <div className="px-4 py-3 border-b border-line flex items-center gap-2 flex-wrap">
          <div className="relative" ref={addBtnRef}>
            <button className="btn btn-primary" onClick={() => setAddMenuOpen((v) => !v)}>
              <Plus size={12} strokeWidth={2.5} /> 新增风险
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
            {items.length} 条 · 选中 {selected.size}
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
                      'type',
                      'level',
                      'risk',
                      'countermeasure',
                      'progress',
                      'status',
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
                    <td colSpan={10} className="text-center text-ink-3 py-8">
                      加载中…
                    </td>
                  </tr>
                )}
                {!loading && filtered.length === 0 && (
                  <tr>
                    <td colSpan={10} className="text-center text-ink-3 py-10">
                      暂无风险，点左上「新增风险」创建第一条
                    </td>
                  </tr>
                )}
                {filtered.map((r) => (
                  <tr
                    key={r.id}
                    id={`project-risk-${r.id}`}
                    className={rowClassByStatus(r.status === 'closed' ? 'closed' : 'following')}
                  >
                    <td>
                      <input
                        type="checkbox"
                        checked={selected.has(r.id)}
                        onChange={(e) =>
                          setSelected((s) => {
                            const n = new Set(s);
                            if (e.target.checked) n.add(r.id);
                            else n.delete(r.id);
                            return n;
                          })
                        }
                      />
                    </td>
                    <td className="num text-ink-3">{r.seq_no}</td>
                    <td>
                      <InlineSelect
                        value={r.type_id ?? ''}
                        onChange={(v) => patch(r.id, { type_id: v || null })}
                        options={[
                          { v: '', label: '—' },
                          ...types.map((t) => ({ v: t.id, label: t.name })),
                        ]}
                        render={(v) =>
                          v ? (
                            <span className="chip">{typeMap.get(v) ?? '—'}</span>
                          ) : (
                            <span className="text-ink-4">—</span>
                          )
                        }
                      />
                    </td>
                    <td>
                      <InlineSelect
                        value={r.level}
                        onChange={(v) => patch(r.id, { level: v as ProjectRisk['level'] })}
                        options={[
                          { v: 'high', label: '高' },
                          { v: 'mid', label: '中' },
                          { v: 'low', label: '低' },
                        ]}
                        render={(v) => <PriorityChip p={v as 'high' | 'mid' | 'low'} />}
                      />
                    </td>
                    <td className="!text-left">
                      <InlineText
                        value={r.risk}
                        onChange={(v) => patch(r.id, { risk: v })}
                        placeholder="双击输入..."
                      />
                    </td>
                    <td className="!text-left">
                      <InlineText
                        value={r.countermeasure ?? ''}
                        onChange={(v) => patch(r.id, { countermeasure: v || null })}
                        placeholder="双击输入..."
                      />
                    </td>
                    <td className="!text-left">
                      <InlineText
                        value={r.progress_note ?? ''}
                        onChange={(v) => patch(r.id, { progress_note: v || null })}
                        placeholder="双击输入..."
                      />
                    </td>
                    <td>
                      <InlineSelect
                        value={r.status}
                        onChange={(v) => patch(r.id, { status: v as ProjectRisk['status'] })}
                        options={[
                          { v: 'following', label: '跟进' },
                          { v: 'closed', label: '闭环' },
                        ]}
                        render={(v) => <StatusChip s={v as 'following' | 'closed'} />}
                      />
                    </td>
                    <td className="!text-left">
                      <InlineText
                        value={r.remark ?? ''}
                        onChange={(v) => patch(r.id, { remark: v || null })}
                        placeholder="双击输入..."
                      />
                    </td>
                    <td>
                      <div className="flex gap-1 justify-center">
                        <button
                          className="btn btn-ghost !py-0.5 !px-2 text-xs text-accent"
                          onClick={() => setEditing(r)}
                        >
                          编辑
                        </button>
                        <button
                          className="btn btn-ghost !py-0.5 !px-2 text-xs text-danger"
                          onClick={() => handleDelete([r.id])}
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
        <RiskEditModal
          item={editing}
          types={types}
          onClose={() => setEditing(null)}
          onSaved={refresh}
        />
      )}
    </div>
  );
}

const COL_LABEL: Record<string, string> = {
  seq: '序号',
  type: '类型',
  level: '等级',
  risk: '风险',
  countermeasure: '对策',
  progress: '进度',
  status: '状态',
  remark: '备注',
  ops: '操作',
};
