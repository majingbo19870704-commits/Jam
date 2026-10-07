import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Download, Eye, FolderOpen, Plus, RotateCcw, Search, Trash2, X } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { open as openInShell } from '@tauri-apps/plugin-shell';
import { ResizableTh } from '@/components/ResizableTh';
import { loadWidths, saveWidths } from '@/lib/column-widths';
import { createMaterialFile, listBrands, listFileParameters, listMaterialFiles, listModels, softDeleteMaterialFiles, updateMaterialFile, type MaterialFileRow } from '@/db/material-dao';
import type { MaterialBrand, MaterialFileParameter, MaterialModel } from '@/types';

type PendingFile = { id: string; sourcePath: string; originalName: string; material_type: string; file_parameter_id: string; status: 'valid' | 'invalid'; brand_id: string | null; client_model_id: string | null; skyworth_model_id: string | null; seq: number };
type Option = [string, string];
type TextPreview = { content: string; truncated: boolean; totalBytes: number };
const WIDTHS = { check:46, seq:66, material:130, type:130, name:300, brand:120, client:130, skyworth:130, date:120, status:104, ops:96 };
const EMPTY_FILTERS = { keyword:'', material:'', type:'', brand:'', client:'', skyworth:'', status:'' };
const TAB_ORDER_KEY = 'materials.tab-order.v1';

