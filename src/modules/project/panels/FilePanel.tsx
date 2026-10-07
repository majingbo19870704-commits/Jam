import { useEffect, useMemo, useState } from 'react';
import { Download, FolderOpen, MapPin, RotateCcw, Search, Trash2, Upload, ZoomIn } from 'lucide-react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { open as openInShell } from '@tauri-apps/plugin-shell';
import { invoke } from '@tauri-apps/api/core';
import { ResizableTh } from '@/components/ResizableTh';
import { loadWidths, saveWidths } from '@/lib/column-widths';
import {
  cell,
  exportReport,
  formatImportSummary,
  optionId,
  readImportRows,
} from '@/lib/report-excel';
import { useTableZoom } from '@/hooks/useTableZoom';
import { InlineSelect, InlineText } from '@/components/inline';
import { useAccountStore } from '@/stores/account';
import {
  attachFile,
  listFiles,
  softDeleteFiles,
  updateFile,
  type ProjectFile,
} from '@/db/project-file-dao';
import { listFileParameters } from '@/db/material-dao';
import { getProject, updateProject } from '@/db/project-dao';
import type { MaterialFileParameter, Project } from '@/types';
import { FileEditModal } from './FileEditModal';
import { FilePreviewModal } from './FilePreviewModal';

interface Props {
  projectId: string;
  focusedFileId?: string | null;
}

const DEFAULT_WIDTHS: Record<string, number> = {
  check: 16,
  seq: 56,
  type: 96,
  name: 200,
  path: 260,
  status: 80,
  ops: 140,
  remark: 200,
};
type PendingFileImport = {
  rowNo: number;
  sourcePath: string;
  displayName: string;
  typeId: string | null;
  status: ProjectFile['status'];
  remark: string | null;
  conflict: boolean;
  ready: boolean;
  sizeBytes: number;
  failureReason: string | null;
};
type ImportFailure = { row: number; path: string; reason: string };
type SourceFileInspection = {
  path: string;
  ready: boolean;
  sizeBytes: number;
  reason: string | null;
};

async function exportFailedImportRows(rows: ImportFailure[]) {
  return exportReport({
    title: '项目文件导入失败记录',
    fileStem: '项目文件导入失败记录',
    rows,
    columns: [
      { title: '原始行', value: (item) => item.row, width: 10 },
      { title: '源文件路径', value: (item) => item.path, width: 50 },
      { title: '失败原因', value: (item) => item.reason, width: 46 },
    ],
  });
}

