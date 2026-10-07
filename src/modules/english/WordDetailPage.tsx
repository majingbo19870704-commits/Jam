import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Check, Loader2, Pause, Play, Sparkles, Trash2, Volume2 } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import {
  fillWordFromOfflineDictionary, getWord, lookupOfflineDictionary, resolveKind, softDeleteWords, updateWord,
  type LearnStatus, type OfflineDictionaryEntry, type WordCard,
} from '@/db/english-dao';
import { getWordEnrichment, saveWordEnrichment, type WordEnrichment } from '@/db/word-enrichment-dao';
import { enrichExpressionWithAI, enrichWordWithAI } from '@/lib/word-enrichment';
import { localDateKey } from '@/lib/local-date';

const STATUS_META: Record<LearnStatus, { label: string; cls: string }> = {
  new:       { label: '新词',   cls: 'bg-c-blue-bg text-accent' },
  learning:  { label: '学习中', cls: 'bg-c-amber-bg text-warn' },
  mastered:  { label: '已掌握', cls: 'bg-c-green-bg text-ok' },
  paused:    { label: '暂停',   cls: 'bg-band text-ink-3' },
};

interface WordNetEntry {
  word: string;
  synonyms: string[];
  antonyms: string[];
  examples: string[];
}

export function WordDetailPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const location = useLocation();
  const returnView = (location.state as { wordbook?: Record<string, unknown> } | null)?.wordbook;
  const [word, setWord] = useState<WordCard | null>(null);
  const [dictionaryInfo, setDictionaryInfo] = useState<OfflineDictionaryEntry | null>(null);
  const [wordnetInfo, setWordnetInfo] = useState<WordNetEntry | null>(null);
  const [enrichment, setEnrichment] = useState<WordEnrichment | null>(null);
  const [enrichmentLoading, setEnrichmentLoading] = useState(false);
  const [translationLoading, setTranslationLoading] = useState(false);
  const offlineLookupAttempted = useRef(new Set<string>());

  async function load() {
    if (!id) return;
    let w = await getWord(id);
    if (w && resolveKind(w) === 'word' && !offlineLookupAttempted.current.has(w.id)) {
      offlineLookupAttempted.current.add(w.id);
      const entry = await fillWordFromOfflineDictionary(w.id, w.word);
      setDictionaryInfo(entry);
      w = await getWord(id);
    } else if (w && resolveKind(w) !== 'word') {
      setDictionaryInfo(null);
    }
    setWord(w);
    if (w && resolveKind(w) === 'word') await loadEnrichment(w);
    else {
      setWordnetInfo(null);
      setEnrichment(null);
    }
  }
  async function loadEnrichment(item: WordCard) {
    const [offline, cached] = await Promise.all([
      invoke<WordNetEntry | null>('wordnet_lookup', { word: item.word }).catch(() => null),
      getWordEnrichment(item.id).catch(() => null),
    ]);
    setWordnetInfo(offline);
    setEnrichment(cached);
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [id]);

  function returnToWordbook() {
    nav('/english/wordbook', { state: returnView ? { wordbook: returnView } : undefined });
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      nav('/english/wordbook', { state: returnView ? { wordbook: returnView } : undefined });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [nav, returnView]);

  if (!word) return <div className="p-6 text-ink-3">词条不存在或已删除。</div>;
  const itemKind = resolveKind(word);

  function speak(w: string) {
    try {
      const u = new SpeechSynthesisUtterance(w);
      u.lang = 'en-US';
      window.speechSynthesis.speak(u);
    } catch { /* ignore */ }
  }

  async function setStatus(s: LearnStatus) {
    const patch: any = { status: s };
    if (s === 'new' || s === 'learning') {
      patch.next_review_at = localDateKey();
    }
    await updateWord(word!.id, patch);
    await load();
  }

  async function completeWithAI() {
    if (!word || itemKind !== 'word') return;
    setEnrichmentLoading(true);
    try {
      const ai = await enrichWordWithAI(word.word);
      await saveWordEnrichment(word.id, {
        synonyms: uniqueTerms([...(wordnetInfo?.synonyms ?? []), ...ai.synonyms]),
        antonyms: uniqueTerms([...(wordnetInfo?.antonyms ?? []), ...ai.antonyms]),
        root_analysis: ai.rootAnalysis,
        examples: uniqueTerms([...(wordnetInfo?.examples ?? []), ...ai.examples]),
        source: wordnetInfo ? 'mixed' : 'ai',
      });
      await loadEnrichment(word);
    } catch (e) {
      alert(String(e));
    } finally { setEnrichmentLoading(false); }
  }

  async function completeExpressionTranslation() {
    if (!word || itemKind === 'word') return;
    setTranslationLoading(true);
    try {
      const result = await enrichExpressionWithAI(word.word, itemKind);
      await updateWord(word.id, { meaning: result.content, meaning_context: result.content });
      await load();
    } catch (e) {
      alert(String(e));
    } finally { setTranslationLoading(false); }
  }

  return (
    <div className="p-6 max-w-[1200px] mx-auto">
      {/* 面包屑 */}
      <div className="flex items-center gap-2 text-sm text-ink-3 mb-3">
        <button className="hover:text-accent flex items-center gap-1"
          onClick={returnToWordbook}>
          <ArrowLeft size={14} /> 单词本
        </button>
        <span className="text-ink-4">/</span>
        <span className="text-ink font-medium">{word.word}</span>
      </div>

      <div className="grid gap-4" style={{ gridTemplateColumns: '1fr 320px' }}>
        {/* 主内容 */}
        <div>
          {/* Word Card */}
          <div className="card mb-4">
            <div className="card-body">
              <div className="flex items-start justify-between gap-6">
                <div className="min-w-0 flex-1">
                  <div className="serif text-[40px] leading-tight font-semibold -tracking-[0.02em] break-words">{word.word}</div>
                  <div className="flex flex-wrap items-start gap-x-4 gap-y-3 mt-4 text-[14px] text-ink-3">
                    <button className="inline-grid size-7 shrink-0 place-items-center rounded text-accent hover:bg-c-blue-bg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                      type="button" title="播放发音" aria-label="播放发音" onClick={() => speak(word.word)}>
                      <Volume2 size={15} />
                    </button>
                    {itemKind === 'word' ? (
                      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 pt-1">
                        {word.phonetic_uk && <span className="num whitespace-nowrap">英 {word.phonetic_uk}</span>}
                        {word.phonetic_us && <span className="num whitespace-nowrap">美 {word.phonetic_us}</span>}
                        {!word.phonetic_uk && !word.phonetic_us && <span className="text-ink-4">暂无音标</span>}
                      </div>
                    ) : <ExpressionPhonetics text={word.word} />}
                  </div>
                </div>
                <span className={`chip ${STATUS_META[word.status].cls}`} style={{ fontSize: 12.5 }}>
                  {STATUS_META[word.status].label}
                </span>
              </div>

            </div>
          </div>

          {/* 译文 */}
          <div className="card mb-4">
            <div className="card-title">
              <h3>译文</h3>
              {itemKind === 'word' ? <span className="meta">离线词典</span> : (
                <button className="btn !py-1 !px-2.5 text-xs" onClick={completeExpressionTranslation} disabled={translationLoading}>
                  {translationLoading ? <><Loader2 size={12} className="animate-spin" /> 生成中…</> : <><Sparkles size={12} /> AI 补全译文</>}
                </button>
              )}
            </div>
            <div className="card-body">
              {itemKind === 'word' ? (
                <>
                  <div className="text-[14px] leading-7 text-ink-2 whitespace-pre-line">
                    {word.meaning_context ?? word.meaning ?? '离线词典未收录该单词的译文'}
                  </div>
                  {dictionaryInfo && <DictionaryMeta entry={dictionaryInfo} />}
                </>
              ) : (
                <div className="text-[14px] leading-7 text-ink-2 whitespace-pre-line">
                  {word.meaning_context ?? word.meaning ?? '尚未生成学习译文。点击右上角“AI 补全译文”后，翻译、重点词解释和学习提示会保存到本地。'}
                </div>
              )}
            </div>
          </div>

          {itemKind === 'word' && (
            <VocabularyExtensions
              offline={wordnetInfo}
              cached={enrichment}
              loading={enrichmentLoading}
              onComplete={completeWithAI}
            />
          )}

          {/* 备注 */}
          <div className="card">
            <div className="card-title"><h3>备注</h3></div>
            <div className="card-body">
              <textarea rows={3} className="input-lite w-full resize-none"
                placeholder="记下你对这个词的理解、口诀、易错点…"
                defaultValue={word.notes ?? ''}
                onBlur={async (e) => {
                  const v = e.target.value.trim();
                  if (v !== (word.notes ?? '')) {
                    await updateWord(word.id, { notes: v || null });
                    await load();
                  }
                }} />
            </div>
          </div>
        </div>

        {/* 右侧栏 */}
        <div>
          <div className="card mb-4">
            <div className="card-body grid gap-2">
              {word.status !== 'mastered' && (
                <button className="btn justify-center text-ok" onClick={() => setStatus('mastered')}>
                  <Check size={14} /> 标记已掌握
                </button>
              )}
              {word.status === 'mastered' && (
                <button className="btn justify-center" onClick={() => setStatus('learning')}>
                  <Play size={14} /> 重新学习
                </button>
              )}
              {word.status !== 'paused' && (
                <button className="btn justify-center" onClick={() => setStatus('paused')}>
                  <Pause size={14} /> 暂停学习
                </button>
              )}
              {word.status === 'paused' && (
                <button className="btn justify-center" onClick={() => setStatus('learning')}>
                  <Play size={14} /> 恢复学习
                </button>
              )}
              <div className="h-px bg-line my-1" />
              <button className="btn btn-danger justify-center" onClick={async () => {
                if (!confirm('确认删除此词条？')) return;
                await softDeleteWords([word.id]);
                nav('/english/wordbook');
              }}>
                <Trash2 size={14} /> 删除
              </button>
            </div>
          </div>

          <div className="card">
            <div className="card-title"><h3>学习记录</h3><span className="meta">SM-2</span></div>
            <div className="card-body text-[12.5px] grid gap-2">
              <Row label="复习次数" value={String(word.review_count ?? 0)} />
              <Row label="重复次数" value={String(word.repetitions ?? 0)} />
              <Row label="间隔天数" value={String(word.interval_days ?? 1)} />
              <Row label="难度系数" value={String(word.easiness ?? 2.5)} />
              <Row label="下次复习" value={word.next_review_at ?? '—'} />
              <Row label="上次复习" value={word.last_review_at ? new Date(word.last_review_at).toLocaleString() : '—'} />
              <Row label="创建时间" value={new Date(word.created_at).toLocaleString()} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function VocabularyExtensions({ offline, cached, loading, onComplete }: {
  offline: WordNetEntry | null;
  cached: WordEnrichment | null;
  loading: boolean;
  onComplete: () => void;
}) {
  const synonyms = uniqueTerms([...(offline?.synonyms ?? []), ...(cached?.synonyms ?? [])]);
  const antonyms = uniqueTerms([...(offline?.antonyms ?? []), ...(cached?.antonyms ?? [])]);
  const examples = uniqueTerms([...(offline?.examples ?? []), ...(cached?.examples ?? [])]);
  const hasContent = synonyms.length > 0 || antonyms.length > 0 || examples.length > 0 || cached?.root_analysis;
  const source = offline && cached ? 'WordNet + AI 缓存' : offline ? 'WordNet 离线词典' : cached ? 'AI 缓存' : '尚无资料';
  return (
    <div className="card mb-4">
      <div className="card-title flex-wrap gap-y-2">
        <div className="flex items-center gap-2"><h3>词汇扩展</h3><span className="meta">{source}</span></div>
        <button className="btn !py-1 !px-2.5 text-xs" onClick={onComplete} disabled={loading}>
          {loading ? <><Loader2 size={12} className="animate-spin" /> 生成中…</> : <><Sparkles size={12} /> AI 补全</>}
        </button>
      </div>
      <div className="card-body grid gap-5">
        {!hasContent && <div className="text-sm text-ink-3">尚未导入 WordNet。可先到“设置 → 离线翻译”导入，或直接使用 AI 补全。</div>}
        {synonyms.length > 0 && <TermRow label="同义词" terms={synonyms} tone="accent" />}
        {antonyms.length > 0 && <TermRow label="反义词" terms={antonyms} tone="warn" />}
        {cached?.root_analysis && (
          <div>
            <div className="text-[12px] font-medium text-ink-2 mb-1.5">词根分析</div>
            <div className="text-[13px] leading-6 text-ink-2">{cached.root_analysis}</div>
          </div>
        )}
        {examples.length > 0 && (
          <div>
            <div className="text-[12px] font-medium text-ink-2 mb-1.5">例句</div>
            <div className="grid gap-1.5">
              {examples.slice(0, 4).map((example) => <div key={example} className="text-[13px] leading-6 text-ink-2 serif">{example}</div>)}
            </div>
          </div>
        )}
        {!cached?.root_analysis && hasContent && <div className="text-[12px] text-ink-4">WordNet 不提供词根分析；需要时可使用 AI 补全。</div>}
      </div>
    </div>
  );
}

function TermRow({ label, terms, tone }: { label: string; terms: string[]; tone: 'accent' | 'warn' }) {
  const cls = tone === 'accent' ? 'border-accent/30 bg-c-blue-bg text-accent' : 'border-warn/30 bg-c-amber-bg text-warn';
  return (
    <div>
      <div className="text-[12px] font-medium text-ink-2 mb-2">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {terms.slice(0, 12).map((term) => <span key={term} className={`chip border ${cls}`}>{term}</span>)}
      </div>
    </div>
  );
}

function uniqueTerms(items: string[]) {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))];
}