export function MaterialsPage({ embedded = false }: { embedded?: boolean }) {
  const [parameters, setParameters] = useState<MaterialFileParameter[]>([]);
  const [brands, setBrands] = useState<MaterialBrand[]>([]);
  const [models, setModels] = useState<MaterialModel[]>([]);
  const [items, setItems] = useState<MaterialFileRow[]>([]);
  const [pending, setPending] = useState<PendingFile[]>([]);
  const [tab, setTab] = useState(embedded ? '项目资料' : '总表');
  const [selected, setSelected] = useState(new Set<string>());
  const [menuOpen, setMenuOpen] = useState(false);
  const uploadAnchor = useRef<HTMLDivElement>(null);
  const [uploadMenu, setUploadMenu] = useState<{top:number;left:number}>();
  const [tabOrder, setTabOrder] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem(TAB_ORDER_KEY) ?? '[]'); } catch { return []; } });
  const [draggingTab, setDraggingTab] = useState('');
  const [dragReadyTab, setDragReadyTab] = useState('');
  const holdTimer = useRef<number>();
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [widths, setWidths] = useState(() => loadWidths('materials.files.v2', WIDTHS));
  const [preview, setPreview] = useState<MaterialFileRow | null>(null);
  const types = useMemo(() => [...new Set(parameters.map((item) => item.material_type))], [parameters]);
  const orderedTypes = useMemo(() => [...types].sort((left, right) => { const leftIndex = tabOrder.indexOf(left); const rightIndex = tabOrder.indexOf(right); return (leftIndex < 0 ? Number.MAX_SAFE_INTEGER : leftIndex) - (rightIndex < 0 ? Number.MAX_SAFE_INTEGER : rightIndex); }), [types, tabOrder]);
  const activeType = tab === '总表' ? '' : tab;
  const typeOptions: Option[] = types.map((name) => [name, name]);

  async function refresh() {
    const [p, b, m, files] = await Promise.all([listFileParameters(), listBrands(), listModels(), listMaterialFiles(activeType || undefined)]);
    setParameters(p.filter((item) => !item.is_draft)); setBrands(b); setModels(m); setItems(files);
  }
  // refresh 会读取当前资料类型；仅在页签切换时重新请求。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void refresh(); setSelected(new Set()); }, [activeType]);
  const shown = items.filter((file) =>
    (!filters.keyword || `${file.original_name} ${file.material_type} ${file.file_type} ${file.brand_name ?? ''} ${file.client_model ?? ''} ${file.skyworth_model ?? ''}`.toLocaleLowerCase().includes(filters.keyword.toLocaleLowerCase()))
    && (!filters.material || file.material_type === filters.material) && (!filters.type || file.file_parameter_id === filters.type)
    && (!filters.brand || file.brand_id === filters.brand) && (!filters.client || file.client_model_id === filters.client)
    && (!filters.skyworth || file.skyworth_model_id === filters.skyworth) && (!filters.status || file.status === filters.status));
  const rows = [...shown, ...pending.filter((file) =>
    (!activeType || file.material_type === activeType) && (!filters.keyword || file.originalName.toLocaleLowerCase().includes(filters.keyword.toLocaleLowerCase())) && (!filters.material || file.material_type === filters.material)
    && (!filters.type || file.file_parameter_id === filters.type) && (!filters.brand || file.brand_id === filters.brand)
    && (!filters.client || file.client_model_id === filters.client) && (!filters.skyworth || file.skyworth_model_id === filters.skyworth)
    && (!filters.status || file.status === filters.status))];
  const valid = shown.filter((file) => file.status === 'valid').length;
  const invalid = shown.filter((file) => file.status === 'invalid').length;
  function insertAt(kind: 'end' | 'above' | 'below') { const index = rows.findIndex((row) => selected.has(row.id)); return kind === 'end' ? items.length + pending.length + 1 : Math.max(1, index + (kind === 'below' ? 2 : 1)); }
  async function chooseFiles(kind: 'end' | 'above' | 'below') {
    const result = await openDialog({ multiple:true, title:'选择资料文件' }); if (!result) return;
    const paths = (Array.isArray(result) ? result : [result]).map((item:any) => typeof item === 'string' ? item : item.path).filter(Boolean) as string[]; const start = insertAt(kind);
    setPending((current) => [...current, ...paths.map((sourcePath, index) => ({ id:`draft-${Date.now()}-${index}`, sourcePath, originalName:sourcePath.split(/[/\\]/).pop() ?? sourcePath, material_type:activeType, file_parameter_id:'', status:'valid' as const, brand_id:null, client_model_id:null, skyworth_model_id:null, seq:start + index }))]); setMenuOpen(false);
  }
  async function patchPending(id: string, patch: Partial<PendingFile>) {
    const current = pending.find((item) => item.id === id); if (!current) return; const next = { ...current, ...patch }; setPending((list) => list.map((item) => item.id === id ? next : item)); if (!next.material_type || !next.file_parameter_id) return;
    try { await createMaterialFile({ ...next, sourcePath:next.sourcePath, original_name:next.originalName, insertAt:next.seq }); setPending((list) => list.filter((item) => item.id !== id)); await refresh(); } catch (error) { alert(`归档“${next.originalName}”失败：${String(error)}`); }
  }
  async function remove(ids: string[]) { const real = ids.filter((id) => !id.startsWith('draft-')); if (real.length && !confirm(`确认将 ${real.length} 个资料文件移入回收站？`)) return; if (real.length) await softDeleteMaterialFiles(real); setPending((list) => list.filter((item) => !ids.includes(item.id))); setSelected(new Set()); await refresh(); }
  const setWidth = (key:keyof typeof WIDTHS, width:number) => setWidths((current) => ({...current,[key]:width}));
  const saveTableWidths = () => saveWidths('materials.files.v2', widths);
  const openUploadMenu = () => { if (menuOpen) { setMenuOpen(false); return; } const rect = uploadAnchor.current?.getBoundingClientRect(); if (!rect) return; setUploadMenu({left:rect.left,top:rect.bottom + 6}); setMenuOpen(true); };
  const reorderTabs = (source: string, target: string) => { if (!source || source === target) return; const next = orderedTypes.filter((item) => item !== source); next.splice(Math.max(0, next.indexOf(target)), 0, source); setTabOrder(next); localStorage.setItem(TAB_ORDER_KEY, JSON.stringify(next)); };
  const beginTabHold = (name: string) => { if (name === '总表') return; window.clearTimeout(holdTimer.current); holdTimer.current = window.setTimeout(() => setDragReadyTab(name), 350); };
  const endTabHold = () => { window.clearTimeout(holdTimer.current); if (!draggingTab) setDragReadyTab(''); };
  return <div className={embedded ? 'grid gap-4' : 'mx-auto flex h-full min-h-0 w-full max-w-[1640px] flex-col p-4 sm:p-6'}>
    {!embedded && <nav className="mb-4 flex flex-wrap gap-1 rounded-xl border border-line bg-paper p-1.5">{['总表',...orderedTypes].map((name) => <button key={name} draggable={name !== '总表' && dragReadyTab === name} className={`whitespace-nowrap rounded-lg px-3.5 py-2 text-sm ${tab === name ? 'bg-canvas font-semibold text-accent shadow-sm' : 'text-ink-3'} ${draggingTab === name ? 'opacity-50' : ''} ${dragReadyTab === name ? 'cursor-grab' : ''}`} onMouseDown={() => beginTabHold(name)} onMouseUp={endTabHold} onMouseLeave={endTabHold} onClick={() => setTab(name)} onDragStart={(event) => { if (name === '总表' || dragReadyTab !== name) { event.preventDefault(); return; } setDraggingTab(name); }} onDragOver={(event) => { if (name !== '总表' && draggingTab) event.preventDefault(); }} onDrop={(event) => { event.preventDefault(); if (name !== '总表') reorderTabs(draggingTab, name); setDraggingTab(''); setDragReadyTab(''); }} onDragEnd={() => { setDraggingTab(''); setDragReadyTab(''); }}>{name}</button>)}</nav>}
    <div className="grid gap-4 overflow-y-auto pb-4">
      {!embedded && <section className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-paper px-3 py-2.5"><Metric label={tab === '总表' ? '资料文件' : `${tab}文件`} value={shown.length} cls="text-accent" /><Metric label="有效" value={valid} cls="text-ok" /><Metric label="无效" value={invalid} cls="text-danger" /></section>}
      <section className="card"><div className="card-body grid gap-3">
        <div className="grid grid-cols-[repeat(6,minmax(0,1fr))_minmax(150px,1.35fr)_auto] items-center gap-2">
          <SearchSelect value={filters.material} onChange={(material) => setFilters((v) => ({...v,material,type:''}))} label="资料类型" options={typeOptions} />
          <SearchSelect value={filters.type} onChange={(type) => setFilters((v) => ({...v,type}))} label="文件类型" options={parameters.filter((item) => !filters.material || item.material_type === filters.material).map((item) => [item.id,item.file_type])} />
          <SearchSelect value={filters.brand} onChange={(brand) => setFilters((v) => ({...v,brand}))} label="品牌" options={brands.map((item) => [item.id,item.name])} />
          <SearchSelect value={filters.client} onChange={(client) => setFilters((v) => ({...v,client}))} label="客户型号" options={models.filter((item) => item.client_model).map((item) => [item.id,item.client_model])} />
          <SearchSelect value={filters.skyworth} onChange={(skyworth) => setFilters((v) => ({...v,skyworth}))} label="创维型号" options={models.filter((item) => item.skyworth_model).map((item) => [item.id,item.skyworth_model])} />
          <SearchSelect value={filters.status} onChange={(status) => setFilters((v) => ({...v,status}))} label="状态" options={[['valid','有效'],['invalid','无效']]} />
          <label className="relative min-w-0"><Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" /><input className="input-lite w-full pl-8" value={filters.keyword} onChange={(event) => setFilters((value) => ({...value,keyword:event.target.value}))} placeholder="模糊搜索" /></label>
          <button className="btn shrink-0 !px-2.5" onClick={() => setFilters(EMPTY_FILTERS)}><RotateCcw size={14}/>重置</button>
        </div>
        <div className="flex flex-wrap items-center gap-2"><div ref={uploadAnchor} className="relative"><button className="btn btn-primary !px-3" onClick={openUploadMenu}><Plus size={15}/>上传文件<ChevronDown size={14}/></button></div>
        <button className="btn !px-2.5" disabled={!selected.size} onClick={() => void remove([...selected])}><Trash2 size={14}/>删除</button><button className="btn !px-2.5" disabled={!selected.size} onClick={() => Promise.all(items.filter((item) => selected.has(item.id)).map((item) => openInShell(item.archive_path)))}><Download size={14}/>下载</button><span className="ml-auto text-xs text-ink-3">{rows.length} 个文件 · 已选 {selected.size} · 拖动表头边缘可调整列宽</span></div>
      </div><div className="overflow-x-auto"><table className="table" style={{minWidth:Object.values(widths).reduce((a,b) => a+b,0),tableLayout:'fixed'}}><colgroup>{Object.entries(widths).map(([key,width]) => <col key={key} style={{width}} />)}</colgroup>
        <thead><tr><ResizableTh colKey="check" width={widths.check} onWidthChange={(width) => setWidth('check',width)} onWidthCommit={saveTableWidths}><input type="checkbox" checked={rows.length > 0 && selected.size === rows.length} onChange={(e) => setSelected(e.target.checked ? new Set(rows.map((item) => item.id)) : new Set())} /></ResizableTh>{([['seq','序号'],['material','资料类型'],['type','文件类型'],['name','文件名'],['brand','品牌'],['client','客户型号'],['skyworth','创维型号'],['date','更新日期'],['status','状态'],['ops','操作']] as const).map(([key,label]) => <ResizableTh key={key} colKey={key} width={widths[key]} onWidthChange={(width) => setWidth(key,width)} onWidthCommit={saveTableWidths} align={key === 'name' ? 'left':'center'}>{label}</ResizableTh>)}</tr></thead>
        <tbody>{rows.length === 0 ? <tr><td colSpan={11} className="py-10 text-center text-ink-3">暂无资料文件，使用“上传文件”新建一行</td></tr> : rows.map((row) => <FileRow key={row.id} row={row} parameters={parameters} brands={brands} models={models} selected={selected} onSelected={setSelected} onDraft={patchPending} onDelete={() => void remove([row.id])} onView={() => !row.id.startsWith('draft-') && setPreview(row as MaterialFileRow)} onLocate={() => !row.id.startsWith('draft-') && void openInShell(parentFolder((row as MaterialFileRow).archive_path))} onPatch={async (patch) => { await updateMaterialFile(row.id,patch); await refresh(); }} />)}</tbody>
      </table></div></section>
    </div>{menuOpen && uploadMenu && createPortal(<div className="fixed z-[100] w-48 overflow-hidden rounded-lg border border-line bg-canvas py-1 shadow-lg" style={{left:uploadMenu.left,top:uploadMenu.top}}><button className="w-full px-3 py-2 text-left text-sm hover:bg-paper" onClick={() => void chooseFiles('end')}>在末尾新增</button><button className="w-full px-3 py-2 text-left text-sm hover:bg-paper disabled:text-ink-4" disabled={!selected.size} onClick={() => void chooseFiles('above')}>在选中行上方插入</button><button className="w-full px-3 py-2 text-left text-sm hover:bg-paper disabled:text-ink-4" disabled={!selected.size} onClick={() => void chooseFiles('below')}>在选中行下方插入</button></div>, document.body)}{preview && <MaterialPreviewModal file={preview} onClose={() => setPreview(null)} />}
  </div>;
}