export function FilePanel({ projectId, focusedFileId }: Props) {
  const TABLE_ID = `project_file.${projectId}.v1`;
  const [items, setItems] = useState<ProjectFile[]>([]);
  const [types, setTypes] = useState<MaterialFileParameter[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [keyword, setKeyword] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [uploadTypeId, setUploadTypeId] = useState('');
  const [editing, setEditing] = useState<ProjectFile | null>(null);
  const [preview, setPreview] = useState<ProjectFile | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingImport, setPendingImport] = useState<PendingFileImport[] | null>(null);
  const [previewErrors, setPreviewErrors] = useState<string[]>([]);
  const [previewFailures, setPreviewFailures] = useState<ImportFailure[]>([]);
  const [importDuplicates, setImportDuplicates] = useState(false);
  const currentAccountId = useAccountStore((s) => s.currentAccountId);
  void currentAccountId;

  const [widths, setWidths] = useState<Record<string, number>>(() =>
    loadWidths(TABLE_ID, DEFAULT_WIDTHS),
  );
  const zoomCtl = useTableZoom(TABLE_ID);

  const typeMap = useMemo(() => {
    const m = new Map<string, string>();
    types.forEach((t) => m.set(t.id, t.file_type));
    return m;
  }, [types]);

  async function refresh() {
    setLoading(true);
    try {
      const [rows, t, projectRow] = await Promise.all([listFiles(projectId), listFileParameters(), getProject(projectId)]);
      setItems(rows);
      setTypes(t);
      setProject(projectRow);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    refresh();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // 来自全局搜索的文件会自动滚到可见区域并打开内嵌预览。
  useEffect(() => {
    if (!focusedFileId || loading) return;
    const file = items.find((item) => item.id === focusedFileId);
    if (!file) return;
    setSelected(new Set([file.id]));
    setPreview(file);
    window.setTimeout(() => document.getElementById(`project-file-${file.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 40);
  }, [focusedFileId, items, loading]);

  async function handleUpload() {
    const paths = await openDialog({ multiple: true, title: '选择要上传的文件' });
    if (!paths) return;
    const list = Array.isArray(paths) ? paths : [paths];
    for (const p of list) {
      const path = typeof p === 'string' ? p : (p as any).path;
      if (!path) continue;
      const name = path.split(/[/\\]/).pop() ?? path;
      try {
        await attachFile(projectId, { sourcePath: path, originalName: name, fileParameterId: uploadTypeId || null });
      } catch (e) {
        alert(`「${name}」上传失败：${String(e)}`);
      }
    }
    await refresh();
  }
  async function handleSetArchiveLocation() {
    if (!project) {
      alert('未找到当前项目，暂时无法设置归档地址。');
      return;
    }
    const picked = await openDialog({ directory: true, multiple: false, title: '选择项目文件归档根目录' });
    if (!picked) return;
    const archiveRoot = typeof picked === 'string' ? picked : (picked as any).path;
    if (!archiveRoot) return;
    try {
      const projectDirectory = await invoke<string>('prepare_project_archive', {
        archiveRoot,
        projectName: project.name,
      });
      await updateProject(projectId, { archive_root: archiveRoot });
      setProject((current) => current ? { ...current, archive_root: archiveRoot } : current);
      alert(`归档地址已设置，已创建项目文件夹：\n${projectDirectory}`);
    } catch (error) {
      alert(`设置归档地址失败：${String(error)}`);
    }
  }
  /** 查看：内嵌预览 */
  function handleView(f: ProjectFile) {
    setPreview(f);
  }
  /** 用系统默认程序打开 —— 需要拿到绝对路径 */
  async function handleOpenInShell(f: ProjectFile) {
    try {
      if (f.archive_path) {
        try {
          await openInShell(f.archive_path);
          return;
        } catch {
          // 归档盘可能暂时不可用，回退打开应用内副本。
        }
      }
      const appCopyPath = await invoke<string>('resolve_data_path', { relPath: f.rel_path });
      await openInShell(appCopyPath);
    } catch (e) {
      alert('打开失败：' + String(e));
    }
  }
  async function handleDelete(ids: string[]) {
    if (!ids.length) return;
    if (!confirm(`确认删除 ${ids.length} 条记录？已归档的对应文件会同步删除；不会删除原始文件和应用内副本。`)) return;
    try {
      await softDeleteFiles(ids);
      setSelected(new Set());
      await refresh();
    } catch (error) {
      alert(`删除失败：${String(error)}\n已保留记录，方便你处理归档文件后重试。`);
    }
  }
  async function patch(id: string, p: Partial<ProjectFile>) {
    await updateFile(id, p);
    await refresh();
  }
  function setColWidth(k: string, w: number) {
    setWidths((p) => ({ ...p, [k]: w }));
  }
  function commitColWidths() {
    saveWidths(TABLE_ID, widths);
  }
  const totalWidth = Object.values(widths).reduce((a, b) => a + b, 0);

  const filtered = items.filter((f) => {
    if (typeFilter && f.file_parameter_id !== typeFilter) return false;
    if (statusFilter && f.status !== statusFilter) return false;
    if (keyword.trim()) {
      const kw = keyword.trim().toLowerCase();
      const typeName = f.file_parameter_id ? (typeMap.get(f.file_parameter_id) ?? '') : '';
      const haystack = [f.display_name, f.original_name, f.rel_path, f.archive_path, f.remark, f.status, typeName]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(kw)) return false;
    }
    return true;
  });

  async function handleExport(template = false) {
    const ok = await exportReport({
      title: '项目文件',
      fileStem: template ? '项目文件导入模板' : '项目文件报表',
      rows: template ? [] : filtered,
      columns: [
        {
          title: template ? '源文件路径' : '归档路径',
          value: (item: ProjectFile) => (template ? '' : item.archive_path ?? item.rel_path),
          width: 48,
        },
        { title: '显示名称', value: (item: ProjectFile) => item.display_name, width: 30 },
        {
          title: '类型',
          value: (item: ProjectFile) =>
            item.file_parameter_id ? (typeMap.get(item.file_parameter_id) ?? item.file_parameter_id) : '',
          width: 14,
        },
        {
          title: '状态',
          value: (item: ProjectFile) => (item.status === 'valid' ? '有效' : '无效'),
          width: 10,
        },
        { title: '备注', value: (item: ProjectFile) => item.remark, width: 28 },
      ],
    });
    if (ok) alert(template ? '已生成导入模板。' : `已导出 ${filtered.length} 个文件记录。`);
  }

  async function handleImportExcel() {
    try {
      const rows = await readImportRows();
      if (!rows) return;
      const errors: string[] = [];
      const validationFailures: ImportFailure[] = [];
      const candidates: PendingFileImport[] = [];
      const knownNames = new Set(
        items.flatMap((item) => [item.display_name, item.original_name].map((name) => name.trim().toLocaleLowerCase())),
      );
      for (const { rowNo, values } of rows) {
        const sourcePath = cell(values, '源文件路径');
        const displayName = cell(values, '显示名称');
        const typeValue = cell(values, '类型');
        const typeId = optionId(typeValue, types.map((type) => ({ ...type, name: type.file_type })) as any);
        const statusText = cell(values, '状态');
        const status =
          (
            { 有效: 'valid', 无效: 'invalid', valid: 'valid', invalid: 'invalid' } as Record<
              string,
              ProjectFile['status']
            >
          )[statusText] ?? (statusText ? undefined : 'valid');
        const isAbsolute = /^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(sourcePath);
        if (!sourcePath || !isAbsolute || !status || (typeValue && !typeId)) {
          const reason = '需要本机绝对路径，且类型、状态必须有效';
          errors.push(`第 ${rowNo} 行：${reason}`);
          validationFailures.push({ row: rowNo, path: sourcePath, reason });
          continue;
        }
        const normalizedName = displayName || sourcePath.split(/[/\\]/).pop() || sourcePath;
        const normalizedKey = normalizedName.trim().toLocaleLowerCase();
        const conflict = knownNames.has(normalizedKey);
        knownNames.add(normalizedKey);
        candidates.push({
          rowNo, sourcePath, displayName: normalizedName, typeId: typeId ?? null, status,
          remark: cell(values, '备注') || null,
          conflict,
          ready: true,
          sizeBytes: 0,
          failureReason: null,
        });
      }
      if (!candidates.length) {
        alert(formatImportSummary(0, errors));
        if (validationFailures.length && confirm(`有 ${validationFailures.length} 条校验失败，是否导出失败记录？`))
          await exportFailedImportRows(validationFailures);
        return;
      }
      const inspections = await invoke<SourceFileInspection[]>('inspect_source_files', {
        paths: Array.from(new Set(candidates.map((candidate) => candidate.sourcePath))),
      });
      const inspectionsByPath = new Map(inspections.map((inspection) => [inspection.path, inspection]));
      candidates.forEach((candidate) => {
        const inspection = inspectionsByPath.get(candidate.sourcePath);
        if (!inspection) {
          candidate.ready = false;
          candidate.failureReason = '未收到文件可用性检查结果';
          return;
        }
        candidate.ready = inspection.ready;
        candidate.sizeBytes = inspection.sizeBytes;
        candidate.failureReason = inspection.reason;
      });
      setPreviewErrors(errors);
      setPreviewFailures(validationFailures);
      setPendingImport(candidates);
      setImportDuplicates(false);
    } catch (error) {
      alert(`导入失败：${String(error)}`);
    }
  }

  async function confirmImport() {
    if (!pendingImport) return;
    const errors = [...previewErrors];
    const failed: ImportFailure[] = [...previewFailures];
    let imported = 0;
    for (const row of pendingImport) {
      if (!row.ready) {
        const reason = row.failureReason ?? '源文件当前不可读取';
        errors.push(`第 ${row.rowNo} 行：${reason}`);
        failed.push({ row: row.rowNo, path: row.sourcePath, reason });
        continue;
      }
      if (row.conflict && !importDuplicates) {
        const reason = '与现有文件名称重复，已按预览设置跳过';
        errors.push(`第 ${row.rowNo} 行：${reason}`);
        failed.push({ row: row.rowNo, path: row.sourcePath, reason });
        continue;
      }
      try {
        const created = await attachFile(projectId, {
          sourcePath: row.sourcePath,
          originalName: row.displayName,
          fileParameterId: row.typeId,
        });
        await updateFile(created.id, { display_name: row.displayName, status: row.status, remark: row.remark });
        imported++;
      } catch (error) {
        const reason = String(error);
        errors.push(`第 ${row.rowNo} 行：${reason}`);
        failed.push({ row: row.rowNo, path: row.sourcePath, reason });
      }
    }
    setPendingImport(null);
    await refresh();
    alert(formatImportSummary(imported, errors));
    if (failed.length && confirm(`有 ${failed.length} 条未导入，是否立即导出失败记录？`)) {
      await exportFailedImportRows(failed);
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
                {t.file_type}
              </option>
            ))}
          </select>
          <select
            className="input-lite"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            title="状态筛选"
          >
            <option value="">全部状态</option>
            <option value="valid">有效</option>
            <option value="invalid">无效</option>
          </select>
          <div className="flex items-center gap-2 flex-1 min-w-[200px] px-3 py-1.5 border border-line-strong rounded bg-canvas">
            <Search size={14} className="text-ink-3" />
            <input
              className="flex-1 outline-none text-sm bg-transparent"
              placeholder="全表搜索  文件名、路径、类型、备注…"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
          </div>
          <button
            className="btn"
            onClick={() => {
              setKeyword('');
              setTypeFilter('');
              setStatusFilter('');
            }}
          >
            <RotateCcw size={12} /> 重置
          </button>
        </div>
      </div>

      {pendingImport && (
        <div className="fixed inset-0 z-40 grid place-items-center bg-black/30 px-4">
          <div className="w-[720px] max-w-full rounded-xl bg-canvas shadow-lg overflow-hidden">
            <div className="px-5 py-4 border-b border-line flex items-center justify-between">
              <div><h3 className="font-semibold">导入预览</h3><p className="mt-1 text-xs text-ink-3">仅可导入本机绝对路径；确认后会复制/关联对应文件。</p></div>
              <button className="icon-btn" onClick={() => setPendingImport(null)}>×</button>
            </div>
            <div className="p-5 max-h-[48vh] overflow-auto">
              <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                <span>可读取 <b className="num">{pendingImport.filter((item) => item.ready).length}</b></span>
                <span className="text-warn">名称冲突 <b className="num">{pendingImport.filter((item) => item.conflict).length}</b></span>
                <span className="text-danger">源文件不可用 <b className="num">{pendingImport.filter((item) => !item.ready).length}</b></span>
                <span className="text-danger">格式校验失败 <b className="num">{previewErrors.length}</b></span>
              </div>
              <label className="mb-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={importDuplicates} onChange={(event) => setImportDuplicates(event.target.checked)} /> 名称冲突仍然导入（包括本批次重复项）</label>
              <table className="table w-full text-xs"><thead><tr><th>行</th><th className="!text-left">文件</th><th>状态</th></tr></thead><tbody>
                {pendingImport.slice(0, 100).map((item) => <tr key={item.rowNo}><td>{item.rowNo}</td><td className="!text-left truncate max-w-[420px]" title={item.sourcePath}>{item.displayName}<div className="text-ink-4">{item.sourcePath}{item.ready && item.sizeBytes > 0 ? ` · ${formatBytes(item.sizeBytes)}` : ''}</div></td><td className={!item.ready ? 'text-danger' : item.conflict ? 'text-warn' : 'text-ok'} title={item.failureReason ?? undefined}>{!item.ready ? '文件不可用' : item.conflict ? '名称重复' : '可导入'}</td></tr>)}
              </tbody></table>
              {previewErrors.length > 0 && <div className="mt-3 text-xs text-danger whitespace-pre-wrap">{previewErrors.slice(0, 8).join('\n')}</div>}
            </div>
            <div className="px-5 py-4 border-t border-line flex justify-end gap-2"><button className="btn" onClick={() => setPendingImport(null)}>取消</button><button className="btn btn-primary" onClick={() => void confirmImport()}>确认导入</button></div>
          </div>
        </div>
      )}

      {/* 操作栏 + 表格 */}
      <div className="card">
        <div className="px-4 py-3 border-b border-line flex items-center gap-2 flex-wrap">
          <button className="btn btn-primary" onClick={handleUpload}>
            <Upload size={12} /> 上传 / 关联
          </button>
          <button className="btn" onClick={() => void handleSetArchiveLocation()} title="选择项目文件归档根目录">
            <MapPin size={12} /> 归档地址
          </button>
          <select
            className="input-lite !py-1.5 text-xs"
            value={uploadTypeId}
            onChange={(event) => setUploadTypeId(event.target.value)}
            title="上传文件的归档类型"
          >
            <option value="">上传至：未分类</option>
            {types.map((type) => <option key={type.id} value={type.id}>上传至：{type.file_type}</option>)}
          </select>
          <span className="text-xs text-ink-3">
            {items.length} 项 · 选中 {selected.size}
          </span>
          <span
            className="max-w-[260px] truncate text-xs text-ink-3"
            title={project?.archive_root ?? undefined}
          >
            {project?.archive_root ? `归档：${project.archive_root}` : '未设置归档地址'}
          </span>
          <div className="flex-1" />
          <button className="btn" onClick={() => void handleExport(true)}>
            <Download size={12} /> 模板
          </button>
          <button
            className="btn"
            onClick={() => void handleImportExcel()}
            title="按模板中的本地绝对路径批量关联文件"
          >
            <Upload size={12} /> 导入清单
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
                  {(['seq', 'type', 'name', 'path', 'status', 'ops', 'remark'] as const).map(
                    (k) => (
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
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={8} className="text-center text-ink-3 py-8">
                      加载中…
                    </td>
                  </tr>
                )}
                {!loading && filtered.length === 0 && (
                  <tr>
                    <td colSpan={8} className="text-center text-ink-3 py-10">
                      <div className="flex flex-col items-center gap-2">
                        <FolderOpen size={28} className="text-ink-4" />
                        <div>暂无文件，点左上「上传 / 关联」选择本地文件</div>
                      </div>
                    </td>
                  </tr>
                )}
                {filtered.map((f) => (
                  <tr id={`project-file-${f.id}`} key={f.id}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selected.has(f.id)}
                        onChange={(e) =>
                          setSelected((s) => {
                            const n = new Set(s);
                            if (e.target.checked) n.add(f.id);
                            else n.delete(f.id);
                            return n;
                          })
                        }
                      />
                    </td>
                    <td className="num text-ink-3">{f.seq_no}</td>
                    <td>
                      <InlineSelect
                        value={f.file_parameter_id ?? ''}
                        onChange={(v) => patch(f.id, { file_parameter_id: v || null })}
                        options={[
                          { v: '', label: '—' },
                          ...types.map((t) => ({ v: t.id, label: t.file_type })),
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
                    <td className="!text-left">
                      <InlineText
                        value={f.display_name}
                        onChange={(v) => patch(f.id, { display_name: v })}
                        placeholder="双击输入..."
                      />
                    </td>
                    <td className="!text-left text-[11.5px] text-ink-3 truncate" title={f.archive_path ?? f.rel_path}>
                      {f.archive_path ?? f.rel_path}
                    </td>
                    <td>
                      <InlineSelect
                        value={f.status}
                        onChange={(v) => patch(f.id, { status: v as 'valid' | 'invalid' })}
                        options={[
                          { v: 'valid', label: '有效' },
                          { v: 'invalid', label: '无效' },
                        ]}
                        render={(v) =>
                          v === 'valid' ? (
                            <span className="chip status-closed">有效</span>
                          ) : (
                            <span className="chip">无效</span>
                          )
                        }
                      />
                    </td>
                    <td>
                      <div className="flex gap-1 justify-center flex-wrap">
                        <button
                          className="btn btn-ghost !py-0.5 !px-2 text-xs text-accent"
                          onClick={() => handleView(f)}
                        >
                          预览
                        </button>
                        <button
                          className="btn btn-ghost !py-0.5 !px-2 text-xs"
                          onClick={() => handleOpenInShell(f)}
                        >
                          打开
                        </button>
                        <button
                          className="btn btn-ghost !py-0.5 !px-2 text-xs"
                          onClick={() => setEditing(f)}
                        >
                          编辑
                        </button>
                        <button
                          className="btn btn-ghost !py-0.5 !px-2 text-xs text-danger"
                          onClick={() => handleDelete([f.id])}
                        >
                          删除
                        </button>
                      </div>
                    </td>
                    <td className="!text-left">
                      <InlineText
                        value={f.remark ?? ''}
                        onChange={(v) => patch(f.id, { remark: v || null })}
                        placeholder="双击输入..."
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="px-4 py-2 text-[11.5px] text-ink-4 border-t border-line">
          设置归档地址后，新上传文件会同时归档到“项目名 / 文件类型”目录；应用内副本仍会保留，方便预览、备份和迁移。
        </div>
      </div>

      {editing && (
        <FileEditModal
          item={editing}
          types={types}
          onClose={() => setEditing(null)}
          onSaved={refresh}
        />
      )}
      {preview && <FilePreviewModal file={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}

const COL_LABEL: Record<string, string> = {
  seq: '序号',
  type: '类型',
  name: '文件名',
  path: '路径',
  status: '状态',
  ops: '操作',
  remark: '备注',
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
