import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Download,
  LocateFixed,
  Plus,
  Search,
  Trash2,
  Upload,
  X,
  ZoomIn,
} from 'lucide-react';
import {
  computeCriticalPath,
  computeHierarchicalSeq,
  assigneeMemberIds,
  createWbs,
  dependencyIds,
  flatOrderedByHierarchy,
  insertWbs,
  listWbs,
  softDeleteWbs,
  updateWbs,
} from '@/db/project-wbs-dao';
import { listMembers, type ProjectMember } from '@/db/project-member-dao';
import { InlineDate, InlineSelect, InlineText, StatusChip } from '@/components/inline';
import { ResizableTh } from '@/components/ResizableTh';
import { loadWidths, saveWidths } from '@/lib/column-widths';
import { withTransaction } from '@/db/client';
import {
  cell,
  exportReport,
  formatImportSummary,
  optionalDate,
  readImportRows,
} from '@/lib/report-excel';
import { useTableZoom } from '@/hooks/useTableZoom';
import type { ProjectWbs } from '@/types';

interface Props {
  projectId: string;
  focusedItemId?: string | null;
}
type Granularity = 'day' | 'week' | 'month';

const DEFAULT_WIDTHS: Record<string, number> = {
  check: 24,
  seq: 72,
  type: 84,
  item: 220,
  progress: 160,
  assignee: 140,
  status: 80,
  ps: 88,
  pe: 88,
  as: 88,
  ae: 88,
  ops: 80,
};