function Metric({label,value,cls}:{label:string;value:number;cls:string}) { return <div className="flex items-baseline gap-2 rounded-lg px-3 py-1.5"><span className="text-sm font-medium text-ink-3">{label}</span><b className={`num text-xl font-semibold leading-none ${cls}`}>{value}</b></div>; }

function SearchSelect({value,onChange,label,options,borderless=false,variant='default'}:{value:string;onChange:(value:string)=>void;label:string;options:Option[];borderless?:boolean;variant?:'default'|'material'|'file'|'status'}) {
  const [query, setQuery] = useState(''); const [open, setOpen] = useState(false); const blur = useRef<number>(); const anchor = useRef<HTMLDivElement>(null); const [menu, setMenu] = useState<{top:number;left:number;width:number}>(); const selected = options.find(([id]) => id === value)?.[1] ?? '';
  const placeMenu = () => { const rect = anchor.current?.getBoundingClientRect(); if (!rect) return; const height = Math.min(208, Math.max(40, (options.length + 1) * 32)); const showAbove = rect.bottom + 6 + height > window.innerHeight && rect.top > height; setMenu({ left:rect.left, top:showAbove ? rect.top - height - 4 : rect.bottom + 4, width:Math.max(rect.width, 132) }); };
  useEffect(() => { if (!open) setQuery(selected); }, [selected, open]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (!open) return; const update = () => placeMenu(); window.addEventListener('resize', update); window.addEventListener('scroll', update, true); return () => { window.removeEventListener('resize', update); window.removeEventListener('scroll', update, true); }; }, [open, options.length]);
  const visible = options.filter(([, name]) => name.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const style = borderless ? `w-full border-0 bg-transparent px-1.5 py-1 text-center shadow-none outline-none ${variant === 'material' ? 'font-medium text-sky-600' : variant === 'file' ? 'font-medium text-violet-600' : ''}` : 'input-lite w-full'; const statusClass = variant === 'status' && value ? (value === 'valid' ? 'text-ok font-medium' : 'text-danger font-medium') : '';
  const optionsMenu = open && menu && createPortal(<div className="fixed z-[100] max-h-52 overflow-auto rounded-lg border border-line bg-canvas py-1 shadow-lg" style={{top:menu.top,left:menu.left,minWidth:menu.width}}><button type="button" className="block w-full whitespace-nowrap px-3 py-1.5 text-left text-sm text-ink-3 hover:bg-paper" onMouseDown={(event) => event.preventDefault()} onClick={() => { onChange(''); setOpen(false); }}>清除选择</button>{visible.length ? visible.map(([id,name]) => <button type="button" key={id} className="block w-full whitespace-nowrap px-3 py-1.5 text-left text-sm hover:bg-paper" onMouseDown={(event) => event.preventDefault()} onClick={() => { onChange(id); setQuery(name); setOpen(false); }}>{name}</button>) : <span className="block px-3 py-2 text-sm text-ink-3">无匹配选项</span>}</div>, document.body);
  return <div ref={anchor} className="relative min-w-0"><div className={`flex min-w-0 items-center ${statusClass}`}>{variant === 'status' && value && <i className={`mr-1.5 h-2 w-2 shrink-0 rounded-full ${value === 'valid' ? 'bg-ok' : 'bg-danger'}`} />}<input className={`${style} ${statusClass}`} value={open ? query : (selected || query)} placeholder={label} aria-label={label} onFocus={() => { window.clearTimeout(blur.current); setQuery(selected); setOpen(true); placeMenu(); }} onChange={(event) => { setQuery(event.target.value); setOpen(true); placeMenu(); if (!event.target.value) onChange(''); }} onBlur={() => { blur.current = window.setTimeout(() => setOpen(false), 160); }} /></div>{optionsMenu}</div>;
}

