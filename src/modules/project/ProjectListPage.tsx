import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CheckCircle2,
  ChevronDown,
  Clock,
  Download,
  FolderKanban,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  TrendingUp,
  Upload,
  ZoomIn,
} from 'lucide-react';
import { MetricCard } from '@/components/MetricCard';
import { ResizableTh } from '@/components/ResizableTh';
import { listByGroup } from '@/db/param-dao';
import {
  createProject,
  listProjects,
  resequence,
  softDeleteBatch,
  statsThisYear,
  updateProject,
  type ProjectFilter,
} from '@/db/project-dao';
import { loadWidths, saveWidths } from '@/lib/column-widths';
import { withTransaction } from '@/db/client';
import {
  cell,
  exportReport,
  formatImportSummary,
  optionalDate,
  optionId,
  readImportRows,
} from '@/lib/report-excel';
import { useTableZoom } from '@/hooks/useTableZoom';
import type { ParamOption, Project, StatusFull } from '@/types';
import { ProjectEditModal } from './ProjectEditModal';

function fmtToday(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const DEFAULT_WIDTHS: Record<string, number> = {
  check: 16,
  seq: 56,
  date: 96,
  type: 96,
  name: 260,
  progress: 240,
  status: 88,
  ipic: 100,
  epic: 100,
  remark: 200,
  ops: 140,
};
const TABLE_ID = 'project.v3';

export function ProjectListPage() {
  const nav = useNavigate();
  const [items, setItems] = useState<Project[]>([]);
  const [types, setTypes] = useState<ParamOption[]>([]);
  const [stats, setStats] = useState({ total: 0, closed: 0, open: 0, rate: 0 });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showOpenOnly, setShowOpenOnly] = useState(true);
  const [keyword, setKeyword] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Project | null>(null);

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
      const filter: ProjectFilter = {};
      if (dateFrom) filter.dateFrom = dateFrom;
      if (dateTo) filter.dateTo = dateTo;
      if (typeFilter) filter.typeIds = [typeFilter];
      if (statusFilter) filter.statuses = [statusFilter as StatusFull];
      else if (showOpenOnly) filter.statuses = ['new', 'following'];
      if (keyword.trim()) filter.keyword = keyword.trim();

      const [rows, t, s] = await Promise.all([
        listProjects(filter),
        listByGroup('project_type'),
        statsThisYear(),
      ]);
      setItems(rows);
      setTypes(t);
      setStats(s);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  // refresh 仅由筛选条件驱动，避免函数引用变化导致重复请求。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    refresh();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showOpenOnly, typeFilter, statusFilter, dateFrom, dateTo]);

  useEffect(() => {
    if (!addMenuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (!addBtnRef.current?.contains(e.target as Node)) setAddMenuOpen(false);
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [addMenuOpen]);

  async function addAt(where: 'end' | 'above' | 'below') {
    setAddMenuOpen(false);
    let insertAt: Parameters<typeof createProject>[1] = 'end';
    if (where !== 'end') {
      if (selected.size !== 1) {
        alert('请先勾选一行作为参考位置');
        return;
      }
      const targetId = Array.from(selected)[0];
      const target = items.find((i) => i.id === targetId);
      if (!target) return;
      insertAt = where === 'above' ? { beforeSeq: target.seq_no } : { afterSeq: target.seq_no };
    }
    const created = await createProject(
      {
        date: fmtToday(),
        name: '新项目',
        type_id: types[0]?.id ?? null,
      },
      insertAt,
    );
    await resequence();
    await refresh();
    setSelected(new Set([created.id]));
  }

  async function handleBatchDelete() {
    if (selected.size === 0) return;
    if (!confirm(`确认删除选中的 ${selected.size} 个项目？`)) return;
    await softDeleteBatch(Array.from(selected));
    setSelected(new Set());
    await refresh();
  }

  async function patchField(id: string, patch: Partial<Project>) {
    await updateProject(id, patch);
    await refresh();
  }

  function toggleSelect(id: string, checked: boolean) {
    setSelected((s) => {
      const n = new Set(s);
      if (checked) n.add(id);
      else n.delete(id);
      return n;
    });
  }

  function setColWidth(k: string, w: number) {
    setWidths((p) => ({ ...p, [k]: w }));
  }
  function commitColWidths() {
    saveWidths(TABLE_ID, widths);
  }
  const totalWidth = Object.values(widths).reduce((a, b) => a + b, 0);

  function resetFilters() {
    setKeyword('');
    setTypeFilter('');
    setStatusFilter('');
    setDateFrom('');
    setDateTo('');
    setShowOpenOnly(true);
    refresh();
  }

  async function handleExport(template = false) {
    const ok = await exportReport({
      title: '项目清单',
      fileStem: template ? '项目导入模板' : '项目报表',
      rows: template ? [] : items,
      columns: [
        { title: '日期', value: (item: Project) => item.date, width: 12 },
        {
          title: '类型',
          value: (item: Project) =>
            item.type_id ? (typeMap.get(item.type_id) ?? item.type_id) : '',
          width: 14,
        },
        { title: '项目名称', value: (item: Project) => item.name, width: 34 },
        { title: '进度', value: (item: Project) => item.progress_note, width: 30 },
        {
          title: '状态',
          value: (item: Project) =>
            ({ new: '新建', following: '跟进', closed: '闭环' })[item.status],
          width: 10,
        },
        { title: '内部PIC', value: (item: Project) => item.internal_pic, width: 16 },
        { title: '外部PIC', value: (item: Project) => item.external_pic, width: 16 },
        { title: '备注', value: (item: Project) => item.remark, width: 28 },
      ],
    });
    if (ok) alert(template ? '已生成导入模板。' : `已导出 ${items.length} 个项目。`);
  }

  async function handleImport() {
    try {
      const rows = await readImportRows();
      if (!rows) return;
      let imported = 0;
      const errors: string[] = [];
      await withTransaction(async () => {
      for (const { rowNo, values } of rows) {
        const date = optionalDate(cell(values, '日期'));
        const name = cell(values, '项目名称');
        const typeValue = cell(values, '类型');
        const typeId = optionId(typeValue, types);
        const statusText = cell(values, '状态');
        const status =
          (
            {
              新建: 'new',
              跟进: 'following',
              闭环: 'closed',
              new: 'new',
              following: 'following',
              closed: 'closed',
            } as Record<string, StatusFull>
          )[statusText] ?? (statusText ? undefined : 'new');
        if (!date || !name || !status || (typeValue && !typeId)) {
          errors.push(`第 ${rowNo} 行：日期、项目名称、类型或状态不正确`);
          continue;
        }
        const created = await createProject({
          date,
          type_id: typeId ?? null,
          name,
          progress_note: cell(values, '进度') || null,
          internal_pic: cell(values, '内部PIC') || null,
          external_pic: cell(values, '外部PIC') || null,
          remark: cell(values, '备注') || null,
        });
        if (status !== 'new') await updateProject(created.id, { status });
        imported++;
      }
      if (imported) await resequence();
      });
      await refresh();
      alert(formatImportSummary(imported, errors));
    } catch (error) {
      alert(`导入失败：${String(error)}`);
    }
  }

  return (
    <div className="p-6 max-w-[1600px] mx-auto">
      {/* 顶部数据卡 */}
      <div className="grid grid-cols-4 gap-4 mb-5">
        <MetricCard
          color="cyan"
          icon={<FolderKanban size={20} />}
          label="本年度项目"
          value={<span className="num">{stats.total}</span>}
          delta="Year 2026"
        />
        <MetricCard
          color="green"
          icon={<CheckCircle2 size={20} />}
          label="已闭环"
          value={<span className="num">{stats.closed}</span>}
          delta={<span className="num">占比 {stats.rate}%</span>}
          deltaTone="up"
        />
        <MetricCard
          color="amber"
          icon={<Clock size={20} />}
          label="进行中"
          value={<span className="num">{stats.open}</span>}
          delta={stats.open > 0 ? '需要跟进' : '暂无进行中'}
        />
        <MetricCard
          color="pink"
          icon={<TrendingUp size={20} />}
          label="整体完成率"
          value={
            <span className="num">
              {stats.rate}
              <span className="text-lg text-ink-3 font-medium ml-0.5">%</span>
            </span>
          }
          delta="基线 60%"
        />
      </div>

      {/* 搜索栏 */}
      <div className="card mb-4">
        <div className="card-body py-3 flex items-center gap-2 flex-wrap">
          <input
            type="date"
            className="input-lite"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            title="开始日期"
          />
          <span className="text-ink-3">→</span>
          <input
            type="date"
            className="input-lite"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            title="结束日期"
          />
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
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            title="状态筛选"
          >
            <option value="">默认（跟随勾选）</option>
            <option value="new">新建</option>
            <option value="following">跟进</option>
            <option value="closed">闭环</option>
          </select>
          <div className="flex items-center gap-2 flex-1 min-w-[200px] px-3 py-1.5 border border-line-strong rounded bg-canvas">
            <Search size={14} className="text-ink-3" />
            <input
              className="flex-1 outline-none text-sm bg-transparent"
              placeholder="全表搜索  项目名、进度、PIC、备注…"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && refresh()}
            />
          </div>
          <label className="flex items-center gap-1.5 text-sm text-ink-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showOpenOnly}
              onChange={(e) => setShowOpenOnly(e.target.checked)}
            />
            只显示未闭环
          </label>
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
              <Plus size={12} strokeWidth={2.5} /> 新增项目
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
            {items.length} 个 · 选中 {selected.size}
          </span>
          <div className="flex-1" />
          <button
            className="btn"
            onClick={() => void handleExport(true)}
            title="下载与当前报表字段一致的空白模板"
          >
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
            onClick={handleBatchDelete}
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
                      checked={selected.size > 0 && selected.size === items.length}
                      onChange={(e) =>
                        setSelected(e.target.checked ? new Set(items.map((i) => i.id)) : new Set())
                      }
                    />
                  </ResizableTh>
                  {(
                    [
                      'seq',
                      'date',
                      'type',
                      'name',
                      'progress',
                      'status',
                      'ipic',
                      'epic',
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
                    <td colSpan={11} className="text-center text-ink-3 py-8">
                      加载中…
                    </td>
                  </tr>
                )}
                {!loading && items.length === 0 && (
                  <tr>
                    <td colSpan={11} className="text-center text-ink-3 py-10">
                      暂无项目，点左上「新增项目」创建第一个
                    </td>
                  </tr>
                )}
                {items.map((it) => (
                  <ProjectRow
                    key={it.id}
                    item={it}
                    types={types}
                    typeMap={typeMap}
                    selected={selected.has(it.id)}
                    onSelect={(c) => toggleSelect(it.id, c)}
                    onPatch={(p) => patchField(it.id, p)}
                    onView={() => nav(`/project/${it.id}`)}
                    onEdit={() => setEditing(it)}
                    onDelete={async () => {
                      if (!confirm('确认删除此项目？可在回收站找回。')) return;
                      await softDeleteBatch([it.id]);
                      refresh();
                    }}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {editing && (
        <ProjectEditModal
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
  date: '时间',
  type: '类型',
  name: '项目名称',
  progress: '进度',
  status: '状态',
  ipic: '内部PIC',
  epic: '外部PIC',
  remark: '备注',
  ops: '操作',
};

/* ---------------- 行组件 ---------------- */
function ProjectRow({
  item,
  types,
  typeMap,
  selected,
  onSelect,
  onPatch,
  onView,
  onEdit,
  onDelete,
}: {
  item: Project;
  types: ParamOption[];
  typeMap: Map<string, string>;
  selected: boolean;
  onSelect: (c: boolean) => void;
  onPatch: (p: Partial<Project>) => void;
  onView: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <tr className={rowClass(item.status)}>
      <td>
        <input type="checkbox" checked={selected} onChange={(e) => onSelect(e.target.checked)} />
      </td>
      <td className="text-right num text-ink-3">{item.seq_no}</td>
      <td>
        <InlineDate value={item.date} onChange={(v) => onPatch({ date: v })} />
      </td>
      <td>
        <InlineSelect
          value={item.type_id ?? ''}
          onChange={(v) => onPatch({ type_id: v || null })}
          options={[{ v: '', label: '—' }, ...types.map((t) => ({ v: t.id, label: t.name }))]}
          render={(v) =>
            v ? (
              <span className="chip">{typeMap.get(v) ?? '—'}</span>
            ) : (
              <span className="text-ink-4">—</span>
            )
          }
        />
      </td>
      <td className="!text-left">
        <InlineText
          value={item.name}
          onChange={(v) => onPatch({ name: v })}
          placeholder="双击输入..."
        />
      </td>
      <td className="!text-left">
        <InlineText
          value={item.progress_note ?? ''}
          onChange={(v) => onPatch({ progress_note: v || null })}
          placeholder="双击输入..."
        />
      </td>
      <td>
        <InlineSelect
          value={item.status}
          onChange={(v) => onPatch({ status: v as StatusFull })}
          options={[
            { v: 'new', label: '新建' },
            { v: 'following', label: '跟进' },
            { v: 'closed', label: '闭环' },
          ]}
          render={(v) => <StatusChip s={v as StatusFull} />}
        />
      </td>
      <td>
        <InlineText
          value={item.internal_pic ?? ''}
          onChange={(v) => onPatch({ internal_pic: v || null })}
          placeholder="双击输入..."
        />
      </td>
      <td>
        <InlineText
          value={item.external_pic ?? ''}
          onChange={(v) => onPatch({ external_pic: v || null })}
          placeholder="双击输入..."
        />
      </td>
      <td className="!text-left">
        <InlineText
          value={item.remark ?? ''}
          onChange={(v) => onPatch({ remark: v || null })}
          placeholder="双击输入..."
        />
      </td>
      <td>
        <div className="flex gap-1 justify-center">
          <button className="btn btn-ghost !py-0.5 !px-2 text-xs text-accent" onClick={onView}>
            查看
          </button>
          <button className="btn btn-ghost !py-0.5 !px-2 text-xs" onClick={onEdit}>
            编辑
          </button>
          <button className="btn btn-ghost !py-0.5 !px-2 text-xs text-danger" onClick={onDelete}>
            删除
          </button>
        </div>
      </td>
    </tr>
  );
}

function rowClass(s: StatusFull): string {
  if (s === 'new') return 'row-new';
  if (s === 'following') return 'row-follow';
  return 'row-closed';
}
function StatusChip({ s }: { s: StatusFull }) {
  const map = {
    new: ['status-new', '新建'],
    following: ['status-follow', '跟进'],
    closed: ['status-closed', '闭环'],
  } as const;
  const [cls, label] = map[s];
  return <span className={`chip ${cls}`}>{label}</span>;
}

/* ---------------- 行内编辑组件（与工作管理共用逻辑；这里就地复制以便未来独立演进） ---------------- */
function InlineText({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  if (editing) {
    return (
      <textarea
        autoFocus
        rows={1}
        className="w-full px-1.5 py-0.5 border border-accent rounded bg-canvas outline-none text-[12.5px] resize-none"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          setEditing(false);
          if (draft !== value) onChange(draft);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            (e.target as HTMLTextAreaElement).blur();
          }
          if (e.key === 'Escape') {
            setDraft(value);
            setEditing(false);
          }
        }}
      />
    );
  }
  return (
    <div
      onDoubleClick={() => setEditing(true)}
      className={`min-h-[22px] leading-[22px] cursor-text truncate text-[12.5px] ${!value ? 'text-ink-4' : ''}`}
      title={value}
    >
      {value || placeholder}
    </div>
  );
}

function InlineDate({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div
      className="relative w-full h-[22px] cursor-pointer text-center"
      onClick={() => ref.current?.showPicker?.()}
    >
      <span className={`num text-[12.5px] leading-[22px] ${value ? '' : 'text-ink-4'}`}>
        {value || '—'}
      </span>
      <input
        ref={ref}
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="absolute inset-0 opacity-0 cursor-pointer date-noicon"
        tabIndex={-1}
      />
    </div>
  );
}

function InlineSelect<T extends string>({
  value,
  onChange,
  options,
  render,
}: {
  value: T | '';
  onChange: (v: string) => void;
  options: { v: string; label: string }[];
  render: (v: T | '') => React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <select
        autoFocus
        className="w-full px-1 py-0.5 border border-accent rounded bg-canvas outline-none text-[12.5px]"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setEditing(false);
        }}
        onBlur={() => setEditing(false)}
      >
        {options.map((o) => (
          <option key={o.v} value={o.v}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }
  return (
    <div onClick={() => setEditing(true)} className="cursor-pointer min-h-[22px] leading-[22px]">
      {render(value)}
    </div>
  );
}