function ExpressionPhonetics({ text }: { text: string }) {
  const [items, setItems] = useState<{ word: string; phonetic: string | null }[] | null>(null);
  useEffect(() => {
    let active = true;
    const words = text.match(/[A-Za-z][A-Za-z'-]*/g)?.slice(0, 16) ?? [];
    if (words.length === 0) { setItems([]); return () => { active = false; }; }
    (async () => {
      const results = await Promise.all(words.map(async (word) => {
        try {
          const entry = await lookupOfflineDictionary<{ phonetic?: string }>(word);
          return { word, phonetic: entry?.phonetic ?? null };
        } catch { return { word, phonetic: null }; }
      }));
      if (active) setItems(results);
    })();
    return () => { active = false; };
  }, [text]);

  if (items === null) return <span className="pt-1 text-ink-4">正在获取音标…</span>;
  const available = items.filter((item) => item.phonetic);
  if (!available.length) return <span className="pt-1 text-ink-4">暂无可用音标</span>;
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-2 pt-1 leading-5">
      {available.map((item, index) => (
        <span key={`${item.word}-${index}`} className="inline-flex gap-1.5 whitespace-nowrap">
          <span className="text-ink">{item.word}</span>
          <span className="num text-ink-3">{item.phonetic}</span>
        </span>
      ))}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between border-b border-line/60 last:border-0 py-1.5">
      <span className="text-ink-3">{label}</span>
      <span className="num">{value}</span>
    </div>
  );
}

const EXCHANGE_LABEL: Record<string, string> = {
  d: '过去分词',
  i: '现在分词',
  p: '过去式',
  '3': '第三人称单数',
  r: '比较级',
  t: '最高级',
  s: '复数',
};
const EXCHANGE_ORDER = ['d', 'i', 'p', '3', 'r', 't', 's'];

function DictionaryMeta({ entry }: { entry: OfflineDictionaryEntry }) {
  const changes = parseExchange(entry.exchange);
  const tag = entry.tag?.trim();
  if (!changes.length && !tag && !entry.frq) return null;
  return (
    <div className="mt-5 pt-4 border-t border-line">
      {changes.length > 0 && (
        <div>
          <div className="text-[12px] font-medium text-ink-2 mb-2">词形变化</div>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {changes.map((change) => (
              <span key={change.key} className="text-[13px] text-ink-2 whitespace-nowrap">
                <span className="text-ink-4 mr-1.5">{change.label}</span>
                <span className="font-medium">{change.value}</span>
              </span>
            ))}
          </div>
        </div>
      )}
      {(tag || entry.frq) && (
        <div className={`${changes.length ? 'mt-4' : ''} text-[12.5px] text-ink-3`}>
          {tag && <>分级：<span className="num text-ink-2">{tag}</span></>}
          {tag && entry.frq ? <span className="mx-2 text-ink-4">·</span> : null}
          {entry.frq ? <>词频 <span className="num text-ink-2">{entry.frq}</span></> : null}
        </div>
      )}
    </div>
  );
}

function parseExchange(value?: string): { key: string; label: string; value: string }[] {
  if (!value) return [];
  const values = new Map<string, string>();
  value.split('/').forEach((item) => {
    const [key, word] = item.split(':');
    if (key && word) values.set(key, word);
  });
  return EXCHANGE_ORDER.filter((key) => values.has(key)).map((key) => ({
    key, label: EXCHANGE_LABEL[key], value: values.get(key)!,
  }));
}