function FileRow({row,parameters,brands,models,selected,onSelected,onDraft,onDelete,onView,onLocate,onPatch}:{row:MaterialFileRow|PendingFile;parameters:MaterialFileParameter[];brands:MaterialBrand[];models:MaterialModel[];selected:Set<string>;onSelected:React.Dispatch<React.SetStateAction<Set<string>>>;onDraft:(id:string,patch:Partial<PendingFile>)=>Promise<void>;onDelete:()=>void;onView:()=>void;onLocate:()=>void;onPatch:(patch:Partial<MaterialFileRow>)=>Promise<void>}) {
  const draft = row.id.startsWith('draft-'); const pending = row as PendingFile; const stored = row as MaterialFileRow; const materialTypes = [...new Set(parameters.map((item) => item.material_type))]; const fileTypes = parameters.filter((item) => item.material_type === row.material_type); const change = (patch:Partial<PendingFile>) => draft ? void onDraft(row.id,patch) : void onPatch(patch as Partial<MaterialFileRow>);
  // 已归档文件切换资料类型时必须同时给出一个同类文件类型，避免任何瞬间形成非法关联。
  const changeMaterialType = (material_type: string) => change({ material_type, file_parameter_id: draft ? '' : (parameters.find((item) => item.material_type === material_type)?.id ?? '') });
  return <tr className={draft ? 'bg-accent-tint/30' : ''}><td><input type="checkbox" checked={selected.has(row.id)} onChange={(e) => onSelected((current) => { const next = new Set(current); if (e.target.checked) next.add(row.id); else next.delete(row.id); return next; })} /></td><td>{draft ? pending.seq : stored.seq_no}</td><td><SearchSelect borderless variant="material" value={row.material_type} onChange={changeMaterialType} label="请选择" options={materialTypes.map((name) => [name,name])} /></td><td><SearchSelect borderless variant="file" value={row.file_parameter_id} onChange={(file_parameter_id) => change({file_parameter_id})} label="请选择" options={fileTypes.map((item) => [item.id,item.file_type])} /></td><td className="!text-left"><span className="inline-flex max-w-full items-center gap-2"><FileFormatIcon name={draft ? pending.originalName : stored.original_name} /><span className="truncate" title={draft ? pending.originalName : stored.original_name}>{draft ? pending.originalName : stored.original_name}</span></span></td><td><SearchSelect borderless value={row.brand_id ?? ''} onChange={(brand_id) => change({brand_id:brand_id || null})} label="—" options={brands.map((item) => [item.id,item.name])} /></td><td><SearchSelect borderless value={row.client_model_id ?? ''} onChange={(client_model_id) => change({client_model_id:client_model_id || null})} label="—" options={models.filter((item) => item.client_model).map((item) => [item.id,item.client_model])} /></td><td><SearchSelect borderless value={row.skyworth_model_id ?? ''} onChange={(skyworth_model_id) => change({skyworth_model_id:skyworth_model_id || null})} label="—" options={models.filter((item) => item.skyworth_model).map((item) => [item.id,item.skyworth_model])} /></td><td>{draft ? '待归档' : new Date(stored.updated_at).toLocaleDateString()}</td><td><SearchSelect borderless variant="status" value={row.status} onChange={(status) => change({status:status as 'valid'|'invalid'})} label="请选择" options={[['valid','有效'],['invalid','无效']]} /></td><td><div className="flex justify-center gap-1"><button className="icon-btn" disabled={draft} onClick={onView} title="查看（只读）" aria-label="查看（只读）"><Eye size={15}/></button><button className="icon-btn" disabled={draft} onClick={onLocate} title="打开存储文件夹" aria-label="打开存储文件夹"><FolderOpen size={15}/></button><button className="icon-btn text-danger" onClick={onDelete} title="删除" aria-label="删除"><Trash2 size={15}/></button></div></td></tr>;
}

