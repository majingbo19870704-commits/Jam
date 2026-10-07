import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AlertTriangle, Check, Download, Flame, Library, Plus, RotateCcw, Search, Trash2, Upload, Volume2, ZoomIn } from 'lucide-react';
import { MetricCard } from '@/components/MetricCard';
import { InlineText } from '@/components/inline';
import { ResizableTh } from '@/components/ResizableTh';
import { loadWidths, saveWidths } from '@/lib/column-widths';
import { useTableZoom } from '@/hooks/useTableZoom';
import {
  fillWordFromOfflineDictionary, importWordbookCards, resolveKind, insertBlankWord, listWords, softDeleteWords, statsWord, updateWord,
  type LearnStatus, type WordCard, type ItemKind, type WordbookImportItem,
} from '@/db/english-dao';
import { ChevronDown } from 'lucide-react';
import { listByGroup } from '@/db/param-dao';
import type { ParamOption } from '@/types';
import { listMistakes } from '@/db/srs-dao';
import { localDateKey } from '@/lib/local-date';
import { cell, exportReport, formatImportSummary, optionalDate, optionId, readImportRows } from '@/lib/report-excel';

const STATUS_META: Record<LearnStatus, { label: string; cls: string }> = {
  new:       { label: '新词',   cls: 'bg-c-blue-bg text-accent' },
  learning:  { label: '学习中', cls: 'bg-c-amber-bg text-warn' },
  mastered:  { label: '已掌握', cls: 'bg-c-green-bg text-ok' },
  paused:    { label: '暂停',   cls: 'bg-band text-ink-3' },
};

const KIND_TABS: { key: ItemKind; label: string }[] = [
  { key: 'word', label: '单词' },
  { key: 'phrase', label: '短语' },
  { key: 'sentence', label: '例句' },
];

const DEFAULT_WIDTHS: Record<string, number> = {
  check: 16, seq: 56, type: 96, word: 240, phonetic: 140, meaning: 320,
  status: 88, next: 96, ops: 100,
};

interface WordbookViewState {
  kind: ItemKind;
  statusFilter: LearnStatus | '';
  typeFilter: string;
  keyword: string;
  wordId?: string;
}