export function ProgressPanel({ projectId, focusedItemId }: Props) {
  const TABLE_ID = `project_wbs.${projectId}.v3`;
  const [items, setItems] = useState<ProjectWbs[]>([]);
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [keyword, setKeyword] = useState('');
  const [granularity, setGranularity] = useState<Granularity>('week');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [widths, setWidths] = useState<Record<string, number>>(() => {
    const saved = loadWidths(TABLE_ID, DEFAULT_WIDTHS);
    return Object.fromEntries(
      Object.keys(DEFAULT_WIDTHS).map((key) => [key, saved[key] ?? DEFAULT_WIDTHS[key]]),
    );
  });
  const zoomCtl = useTableZoom(TABLE_ID);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const addBtnRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);

  async function refresh() {
    const [tasks, projectMembers] = await Promise.all([listWbs(projectId), listMembers(projectId)]);
    setItems(tasks);
    setMembers(projectMembers);
  }
  useEffect(() => {
    refresh();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    if (!focusedItemId || !items.some((item) => item.id === focusedItemId)) return;
    setCollapsed(new Set());
    setSelected(new Set([focusedItemId]));
    window.setTimeout(() => document.getElementById(`project-wbs-${focusedItemId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 40);
  }, [focusedItemId, items]);

  useEffect(() => {
    if (!addMenuOpen) return;
    const on = (e: MouseEvent) => {
      if (!addBtnRef.current?.contains(e.target as Node)) setAddMenuOpen(false);
    };
    window.addEventListener('mousedown', on);
    return () => window.removeEventListener('mousedown', on);
  }, [addMenuOpen]);

  async function addAtGlobal(mode: 'sibling-above' | 'sibling-below' | 'child-below') {
    setAddMenuOpen(false);
    if (selected.size !== 1) {
      // 没选中：等于末尾追加顶级任务
      const created = await createWbs(projectId);
      await refresh();
      setSelected(new Set([created.id]));
      return;
    }
    const refId = Array.from(selected)[0];
    const created = await insertWbs({ projectId, refId, mode });
    await refresh();
    setSelected(new Set([created.id]));
  }

  async function addAtRow(
    row: ProjectWbs,
    mode: 'sibling-above' | 'sibling-below' | 'child-below',
  ) {
    const created = await insertWbs({ projectId, refId: row.id, mode });
    await refresh();
    setSelected(new Set([created.id]));
  }

  async function handleDelete(id: string) {
    if (!confirm('确认删除此任务？（含其所有子任务）')) return;
    await softDeleteWbs([id]);
    setSelected((s) => {
      const n = new Set(s);
      n.delete(id);
      return n;
    });
    await refresh();
  }
  async function handleBatchDelete() {
    if (selected.size === 0) return;
    if (!confirm(`确认删除选中的 ${selected.size} 条（含子任务）？`)) return;
    await softDeleteWbs(Array.from(selected));
    setSelected(new Set());
    await refresh();
  }

  async function patch(id: string, p: Partial<ProjectWbs>) {
    const next = { ...p };
    if ('actual_end' in p && p.actual_end) next.status = 'closed';
    if ('status' in p && p.status !== 'closed') next.actual_end = null;
    await updateWbs(id, next);
    await refresh();
  }

  const seqMap = useMemo(() => computeHierarchicalSeq(items), [items]);
  const ordered = useMemo(() => flatOrderedByHierarchy(items), [items]);
  const criticalPath = useMemo(() => computeCriticalPath(items), [items]);

  const memberById = useMemo(() => new Map(members.map((member) => [member.id, member])), [members]);
  const memberIdByName = useMemo(
    () => new Map(members.filter((member) => member.name.trim()).map((member) => [member.name.trim(), member.id])),
    [members],
  );
  function assigneeDisplay(row: ProjectWbs) {
    return assigneeMemberIds(row).map((id) => memberById.get(id)?.name ?? '已移除成员').join(', ');
  }
  async function patchAssignees(row: ProjectWbs, input: string) {
    const names = Array.from(new Set(input.split(/[，,]+/).map((value) => value.trim()).filter(Boolean)));
    const unknown = names.filter((name) => !memberIdByName.has(name));
    if (unknown.length) {
      alert(`未找到项目成员：${unknown.join('、')}。请先在“项目成员”中添加，再填写姓名。`);
      return;
    }
    await patch(row.id, { assignee_member_ids: JSON.stringify(names.map((name) => memberIdByName.get(name)!)) });
  }
  const collapsedDescendants = useMemo(() => {
    // 收集所有折叠父任务下所有后代的 id
    const s = new Set<string>();
    const byParent = new Map<string | null, ProjectWbs[]>();
    items.forEach((w) => {
      const key = w.parent_id ?? null;
      const arr = byParent.get(key) ?? [];
      arr.push(w);
      byParent.set(key, arr);
    });
    function collectDesc(id: string, into: Set<string>) {
      (byParent.get(id) ?? []).forEach((c) => {
        into.add(c.id);
        collectDesc(c.id, into);
      });
    }
    collapsed.forEach((id) => collectDesc(id, s));
    return s;
  }, [items, collapsed]);

  const visible = ordered.filter((w) => {
    if (collapsedDescendants.has(w.id)) return false;
    if (keyword.trim()) {
      const kw = keyword.trim().toLowerCase();
      const hs = [w.type, w.item, w.progress_note].filter(Boolean).join(' ').toLowerCase();
      if (!hs.includes(kw)) return false;
    }
    return true;
  });

  function setColWidth(k: string, w: number) {
    setWidths((p) => ({ ...p, [k]: w }));
  }
  function commitColWidths() {
    saveWidths(TABLE_ID, widths);
  }
  const totalTableWidth = Object.values(widths).reduce((a, b) => a + b, 0);

  const range = useMemo(() => computeRange(items, granularity), [items, granularity]);

  function scrollToToday() {
    if (!range || !rightRef.current) return;
    const dp = dayPxOf(range, granularity);
    const off = daysBetween(range.start, new Date()) * dp;
    rightRef.current.scrollTo({ left: Math.max(0, off - 240), behavior: 'smooth' });
  }

  async function handleExport(template = false) {
    const ok = await exportReport({
      title: '项目进度',
      fileStem: template ? '项目进度导入模板' : '项目进度报表',
      rows: template ? [] : ordered,
      columns: [
        {
          title: '层级',
          value: (item: ProjectWbs) => seqMap.get(item.id) ?? String(item.seq_no),
          width: 12,
        },
        { title: '类型', value: (item: ProjectWbs) => item.type, width: 14 },
        { title: '事项', value: (item: ProjectWbs) => item.item, width: 34 },
        { title: '进度', value: (item: ProjectWbs) => item.progress_note, width: 28 },
        { title: '负责人', value: (item: ProjectWbs) => assigneeDisplay(item), width: 20 },
        {
          title: '前置任务',
          value: (item: ProjectWbs) => dependencyIds(item).map((id) => seqMap.get(id) ?? '已删除任务').join(', '),
          width: 18,
        },
        {
          title: '状态',
          value: (item: ProjectWbs) => (item.status === 'closed' ? '闭环' : '跟进'),
          width: 10,
        },
        { title: '计划开始', value: (item: ProjectWbs) => item.planned_start, width: 14 },
        { title: '计划结束', value: (item: ProjectWbs) => item.planned_end, width: 14 },
        { title: '实际开始', value: (item: ProjectWbs) => item.actual_start, width: 14 },
        { title: '实际结束', value: (item: ProjectWbs) => item.actual_end, width: 14 },
      ],
    });
    if (ok)
      alert(
        template
          ? '已生成导入模板。层级示例：1、1-1、1-2、2；前置任务填写对应层级编号，以英文逗号分隔。'
          : `已导出 ${ordered.length} 条任务。`,
      );
  }

  async function handleImport() {
    try {
      const rows = await readImportRows();
      if (!rows) return;
      const errors: string[] = [];
      let imported = 0;
      const prepared = rows.map(({ rowNo, values }, index) => ({
        rowNo,
        values,
        index,
        hierarchy: cell(values, '层级'),
        dependencyRefs: cell(values, '前置任务')
          .split(/[，,\s]+/)
          .map((value) => value.trim())
          .filter(Boolean),
        assigneeNames: Array.from(new Set(cell(values, '负责人').split(/[，,]+/).map((value) => value.trim()).filter(Boolean))),
      }));
      const known = new Set<string>();
      const rowByHierarchy = new Map<string, (typeof prepared)[number]>();
      for (const row of prepared) {
        if (!/^\d+(?:-\d+)*$/.test(row.hierarchy) || !cell(row.values, '事项'))
          errors.push(`第 ${row.rowNo} 行：层级必须形如 1 或 1-1，且事项不能为空`);
        else if (known.has(row.hierarchy)) errors.push(`第 ${row.rowNo} 行：层级重复`);
        else {
          known.add(row.hierarchy);
          rowByHierarchy.set(row.hierarchy, row);
        }
      }
      const invalidRows = new Set(
        errors.map((message) => Number(message.match(/第 (\d+) 行/)?.[1])),
      );
      const statusByRow = new Map<number, ProjectWbs['status']>();
      const datesByRow = new Map<number, (string | null)[]>();
      for (const row of prepared) {
        if (invalidRows.has(row.rowNo)) continue;
        const dates = ['计划开始', '计划结束', '实际开始', '实际结束'].map((key) =>
          optionalDate(cell(row.values, key)),
        );
        if (
          ['计划开始', '计划结束', '实际开始', '实际结束'].some(
            (key, index) => cell(row.values, key) && !dates[index],
          )
        ) {
          errors.push(`第 ${row.rowNo} 行：日期格式不正确`);
          invalidRows.add(row.rowNo);
          continue;
        }
        const statusText = cell(row.values, '状态');
        const status =
          (
            {
              跟进: 'following',
              闭环: 'closed',
              following: 'following',
              closed: 'closed',
            } as Record<string, ProjectWbs['status']>
          )[statusText] ?? (statusText ? undefined : 'following');
        if (!status) {
          errors.push(`第 ${row.rowNo} 行：状态不正确`);
          invalidRows.add(row.rowNo);
          continue;
        }
        const unknownAssignee = row.assigneeNames.find((name) => !memberIdByName.has(name));
        if (unknownAssignee) {
          errors.push(`第 ${row.rowNo} 行：负责人「${unknownAssignee}」不在当前项目成员中`);
          invalidRows.add(row.rowNo);
          continue;
        }
        datesByRow.set(row.rowNo, dates);
        statusByRow.set(row.rowNo, status);
      }
      // 父级与前置任务均须指向本次导入的有效层级，避免半成品数据。
      let changed = true;
      while (changed) {
        changed = false;
        for (const row of prepared) {
          if (invalidRows.has(row.rowNo)) continue;
          const parentKey = row.hierarchy.includes('-')
            ? row.hierarchy.slice(0, row.hierarchy.lastIndexOf('-'))
            : null;
          const parent = parentKey ? rowByHierarchy.get(parentKey) : undefined;
          const missingParent = parentKey && (!parent || invalidRows.has(parent.rowNo));
          const badDependency = row.dependencyRefs.find((ref) => {
            const dependency = rowByHierarchy.get(ref);
            return ref === row.hierarchy || !dependency || invalidRows.has(dependency.rowNo);
          });
          if (missingParent || badDependency) {
            errors.push(
              missingParent
                ? `第 ${row.rowNo} 行：找不到有效父级「${parentKey}」`
                : `第 ${row.rowNo} 行：前置任务「${badDependency}」不存在、无效或引用自身`,
            );
            invalidRows.add(row.rowNo);
            changed = true;
          }
        }
      }
      // 对有效导入行先以层级编号建立有向图，阻断循环依赖。
      const dependencyGraph = new Map(
        prepared
          .filter((row) => !invalidRows.has(row.rowNo))
          .map((row) => [row.hierarchy, row.dependencyRefs]),
      );
      const visiting = new Set<string>();
      const visited = new Set<string>();
      const cyclic = new Set<string>();
      const findCycles = (key: string, path: string[]) => {
        if (visiting.has(key)) {
          path.slice(path.indexOf(key)).forEach((node) => cyclic.add(node));
          return;
        }
        if (visited.has(key)) return;
        visiting.add(key);
        (dependencyGraph.get(key) ?? []).forEach((dependency) => findCycles(dependency, [...path, key]));
        visiting.delete(key);
        visited.add(key);
      };
      dependencyGraph.forEach((_, key) => findCycles(key, []));
      cyclic.forEach((hierarchy) => {
        const row = rowByHierarchy.get(hierarchy);
        if (row && !invalidRows.has(row.rowNo)) {
          errors.push(`第 ${row.rowNo} 行：前置任务形成循环依赖`);
          invalidRows.add(row.rowNo);
        }
      });
      // 循环行被剔除后，继续剔除引用它们的后续任务或子任务。
      changed = true;
      while (changed) {
        changed = false;
        for (const row of prepared) {
          if (invalidRows.has(row.rowNo)) continue;
          const parentKey = row.hierarchy.includes('-')
            ? row.hierarchy.slice(0, row.hierarchy.lastIndexOf('-'))
            : null;
          const parent = parentKey ? rowByHierarchy.get(parentKey) : undefined;
          const brokenRef = row.dependencyRefs.find((ref) =>
            invalidRows.has(rowByHierarchy.get(ref)?.rowNo ?? -1),
          );
          if ((parentKey && (!parent || invalidRows.has(parent.rowNo))) || brokenRef) {
            errors.push(
              brokenRef
                ? `第 ${row.rowNo} 行：前置任务「${brokenRef}」无效，未导入该行`
                : `第 ${row.rowNo} 行：父级「${parentKey}」无效，未导入该行`,
            );
            invalidRows.add(row.rowNo);
            changed = true;
          }
        }
      }
      const createdIds = new Map<string, string>();
      const validRows = prepared
        .filter((row) => !invalidRows.has(row.rowNo))
        .sort(
          (a, b) =>
            a.hierarchy.split('-').length - b.hierarchy.split('-').length || a.index - b.index,
        );
      await withTransaction(async () => {
      for (const row of validRows) {
        const parentKey = row.hierarchy.includes('-')
          ? row.hierarchy.slice(0, row.hierarchy.lastIndexOf('-'))
          : null;
        const parentId = parentKey ? createdIds.get(parentKey) : undefined;
        if (parentKey && !parentId) {
          errors.push(`第 ${row.rowNo} 行：找不到父级「${parentKey}」`);
          continue;
        }
        const created = parentId
          ? await insertWbs({ projectId, refId: parentId, mode: 'child-below' })
          : await createWbs(projectId);
        const dates = datesByRow.get(row.rowNo)!;
        const status = statusByRow.get(row.rowNo)!;
        await updateWbs(created.id, {
          type: cell(row.values, '类型') || null,
          item: cell(row.values, '事项'),
          progress_note: cell(row.values, '进度') || null,
          status,
          planned_start: dates[0],
          planned_end: dates[1],
          actual_start: dates[2],
          actual_end: dates[3],
          assignee_member_ids: JSON.stringify(row.assigneeNames.map((name) => memberIdByName.get(name)!)),
        });
        createdIds.set(row.hierarchy, created.id);
        imported++;
      }
      for (const row of validRows) {
        const id = createdIds.get(row.hierarchy);
        if (!id) continue;
        await updateWbs(id, {
          depends_on: JSON.stringify(row.dependencyRefs.map((ref) => createdIds.get(ref)!)),
        });
      }
      });
      await refresh();
      alert(formatImportSummary(imported, errors));
    } catch (error) {
      alert(`导入失败：${String(error)}`);
    }
  }

  return (
    <div className="card overflow-hidden">
      {/* 顶部工具条 */}
      <div className="px-4 py-3 border-b border-line flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-1 min-w-[220px] max-w-[360px] px-3 py-1.5 border border-line-strong rounded bg-canvas">
          <Search size={14} className="text-ink-3" />
          <input
            className="flex-1 outline-none text-sm bg-transparent"
            placeholder="搜索任务、类型、进度…"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
        </div>

        <div className="relative" ref={addBtnRef}>
          <button className="btn btn-primary" onClick={() => setAddMenuOpen((v) => !v)}>
            <Plus size={12} strokeWidth={2.5} /> 新增
            <ChevronDown size={12} />
          </button>
          {addMenuOpen && (
            <div className="absolute top-full left-0 mt-1 w-52 bg-canvas border border-line rounded-lg shadow-lg py-1 z-20 text-sm">
              <button
                className="w-full text-left px-3 py-1.5 hover:bg-paper"
                onClick={() => addAtGlobal('sibling-below')}
                disabled={false}
              >
                {selected.size === 1 ? '在选中行下方（同级）' : '在末尾追加（顶级）'}
              </button>
              <button
                className="w-full text-left px-3 py-1.5 hover:bg-paper disabled:opacity-40"
                disabled={selected.size !== 1}
                onClick={() => addAtGlobal('sibling-above')}
              >
                在选中行上方（同级）
              </button>
              <button
                className="w-full text-left px-3 py-1.5 hover:bg-paper disabled:opacity-40"
                disabled={selected.size !== 1}
                onClick={() => addAtGlobal('child-below')}
              >
                在选中行下新增子级
              </button>
            </div>
          )}
        </div>

        <button
          className="btn btn-danger disabled:opacity-40"
          onClick={handleBatchDelete}
          disabled={selected.size === 0}
        >
          <Trash2 size={12} /> 删除
        </button>
        <span className="text-xs text-ink-3">
          {items.length} 条 · 选中 {selected.size}
        </span>
        <span className={`text-xs ${criticalPath.hasCycle ? 'text-danger' : 'text-ink-3'}`}>
          {criticalPath.hasCycle
            ? '依赖存在循环，无法计算关键路径'
            : criticalPath.totalDays > 0
              ? `关键路径 ${criticalPath.criticalIds.size} 项 · ${criticalPath.totalDays} 天`
              : '尚无任务'}
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

        <div className="flex items-center rounded border border-line-strong overflow-hidden">
          {(['day', 'week', 'month'] as const).map((g) => (
            <button
              key={g}
              onClick={() => setGranularity(g)}
              className={`px-3 py-1 text-xs ${granularity === g ? 'bg-accent text-white' : 'bg-canvas text-ink hover:bg-paper'}`}
            >
              {g === 'day' ? '日' : g === 'week' ? '周' : '月'}
            </button>
          ))}
        </div>
        <button className="btn" onClick={scrollToToday}>
          <LocateFixed size={12} /> 跳到今天
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

      {members.length > 0 && <ResourceLoad items={items} members={members} />}

      {/* 主区：左表 + 右甘特（整体可缩放） */}
      <div ref={zoomCtl.bindRef} className="overflow-hidden">
        <div
          style={{
            transform: `scale(${zoomCtl.zoom})`,
            transformOrigin: '0 0',
            width: `${100 / zoomCtl.zoom}%`,
            marginBottom: `${(zoomCtl.zoom - 1) * -60}px`,
          }}
        >
          <div className="grid" style={{ gridTemplateColumns: `${totalTableWidth}px 1fr` }}>
            {/* 左表 */}
            <div className="border-r border-line overflow-x-auto">
              <table className="table" style={{ width: totalTableWidth, tableLayout: 'fixed' }}>
                <colgroup>
                  {Object.entries(widths).map(([k, w]) => (
                    <col key={k} style={{ width: w }} />
                  ))}
                </colgroup>
                <thead>
                  {/* 与右侧甘特表头共 3 行等高：这里只用 1 行，但把 h 设为 60px 匹配（月+周+一空行） */}
                  <tr style={{ height: 66 }}>
                    <ResizableTh
                      colKey="check"
                      width={widths.check}
                      onWidthChange={(w) => setColWidth('check', w)}
                      onWidthCommit={commitColWidths}
                      align="center"
                    >
                      <input
                        type="checkbox"
                        checked={selected.size > 0 && selected.size === visible.length}
                        onChange={(e) =>
                          setSelected(
                            e.target.checked ? new Set(visible.map((i) => i.id)) : new Set(),
                          )
                        }
                      />
                    </ResizableTh>
                    {(
                      [
                        'seq',
                        'type',
                        'item',
                        'progress',
                        'assignee',
                        'status',
                        'ps',
                        'pe',
                        'as',
                        'ae',
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
                  {visible.length === 0 && (
                    <tr>
                      <td colSpan={12} className="text-center text-ink-3 py-10">
                        暂无任务，点上方「新增」创建第一条
                      </td>
                    </tr>
                  )}
                  {visible.map((w) => {
                    const seq = seqMap.get(w.id) ?? String(w.seq_no);
                    const hasChildren = items.some((c) => c.parent_id === w.id);
                    const isFolded = collapsed.has(w.id);
                    const indent = ((w.level ?? 1) - 1) * 12;
                    return (
                      <tr
                        id={`project-wbs-${w.id}`}
                        key={w.id}
                        className={`${rowBgByStatus(w)} ${criticalPath.criticalIds.has(w.id) ? 'bg-c-red-bg/35' : ''} h-10`}
                      >
                        <td>
                          <input
                            type="checkbox"
                            checked={selected.has(w.id)}
                            onChange={(e) =>
                              setSelected((s) => {
                                const n = new Set(s);
                                if (e.target.checked) n.add(w.id);
                                else n.delete(w.id);
                                return n;
                              })
                            }
                          />
                        </td>
                        <td className="num text-ink-3">
                          <div
                            className="flex items-center justify-center gap-1"
                            style={{ paddingLeft: indent }}
                          >
                            {hasChildren ? (
                              <button
                                className="text-ink-3 hover:text-ink shrink-0"
                                onClick={() =>
                                  setCollapsed((s) => {
                                    const n = new Set(s);
                                    if (n.has(w.id)) n.delete(w.id);
                                    else n.add(w.id);
                                    return n;
                                  })
                                }
                              >
                                {isFolded ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                              </button>
                            ) : (
                              <span className="w-3 inline-block" />
                            )}
                            <span className="font-medium">{seq}</span>
                          </div>
                        </td>
                        <td>
                          <InlineText
                            value={w.type ?? ''}
                            onChange={(v) => patch(w.id, { type: v || null })}
                            placeholder="双击输入..."
                          />
                        </td>
                        <td className="!text-left">
                          <InlineText
                            value={w.item}
                            onChange={(v) => patch(w.id, { item: v })}
                            placeholder="双击输入..."
                          />
                        </td>
                        <td className="!text-left">
                          <InlineText
                            value={w.progress_note ?? ''}
                            onChange={(v) => patch(w.id, { progress_note: v || null })}
                            placeholder="双击输入..."
                          />
                        </td>
                        <td className="!text-left">
                          <InlineText
                            key={w.assignee_member_ids ?? '[]'}
                            value={assigneeDisplay(w)}
                            onChange={(value) => void patchAssignees(w, value)}
                            placeholder="成员姓名，逗号分隔"
                          />
                        </td>
                        <td>
                          <InlineSelect
                            value={w.status}
                            onChange={(v) => patch(w.id, { status: v as ProjectWbs['status'] })}
                            options={[
                              { v: 'following', label: '跟进' },
                              { v: 'closed', label: '闭环' },
                            ]}
                            render={(v) => <StatusChip s={v as 'following' | 'closed'} />}
                          />
                        </td>
                        <td>
                          <InlineDate
                            value={w.planned_start ?? ''}
                            onChange={(v) => patch(w.id, { planned_start: v || null })}
                            display="md"
                          />
                        </td>
                        <td>
                          <InlineDate
                            value={w.planned_end ?? ''}
                            onChange={(v) => patch(w.id, { planned_end: v || null })}
                            display="md"
                          />
                        </td>
                        <td>
                          <InlineDate
                            value={w.actual_start ?? ''}
                            onChange={(v) => patch(w.id, { actual_start: v || null })}
                            display="md"
                          />
                        </td>
                        <td>
                          <InlineDate
                            value={w.actual_end ?? ''}
                            onChange={(v) => patch(w.id, { actual_end: v || null })}
                            display="md"
                          />
                        </td>
                        <td>
                          <div className="flex gap-0.5 justify-center">
                            <RowAddMenu row={w} onAdd={addAtRow} />
                            <button
                              className="icon-btn !w-6 !h-6 text-danger"
                              title="删除"
                              onClick={() => handleDelete(w.id)}
                            >
                              <X size={12} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* 右甘特 */}
            <div className="overflow-x-auto" ref={rightRef}>
              {range ? (
                <Gantt range={range} items={visible} granularity={granularity} />
              ) : (
                <div className="p-10 text-center text-ink-3">
                  暂无时间数据，请为任务填写"计划开始 / 结束、实际开始 / 结束"日期后查看甘特图。
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 底部图例 */}
      <div className="px-4 py-2.5 border-t border-line flex items-center gap-6 text-[11.5px] text-ink-3">
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block w-6 h-2 rounded-sm"
            style={{ background: 'linear-gradient(90deg,#F59E0B,#FBBF24)' }}
          />{' '}
          计划
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block w-6 h-2 rounded-sm"
            style={{ background: 'linear-gradient(90deg,#10B981,#34D9A5)' }}
          />{' '}
          实际
        </span>
        <span className="ml-auto">
          今天 = <span className="num">{fmtToday()}</span>{' '}
          <span className="text-danger">红色标注</span>
        </span>
      </div>
    </div>
  );
}

function ResourceLoad({ items, members }: { items: ProjectWbs[]; members: ProjectMember[] }) {
  const active = items.filter((item) => item.status !== 'closed');
  const loads = members.map((member) => {
    const assigned = active.filter((item) => assigneeMemberIds(item).includes(member.id));
    return {
      member,
      taskCount: assigned.length,
      plannedDays: assigned.reduce((total, item) => total + plannedDays(item), 0),
    };
  });
  const unassigned = active.filter((item) => assigneeMemberIds(item).length === 0).length;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-paper px-4 py-2.5 text-xs text-ink-3">
      <span className="font-medium text-ink-2">资源负载</span>
      {loads.map(({ member, taskCount, plannedDays }) => (
        <span key={member.id} className={taskCount ? 'text-ink-2' : 'text-ink-4'} title={`${member.name}：${taskCount} 项进行中任务，计划工期合计 ${plannedDays} 天`}>
          {member.name} <span className="num">{taskCount}</span> 项 / <span className="num">{plannedDays}</span> 天
        </span>
      ))}
      {unassigned > 0 && <span className="text-warn">未分配 {unassigned} 项</span>}
    </div>
  );
}

/* -------- 行操作：新增下拉 -------- */
function RowAddMenu({
  row,
  onAdd,
}: {
  row: ProjectWbs;
  onAdd: (row: ProjectWbs, mode: 'sibling-above' | 'sibling-below' | 'child-below') => void;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const on = (e: MouseEvent) => {
      if (!btnRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', on);
    return () => window.removeEventListener('mousedown', on);
  }, [open]);
  return (
    <div className="relative" ref={btnRef}>
      <button
        className="icon-btn !w-6 !h-6 text-accent"
        title="新增"
        onClick={() => setOpen((v) => !v)}
      >
        <Plus size={12} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-40 bg-canvas border border-line rounded-lg shadow-lg py-1 z-30 text-xs">
          <button
            className="w-full text-left px-2.5 py-1.5 hover:bg-paper"
            onClick={() => {
              setOpen(false);
              onAdd(row, 'sibling-above');
            }}
          >
            上方新增（同级）
          </button>
          <button
            className="w-full text-left px-2.5 py-1.5 hover:bg-paper"
            onClick={() => {
              setOpen(false);
              onAdd(row, 'sibling-below');
            }}
          >
            下方新增（同级）
          </button>
          <button
            className="w-full text-left px-2.5 py-1.5 hover:bg-paper"
            onClick={() => {
              setOpen(false);
              onAdd(row, 'child-below');
            }}
          >
            下方新增（子级）
          </button>
        </div>
      )}
    </div>
  );
}

const COL_LABEL: Record<string, string> = {
  seq: '序号',
  type: '类型',
  item: '事项',
  progress: '进度',
  assignee: '负责人',
  status: '状态',
  ps: '计划开始',
  pe: '计划结束',
  as: '实际开始',
  ae: '实际结束',
  ops: '操作',
};

/* ---------------- 甘特图 ---------------- */

interface Range {
  start: Date;
  units: number;
  unitPx: number;
  totalPx: number;
  headerYear: { key: string; label: string; span: number }[];
  headerMonth: { key: string; label: string; span: number }[];
  ticks: { key: string; label: string }[];
}

function computeRange(items: ProjectWbs[], gran: Granularity): Range | null {
  const dates: Date[] = [];
  items.forEach((w) => {
    [w.planned_start, w.planned_end, w.actual_start, w.actual_end].forEach((d) => {
      if (d) dates.push(new Date(d));
    });
  });
  if (dates.length === 0) return null;
  let start = new Date(Math.min(...dates.map((d) => d.getTime())));
  let end = new Date(Math.max(...dates.map((d) => d.getTime())));
  start = new Date(start);
  start.setDate(start.getDate() - 7);
  end = new Date(end);
  end.setDate(end.getDate() + 14);

  if (gran === 'day') return buildDay(start, end);
  if (gran === 'week') return buildWeek(start, end);
  return buildMonth(start, end);
}

function buildDay(start: Date, end: Date): Range {
  const days = daysBetween(start, end) + 1;
  const unitPx = 30;
  const ticks: Range['ticks'] = [];
  const monthGroups: Range['headerMonth'] = [];
  const yearGroups: Range['headerYear'] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    ticks.push({ key: `d${i}`, label: String(d.getDate()) });
    const mLabel = `${d.getMonth() + 1}月`;
    const yLabel = `${d.getFullYear()}`;
    const lastM = monthGroups[monthGroups.length - 1];
    if (lastM && lastM.label === mLabel && lastM.key.startsWith(yLabel)) lastM.span++;
    else monthGroups.push({ key: `${yLabel}-${mLabel}-${i}`, label: mLabel, span: 1 });
    const lastY = yearGroups[yearGroups.length - 1];
    if (lastY && lastY.label === yLabel) lastY.span++;
    else yearGroups.push({ key: `${yLabel}-${i}`, label: yLabel, span: 1 });
  }
  return {
    start,
    units: days,
    unitPx,
    totalPx: days * unitPx,
    headerYear: yearGroups,
    headerMonth: monthGroups,
    ticks,
  };
}

function buildWeek(start: Date, end: Date): Range {
  const dow = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - dow);
  const weeks = Math.ceil((daysBetween(start, end) + 1) / 7);
  const unitPx = 46;
  const ticks: Range['ticks'] = [];
  const monthGroups: Range['headerMonth'] = [];
  const yearGroups: Range['headerYear'] = [];
  for (let i = 0; i < weeks; i++) {
    const w = new Date(start);
    w.setDate(w.getDate() + i * 7);
    ticks.push({ key: `w${i}`, label: `W${isoWeekNum(w)}` });
    // 一周落在某月：按周中点所在月归组
    const mid = new Date(w);
    mid.setDate(mid.getDate() + 3);
    const mLabel = `${mid.getMonth() + 1}月`;
    const yLabel = `${mid.getFullYear()}`;
    const lastM = monthGroups[monthGroups.length - 1];
    if (lastM && lastM.label === mLabel && lastM.key.startsWith(yLabel)) lastM.span++;
    else monthGroups.push({ key: `${yLabel}-${mLabel}-${i}`, label: mLabel, span: 1 });
    const lastY = yearGroups[yearGroups.length - 1];
    if (lastY && lastY.label === yLabel) lastY.span++;
    else yearGroups.push({ key: `${yLabel}-${i}`, label: yLabel, span: 1 });
  }
  return {
    start,
    units: weeks,
    unitPx,
    totalPx: weeks * unitPx,
    headerYear: yearGroups,
    headerMonth: monthGroups,
    ticks,
  };
}

function buildMonth(start: Date, end: Date): Range {
  start = new Date(start.getFullYear(), start.getMonth(), 1);
  const endM = new Date(end.getFullYear(), end.getMonth(), 1);
  const months =
    (endM.getFullYear() - start.getFullYear()) * 12 + (endM.getMonth() - start.getMonth()) + 1;
  const unitPx = 84;
  const ticks: Range['ticks'] = [];
  const monthGroups: Range['headerMonth'] = [];
  const yearGroups: Range['headerYear'] = [];
  for (let i = 0; i < months; i++) {
    const d = new Date(start);
    d.setMonth(d.getMonth() + i);
    ticks.push({ key: `m${i}`, label: `${d.getMonth() + 1}月` });
    monthGroups.push({ key: `mg${i}`, label: `${d.getMonth() + 1}月`, span: 1 });
    const yLabel = `${d.getFullYear()}`;
    const lastY = yearGroups[yearGroups.length - 1];
    if (lastY && lastY.label === yLabel) lastY.span++;
    else yearGroups.push({ key: `${yLabel}-${i}`, label: yLabel, span: 1 });
  }
  return {
    start,
    units: months,
    unitPx,
    totalPx: months * unitPx,
    headerYear: yearGroups,
    headerMonth: monthGroups,
    ticks,
  };
}

function Gantt({
  range,
  items,
  granularity,
}: {
  range: Range;
  items: ProjectWbs[];
  granularity: Granularity;
}) {
  const rowH = 40;
  const todayOffset = daysBetween(range.start, new Date()) * dayPxOf(range, granularity);
  return (
    <div style={{ width: range.totalPx, position: 'relative' }}>
      {/* 表头 3 行等高 22px 各 = 66px，与左表 66px 对齐 */}
      <div className="flex bg-band border-b border-line" style={{ height: 22 }}>
        {range.headerYear.map((y) => (
          <div
            key={y.key}
            className="border-r border-line text-center text-[11.5px] font-medium text-ink-2 leading-[22px]"
            style={{ width: y.span * range.unitPx }}
          >
            {y.label}
          </div>
        ))}
      </div>
      <div className="flex bg-band border-b border-line" style={{ height: 22 }}>
        {range.headerMonth.map((m) => (
          <div
            key={m.key}
            className="border-r border-line text-center text-[11.5px] text-ink-2 leading-[22px]"
            style={{ width: m.span * range.unitPx }}
          >
            {m.label}
          </div>
        ))}
      </div>
      <div className="flex bg-band border-b border-line" style={{ height: 22 }}>
        {range.ticks.map((t) => (
          <div
            key={t.key}
            className="border-r border-line text-center text-[10.5px] text-ink-3 leading-[22px] num"
            style={{ width: range.unitPx }}
          >
            {t.label}
          </div>
        ))}
      </div>

      {/* 今天线 */}
      {todayOffset >= 0 && todayOffset <= range.totalPx && (
        <div
          className="absolute top-0 bottom-0 w-px bg-danger z-10 pointer-events-none"
          style={{ left: todayOffset }}
        />
      )}

      {/* 行 */}
      {items.map((w) => {
        const p = calcBar(w.planned_start ?? null, w.planned_end ?? null, range, granularity);
        const a = calcBar(w.actual_start ?? null, w.actual_end ?? null, range, granularity);
        return (
          <div key={w.id} className="relative border-b border-line/60" style={{ height: rowH }}>
            {p && (
              <div
                className="absolute rounded"
                style={{
                  left: p.left,
                  width: p.width,
                  top: 10,
                  height: 8,
                  background: 'linear-gradient(90deg,#F59E0B,#FBBF24)',
                }}
                title="计划"
              />
            )}
            {a && (
              <div
                className="absolute rounded"
                style={{
                  left: a.left,
                  width: a.width,
                  top: 22,
                  height: 8,
                  background: 'linear-gradient(90deg,#10B981,#34D9A5)',
                }}
                title="实际"
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ------------ 工具函数 ------------ */
function rowBgByStatus(w: ProjectWbs): string {
  if (w.status === 'closed') return 'bg-state-closed/60';
  return '';
}
function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}
function plannedDays(item: ProjectWbs): number {
  if (!item.planned_start || !item.planned_end) return 0;
  const from = new Date(`${item.planned_start}T00:00:00`);
  const to = new Date(`${item.planned_end}T00:00:00`);
  const days = daysBetween(from, to) + 1;
  return Number.isFinite(days) && days > 0 ? days : 0;
}
function dayPxOf(r: Range, g: Granularity): number {
  return g === 'day' ? r.unitPx : g === 'week' ? r.unitPx / 7 : r.unitPx / 30;
}
function calcBar(
  from: string | null,
  to: string | null,
  r: Range,
  g: Granularity,
): { left: number; width: number } | null {
  if (!from || !to) return null;
  const dp = dayPxOf(r, g);
  const left = daysBetween(r.start, new Date(from)) * dp;
  const width = Math.max(4, (daysBetween(new Date(from), new Date(to)) + 1) * dp);
  return { left: Math.max(0, left), width };
}
function isoWeekNum(d: Date): number {
  const dt = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  return Math.ceil(((dt.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}
function fmtToday(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