function FileFormatIcon({name}:{name:string}) {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const label = ({xlsx:'XLS',xls:'XLS',xlsm:'XLS',docx:'DOC',doc:'DOC',pptx:'PPT',ppt:'PPT',vsdx:'VSD',zip:'ZIP',rar:'RAR'} as Record<string,string>)[ext] ?? (ext || 'FILE').slice(0,4).toUpperCase();
  const color = ext === 'pdf' ? '#ef4444' : ['xls','xlsx','xlsm','csv'].includes(ext) ? '#22c55e' : ['doc','docx'].includes(ext) ? '#38bdf8' : ['ppt','pptx'].includes(ext) ? '#eab308' : ['vsd','vsdx','dwg'].includes(ext) ? '#f59e0b' : ['zip','rar','7z'].includes(ext) ? '#a78bfa' : '#94a3b8';
  return <span className="grid h-7 w-7 shrink-0 place-items-center rounded-[5px] border bg-transparent text-[11px] font-medium leading-none" style={{borderColor:color,color}}>{label}</span>;
}

function parentFolder(path: string) { const index = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/')); return index > 0 ? path.slice(0, index) : path; }

function MaterialPreviewModal({file,onClose}:{file:MaterialFileRow;onClose:()=>void}) {
  const ext = file.original_name.split('.').pop()?.toLowerCase() ?? '';
  const [loading,setLoading] = useState(true); const [error,setError] = useState(''); const [url,setUrl] = useState('');
  const [text,setText] = useState<TextPreview | null>(null); const [wordHtml,setWordHtml] = useState('');
  const [sheets,setSheets] = useState<{name:string; rows:(string|number)[][]}[]>([]); const [sheet,setSheet] = useState(0);
  const kind = ['png','jpg','jpeg','gif','webp','bmp','svg'].includes(ext) ? 'image' : ext === 'pdf' ? 'pdf' : ['doc','docx'].includes(ext) ? 'word' : ['xls','xlsx','xlsm','csv','tsv'].includes(ext) ? 'excel' : ['txt','md','json','xml','log','yaml','yml','html','js','ts','tsx','css','py','rs','java','go','c','h','cpp','sh'].includes(ext) ? 'text' : 'other';
  useEffect(() => { let cancelled = false; setLoading(true); setError(''); setSheet(0); (async () => { try {
    if (kind === 'text') { const result = await invoke<TextPreview>('read_material_file_text_preview',{path:file.archive_path}); if (!cancelled) setText(result); }
    else if (kind === 'word') { const b64 = await invoke<string>('read_material_file_base64',{path:file.archive_path}); const mammoth = await import('mammoth'); const result = await mammoth.convertToHtml({ arrayBuffer:base64ToArrayBuffer(b64) }); if (!cancelled) setWordHtml(result.value); }
    else if (kind === 'excel') { const b64 = await invoke<string>('read_material_file_base64',{path:file.archive_path}); const XLSX = await import('xlsx'); const book = XLSX.read(base64ToArrayBuffer(b64), {type:'array'}); const data = book.SheetNames.map((name) => ({name,rows:XLSX.utils.sheet_to_json(book.Sheets[name], {header:1,defval:'',blankrows:false}) as (string|number)[][]})); if (!cancelled) setSheets(data); }
    else if (kind !== 'other') { const b64 = await invoke<string>('read_material_file_base64',{path:file.archive_path}); const mime = kind === 'pdf' ? 'application/pdf' : `image/${ext === 'jpg' ? 'jpeg' : ext}`; if (!cancelled) setUrl(`data:${mime};base64,${b64}`); }
  } catch (reason) { if (!cancelled) setError(String(reason)); } finally { if (!cancelled) setLoading(false); } })(); return () => { cancelled = true; }; }, [file.archive_path,kind,ext]);
  const currentSheet = sheets[sheet];
  return <div className="fixed inset-0 z-40 grid place-items-center bg-black/50 px-4" onClick={onClose}><div className="flex h-[86vh] w-[1080px] max-w-[95vw] flex-col overflow-hidden rounded-xl bg-canvas shadow-lg" onClick={(event) => event.stopPropagation()}><header className="flex items-center justify-between border-b border-line px-5 py-3"><div className="min-w-0"><div className="truncate text-[15px] font-semibold">{file.original_name}</div><div className="text-xs text-ink-3">只读预览 · 不会调用电脑软件或修改原文件</div></div><button className="icon-btn" title="关闭" aria-label="关闭" onClick={onClose}><X size={17}/></button></header><main className="flex-1 overflow-auto bg-paper">{loading && <div className="grid h-full place-items-center text-ink-3">正在加载只读预览…</div>}{!loading && error && <div className="p-8 text-danger">读取失败：{error}</div>}{!loading && !error && kind === 'image' && <div className="grid h-full place-items-center p-4"><img src={url} alt={file.original_name} className="max-h-full max-w-full object-contain" /></div>}{!loading && !error && kind === 'pdf' && <iframe src={url} title={file.original_name} className="h-full w-full border-0 bg-white" />}{!loading && !error && kind === 'text' && text && <div className="h-full overflow-auto bg-canvas"><pre className="m-0 whitespace-pre-wrap p-6 font-mono text-[12.5px] leading-6 text-ink">{text.content}</pre>{text.truncated && <div className="sticky bottom-0 border-t border-warn/30 bg-c-warn-bg px-5 py-2 text-xs text-warn">仅显示前 1 MB 内容。</div>}</div>}{!loading && !error && kind === 'word' && <div className="h-full overflow-auto bg-canvas"><div className="prose-word mx-auto max-w-[820px] p-10 text-[14px] leading-7" dangerouslySetInnerHTML={{__html:wordHtml}} /></div>}{!loading && !error && kind === 'excel' && <div className="flex h-full flex-col bg-canvas">{sheets.length > 1 && <div className="flex gap-1 overflow-x-auto border-b border-line bg-band px-3 py-1">{sheets.map((entry,index) => <button key={entry.name} onClick={() => setSheet(index)} className={`whitespace-nowrap rounded-t px-3 py-1.5 text-xs ${sheet === index ? 'bg-canvas font-semibold text-accent' : 'text-ink-3 hover:bg-canvas'}`}>{entry.name}</button>)}</div>}<div className="flex-1 overflow-auto">{currentSheet && <table className="w-max text-xs"><tbody>{currentSheet.rows.map((row,index) => <tr key={index}>{row.map((cell,column) => <td key={column} className="min-w-24 border border-line px-2 py-1 text-ink">{cell}</td>)}</tr>)}</tbody></table>}</div></div>}{!loading && !error && kind === 'other' && <div className="grid h-full place-items-center p-8 text-center text-ink-3"><div><p className="font-medium text-ink-2">该格式暂不支持应用内预览</p><p className="mt-2 text-sm">文件保持只读保护，应用不会使用外部软件打开它。</p></div></div>}</main></div></div>;
}

function base64ToArrayBuffer(value: string): ArrayBuffer { const binary = atob(value); const result = new Uint8Array(binary.length); for (let index = 0; index < binary.length; index += 1) result[index] = binary.charCodeAt(index); return result.buffer; }