export function WordbookPage() {
  const nav = useNavigate();
  const location = useLocation();
  const restoreRef = useRef<WordbookViewState | null>(
    (location.state as { wordbook?: WordbookViewState } | null)?.wordbook ?? null,
  );
  const restoredView = restoreRef.current;
  const [items, setItems] = useState<WordCard[]>([]);
  const [types, setTypes] = useState<ParamOption[]>([]);
  const [stats, setStats] = useState({ total: 0, new: 0, learning: 0, mastered: 0, paused: 0, mistakes: 0 });
  const [kind, setKind] = useState<ItemKind>(restoredView?.kind ?? 'word');
  const [statusFilter, setStatusFilter] = useState<LearnStatus | ''>(restoredView?.statusFilter ?? '');
  const [typeFilter, setTypeFilter] = useState<string>(restoredView?.typeFilter ?? '');
  const [keyword, setKeyword] = useState(restoredView?.keyword ?? '');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  const [widthsByKind, setWidthsByKind] = useState<Record<ItemKind, Record<string, number>>>(() => ({
    word: loadWidths('wordbook.word.v1', DEFAULT_WIDTHS),
    phrase: loadWidths('wordbook.phrase.v1', DEFAULT_WIDTHS),
    sentence: loadWidths('wordbook.sentence.v1', DEFAULT_WIDTHS),
  }));
  const widths = widthsByKind[kind];
  const zoomCtl = useTableZoom('wordbook.v2');

  async function refresh() {
    setLoading(true);
    try {
      const [rows, s, ts, mistakes] = await Promise.all([
        listWords({ status: statusFilter || undefined, keyword: keyword.trim() || undefined }),
        statsWord(),
        listByGroup('english_type').catch(() => []),
        listMistakes(999),
      ]);
      setItems(rows);
      setStats({ ...s, mistakes: mistakes.length });
      setTypes(ts);
    } finally { setLoading(false); }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); }, [statusFilter]);

  async function handleDelete(ids: string[]) {
    if (!ids.length) return;
    if (!confirm(`确认删除 ${ids.length} 条？`)) return;
    await softDeleteWords(ids);
    setSelected(new Set());
    await refresh();
  }

  async function changeStatus(id: string, status: LearnStatus) {
    const patch: any = { status };
    if (status === 'new' || status === 'learning') {
      patch.next_review_at = localDateKey();
    }
    await updateWord(id, patch);
    await refresh();
  }

  async function changeType(id: string, typeId: string) {
    // 复用 tags 字段存类型 ID（简单起见），未来可加独立字段
    await updateWord(id, { tags: typeId || null });
    await refresh();
  }

  // 按 tab 过滤 + 类型过滤（用 resolveKind：新建时决定归类，之后不再随文本内容漂移）
  const filteredByKind = items
    .filter((w) => resolveKind(w) === kind)
    .filter((w) => {
      if (!typeFilter) return true;
      if (typeFilter === '__none__') return !w.tags;
      return w.tags === typeFilter;
    });

  useEffect(() => {
    const wordId = restoreRef.current?.wordId;
    if (loading || !wordId) return;
    window.setTimeout(() => document.getElementById(`word-row-${wordId}`)?.scrollIntoView({ block: 'center' }), 0);
    restoreRef.current = null;
  }, [loading, filteredByKind.length]);

  function setColWidth(k: string, w: number) {
    setWidthsByKind((old) => ({ ...old, [kind]: { ...old[kind], [k]: w } }));
  }
  function commitColWidths() { saveWidths(`wordbook.${kind}.v1`, widths); }
  const totalWidth = Object.values(widths).reduce((a, b) => a + b, 0);

  async function saveWordText(id: string, oldValue: string, value: string) {
    const next = value.trim();
    if (!next || next === oldValue) return;
    await updateWord(id, { word: next });
    await fillWordFromOfflineDictionary(id, next);
    await refresh();
  }

  async function handleExport(template = false) {
    const kindLabel = KIND_TABS.find((tab) => tab.key === kind)?.label ?? '词条';
    const ok = await exportReport({
      title: `${kindLabel}单词本`,
      fileStem: template ? `${kindLabel}导入模板` : `${kindLabel}单词本`,
      rows: template ? [] : filteredByKind,
      columns: [
        { title: COL_LABEL.word[kind], value: (item: WordCard) => item.word, width: kind === 'sentence' ? 44 : 28 },
        { title: '类型', value: (item: WordCard) => item.tags ? (types.find((type) => type.id === item.tags)?.name ?? item.tags) : '', width: 14 },
        { title: COL_LABEL.phonetic[kind], value: (item: WordCard) => item.phonetic_uk ?? item.phonetic_us, width: 18 },
        { title: '译文', value: (item: WordCard) => item.meaning_context ?? item.meaning, width: 38 },
        { title: '状态', value: (item: WordCard) => STATUS_META[item.status].label, width: 12 },
        { title: '下次复习', value: (item: WordCard) => item.next_review_at, width: 14 },
        { title: '备注', value: (item: WordCard) => item.notes, width: 28 },
      ],
    });
    if (ok) alert(template ? `已生成${kindLabel}导入模板。` : `已导出 ${filteredByKind.length} 条${kindLabel}。`);
  }

  async function handleImport() {
    try {
      const rows = await readImportRows();
      if (!rows) return;
      const kindLabel = COL_LABEL.word[kind];
      const phoneticLabel = COL_LABEL.phonetic[kind];
      const errors: string[] = [];
      const candidates: WordbookImportItem[] = [];
      for (const { rowNo, values } of rows) {
        const word = cell(values, kindLabel);
        const typeValue = cell(values, '类型');
        const typeId = optionId(typeValue, types);
        const statusValue = cell(values, '状态');
        const status = ({ 新词: 'new', 学习中: 'learning', 已掌握: 'mastered', 暂停: 'paused', new: 'new', learning: 'learning', mastered: 'mastered', paused: 'paused' } as Record<string, LearnStatus>)[statusValue] ?? (statusValue ? undefined : 'new');
        const nextRaw = cell(values, '下次复习');
        const nextReview = optionalDate(nextRaw);
        if (!word || (typeValue && !typeId) || !status || (nextRaw && !nextReview)) {
          errors.push(`第 ${rowNo} 行：${!word ? `${kindLabel}不能为空` : typeValue && !typeId ? '类型无效' : !status ? '状态无效' : '下次复习日期无效'}`);
          continue;
        }
        candidates.push({
          word, kind, tags: typeId ?? null, phonetic: cell(values, phoneticLabel) || null,
          meaning: cell(values, '译文') || null, status, next_review_at: nextReview,
          notes: cell(values, '备注') || null,
        });
      }
      if (!candidates.length) {
        alert(formatImportSummary(0, errors));
        return;
      }
      const result = await importWordbookCards(candidates);
      await refresh();
      setSelected(new Set());
      const duplicateMessage = result.skipped ? `重复内容跳过 ${result.skipped} 条。` : '';
      alert([formatImportSummary(result.created, errors), duplicateMessage].filter(Boolean).join('\n\n'));
    } catch (error) {
      alert(`导入失败：${String(error)}`);
    }
  }

  function openWordDetail(wordId: string) {
    nav(`/english/word/${wordId}`, {
      state: { wordbook: { kind, statusFilter, typeFilter, keyword, wordId } satisfies WordbookViewState },
    });
  }

  return (
    <div className="p-6 max-w-[1600px] mx-auto">
      {/* 顶部数据卡 */}
      <div className="grid grid-cols-4 gap-4 mb-5">
        <MetricCard color="blue" icon={<Library size={20} />} label="总词数"
          value={<span className="num">{stats.total}</span>} delta="当前账号" />
        <MetricCard color="amber" icon={<Flame size={20} />} label="学习中"
          value={<span className="num">{stats.learning}</span>}
          delta={stats.total ? `占比 ${Math.round(stats.learning / stats.total * 100)}%` : '—'} />
        <MetricCard color="green" icon={<Check size={20} />} label="已掌握"
          value={<span className="num">{stats.mastered}</span>}
          delta={stats.total ? `占比 ${Math.round(stats.mastered / stats.total * 100)}%` : '—'} deltaTone="up" />
        <MetricCard color="red" icon={<AlertTriangle size={20} />} label="错词强化"
          value={<span className="num text-danger">{stats.mistakes}</span>}
          delta={stats.mistakes ? '近 14 天需要强化' : '近 14 天无错词'} />
      </div>

      {/* 筛选栏 */}
      <div className="card mb-3">
        <div className="card-body py-3 flex items-center gap-2 flex-wrap">
          <select className="input-lite" value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as LearnStatus | '')}>
            <option value="">全部状态</option>
            <option value="new">新词</option>
            <option value="learning">学习中</option>
            <option value="mastered">已掌握</option>
            <option value="paused">暂停</option>
          </select>
          <select className="input-lite" value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="">全部类型</option>
            <option value="__none__">未指定</option>
            {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <div className="flex items-center gap-2 flex-1 min-w-[240px] px-3 py-1.5 border border-line-strong rounded bg-canvas">
            <Search size={14} className="text-ink-3" />
            <input className="flex-1 outline-none text-sm bg-transparent"
              placeholder="搜索单词、短语、例句、含义…"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && refresh()} />
          </div>
          <button className="btn" onClick={() => { setKeyword(''); setStatusFilter(''); setTypeFilter(''); refresh(); }}>
            <RotateCcw size={12} /> 重置
          </button>
        </div>
      </div>

      {/* 三个 Tab */}
      <div className="flex gap-1 border-b border-line mb-0 bg-canvas px-2 rounded-t-xl">
        {KIND_TABS.map((t) => (
          <button key={t.key}
            onClick={() => { setKind(t.key); setSelected(new Set()); }}
            className={`px-4 py-2.5 text-sm border-b-2 -mb-px transition ${
              kind === t.key
                ? 'border-accent text-accent font-semibold'
                : 'border-transparent text-ink-3 hover:text-ink'
            }`}>
            {t.label}
            <span className="ml-1.5 text-[11px] text-ink-4">
              ({items.filter((w) => resolveKind(w) === t.key).length})
            </span>
          </button>
        ))}
      </div>

      {/* 表格 */}
      <div className="card !rounded-t-none">
        <div className="px-4 py-3 border-b border-line flex items-center gap-2 flex-wrap">
          <AddMenu selected={selected} items={filteredByKind} onDone={refresh}
            setSelected={setSelected} currentKind={kind} />
          <button className="btn" onClick={() => nav('/english/translate')}>
            <Plus size={12} /> 从翻译收藏
          </button>
          <span className="text-xs text-ink-3">
            {filteredByKind.length} 条 · 选中 {selected.size}
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
          <button className="btn btn-danger disabled:opacity-40"
            onClick={() => handleDelete(Array.from(selected))}
            disabled={selected.size === 0}>
            <Trash2 size={12} /> 删除
          </button>
          <button className="btn btn-ghost !px-2" title="Ctrl + 滚轮缩放；点此重置"
            onClick={() => zoomCtl.reset()}>
            <ZoomIn size={12} /> <span className="num text-xs">{Math.round(zoomCtl.zoom * 100)}%</span>
          </button>
        </div>

        <div className="overflow-x-auto" ref={zoomCtl.bindRef}>
          <div style={{
            transform: `scale(${zoomCtl.zoom})`, transformOrigin: '0 0',
            width: totalWidth, marginBottom: `${(zoomCtl.zoom - 1) * -60}px`,
          }}>
            <table className="table" style={{ width: totalWidth, tableLayout: 'fixed' }}>
              <colgroup>
                {Object.entries(widths).map(([k, w]) => <col key={k} style={{ width: w }} />)}
              </colgroup>
              <thead>
                <tr>
                  <ResizableTh colKey="check" width={widths.check}
                    onWidthChange={(w) => setColWidth('check', w)} onWidthCommit={commitColWidths} align="center">
                    <input type="checkbox"
                      checked={selected.size > 0 && selected.size === filteredByKind.length}
                      onChange={(e) => setSelected(e.target.checked
                        ? new Set(filteredByKind.map((i) => i.id)) : new Set())} />
                  </ResizableTh>
                  {(['seq', 'type', 'word', 'phonetic', 'meaning', 'status', 'next', 'ops'] as const).map((k) => (
                    <ResizableTh key={k} colKey={k} width={widths[k]}
                      onWidthChange={(w) => setColWidth(k, w)} onWidthCommit={commitColWidths} align="center">
                      {COL_LABEL[k][kind]}
                    </ResizableTh>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading && <tr><td colSpan={10} className="text-center text-ink-3 py-8">加载中…</td></tr>}
                {!loading && filteredByKind.length === 0 && (
                  <tr><td colSpan={10} className="text-center text-ink-3 py-10">
                    <div className="flex flex-col items-center gap-2">
                      <Library size={28} className="text-ink-4" />
                      <div>
                        {kind === 'word' && '还没有单词，去翻译页查一个词并收藏'}
                        {kind === 'phrase' && '还没有短语，可以从翻译页收藏包含空格的短语'}
                        {kind === 'sentence' && '还没有例句，可以从翻译页收藏完整句子'}
                      </div>
                    </div>
                  </td></tr>
                )}
                {filteredByKind.map((w, i) => (
                  <tr key={w.id} id={`word-row-${w.id}`}>
                    <td>
                      <input type="checkbox" checked={selected.has(w.id)}
                        onChange={(e) => setSelected((s) => {
                          const n = new Set(s);
                          if (e.target.checked) n.add(w.id); else n.delete(w.id);
                          return n;
                        })} />
                    </td>
                    <td className="num text-ink-3">{i + 1}</td>
                    <td>
                      <select className="chip !px-2 border-0 outline-none cursor-pointer"
                        value={w.tags ?? ''}
                        onChange={(e) => changeType(w.id, e.target.value)}>
                        <option value="">未指定</option>
                        {types.map((t) => (
                          <option key={t.id} value={t.id}>{t.name}</option>
                        ))}
                      </select>
                    </td>
                    <td className="!text-left font-semibold">
                      <WordEntryCell
                        value={w.word}
                        openDetail={() => openWordDetail(w.id)}
                        onSave={(value) => saveWordText(w.id, w.word, value)} />
                    </td>
                    <td className="num text-ink-3 text-[12.5px] break-words">
                      <PhoneticCell text={w.word} fallback={w.phonetic_uk || w.phonetic_us} kind={kind} />
                    </td>
                    <td className="!text-left">
                      <InlineText
                        value={w.meaning_context ?? w.meaning ?? ''}
                        onChange={(v) => updateWord(w.id, { meaning_context: v || null }).then(refresh)}
                        placeholder="双击输入..." />
                    </td>
                    <td>
                      <select className={`chip !px-2 border-0 outline-none cursor-pointer ${STATUS_META[w.status].cls}`}
                        value={w.status}
                        onChange={(e) => changeStatus(w.id, e.target.value as LearnStatus)}>
                        <option value="new">新词</option>
                        <option value="learning">学习中</option>
                        <option value="mastered">已掌握</option>
                        <option value="paused">暂停</option>
                      </select>
                    </td>
                    <td className="num text-ink-3">{w.next_review_at ?? '—'}</td>
                    <td>
                      <div className="flex gap-1 justify-center">
                        <button className="btn btn-ghost !py-0.5 !px-2 text-xs text-accent"
                          onClick={() => openWordDetail(w.id)}>详情</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

const COL_LABEL: Record<string, Record<ItemKind, string>> = {
  seq: { word: '序号', phrase: '序号', sentence: '序号' },
  type: { word: '类型', phrase: '类型', sentence: '类型' },
  word: { word: '单词', phrase: '短语', sentence: '例句' },
  phonetic: { word: '音标', phrase: '发音', sentence: '发音' },
  meaning: { word: '译文', phrase: '译文', sentence: '译文' },
  status: { word: '状态', phrase: '状态', sentence: '状态' },
  next: { word: '下次复习', phrase: '下次复习', sentence: '下次复习' },
  ops: { word: '操作', phrase: '操作', sentence: '操作' },
};

/**
 * 词条列的双重交互：单击查看详情，双击保持在表内编辑。
 * 用极短延迟区分 click / dblclick，避免第一下点击抢先跳转页面。
 */
function WordEntryCell({ value, openDetail, onSave }: {
  value: string;
  openDetail?: () => void;
  onSave: (value: string) => Promise<void>;
}) {
  const timer = useRef<number | null>(null);
  const clearPending = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => clearPending, []);

  return (
    <div
      onClick={(event) => {
        if (!openDetail || (event.target as HTMLElement).closest('textarea')) return;
        clearPending();
        timer.current = window.setTimeout(() => { timer.current = null; openDetail(); }, 240);
      }}
      onDoubleClick={(event) => { event.stopPropagation(); clearPending(); }}
    >
      <InlineText value={value} onChange={(next) => { void onSave(next); }} placeholder="双击输入..." />
    </div>
  );
}

/* -----------------------------------------------------------------------------
 * 新增下拉：末尾 / 上方 / 下方
 * -------------------------------------------------------------------------- */
function AddMenu({ selected, items, onDone, setSelected, currentKind }: {
  selected: Set<string>;
  items: WordCard[];
  onDone: () => Promise<void> | void;
  setSelected: (s: Set<string>) => void;
  currentKind: ItemKind;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const on = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', on);
    return () => window.removeEventListener('mousedown', on);
  }, [open]);

  async function addAt(mode: 'end' | 'above' | 'below') {
    setOpen(false);
    let refCreatedAt: string | undefined;
    if (mode !== 'end') {
      if (selected.size !== 1) { alert('请先勾选一行作为参考位置'); return; }
      const targetId = Array.from(selected)[0];
      const target = items.find((i) => i.id === targetId);
      if (!target) return;
      refCreatedAt = target.created_at;
    }
    const created = await insertBlankWord({ anchor: mode, refCreatedAt, kind: currentKind });
    await onDone();
    setSelected(new Set([created.id]));
  }

  return (
    <div className="relative" ref={ref}>
      <button className="btn btn-primary" onClick={() => setOpen((v) => !v)}>
        <Plus size={12} strokeWidth={2.5} /> 新增
        <ChevronDown size={12} />
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 w-44 bg-canvas border border-line rounded-lg shadow-lg py-1 z-20 text-sm">
          <button className="w-full text-left px-3 py-1.5 hover:bg-paper" onClick={() => addAt('end')}>
            在末尾新增
          </button>
          <button className="w-full text-left px-3 py-1.5 hover:bg-paper disabled:opacity-40"
            disabled={selected.size !== 1} onClick={() => addAt('above')}>
            在选中行上方插入
          </button>
          <button className="w-full text-left px-3 py-1.5 hover:bg-paper disabled:opacity-40"
            disabled={selected.size !== 1} onClick={() => addAt('below')}>
            在选中行下方插入
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * 音标单元格：
 *  - 单词显示音标，并在右侧提供播放按钮
 *  - 短语/例句仅提供播放按钮，避免逐词音标挤占列表空间
 */
function PhoneticCell({ text, fallback, kind }: { text: string; fallback: string | null; kind: ItemKind }) {
  if (kind !== 'word') return <PronunciationButton text={text} label="播放发音" />;
  return (
    <div className="inline-flex max-w-full items-center gap-2 text-left">
      <span className="min-w-0 break-all">{fallback || '—'}</span>
      <PronunciationButton text={text} label="播放单词发音" />
    </div>
  );
}

function PronunciationButton({ text, label }: { text: string; label: string }) {
  function speak() {
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'en-US';
      window.speechSynthesis.speak(utterance);
    } catch { /* 浏览器不支持时不打断列表操作 */ }
  }
  return (
    <button className="inline-grid size-6 shrink-0 place-items-center rounded text-accent hover:bg-c-blue-bg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
      type="button" title={label} aria-label={label} onClick={speak}>
      <Volume2 size={14} />
    </button>
  );
}
