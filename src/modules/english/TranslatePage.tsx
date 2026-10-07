import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Loader2, RefreshCw, Search, Star, Volume2 } from 'lucide-react';
import {
  createOrAppendWord,
  isFavored,
  lemmatizeOfflineDictionary,
  lookupOfflineDictionary,
  prefixOfflineDictionary,
  removeByText,
} from '@/db/english-dao';
import { runTranslate, type TranslationCard, type Direction } from '@/lib/translators-v2';
import { useAccountStore } from '@/stores/account';

interface DictEntry {
  word: string;
  phonetic?: string;
  translation?: string;
  pos?: string;
  tag?: string;
  exchange?: string;
  frq?: number;
}

/** 离线翻译结果：单词、多个词的短语/句子逐词表、或者不支持的提示 */
interface OfflineResult {
  kind: 'word' | 'words' | 'unsupported';
  single?: DictEntry;
  words?: { word: string; entry: DictEntry | null }[];
  message?: string;
}

type Mode = 'auto' | 'en2zh' | 'zh2en';

export function TranslatePage() {
  const currentAccountId = useAccountStore((state) => state.currentAccountId);
  const [text, setText] = useState('');
  const [mode, setMode] = useState<Mode>('auto');
  // 三类勾选
  const [useOffline, setUseOffline] = useState(true);
  const [useEngine, setUseEngine] = useState(true);
  const [useAI, setUseAI] = useState(true);

  const [offline, setOffline] = useState<OfflineResult | null>(null);
  const [cards, setCards] = useState<TranslationCard[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedTip, setSavedTip] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [lemma, setLemma] = useState<string | null>(null);

  function detectMode(t: string): 'en' | 'zh' {
    return /[一-龥]/.test(t) ? 'zh' : 'en';
  }

  // 输入阶段即提供前缀联想；只对单词触发，避免句子输入产生无关请求。
  useEffect(() => {
    const q = text.trim();
    if (!/^[A-Za-z][A-Za-z'-]{1,}$/.test(q)) {
      setSuggestions([]);
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      void prefixOfflineDictionary(q, 8)
        .then((rows) => active && setSuggestions(rows.filter((word) => word.toLowerCase() !== q.toLowerCase())))
        .catch(() => active && setSuggestions([]));
    }, 160);
    return () => { active = false; window.clearTimeout(timer); };
  }, [text]);

  async function handleTranslate(forceRefresh = false, sourceText = text) {
    const q = sourceText.trim();
    if (!q) return;
    setLoading(true);
    setError(null);
    setOffline(null); setCards([]);
    setLemma(null);

    try {
      const detected = mode === 'auto' ? detectMode(q) : mode.startsWith('en') ? 'en' : 'zh';
      const direction: Direction = detected === 'en' ? 'en2zh' : 'zh2en';
      const isSingleWord = detected === 'en' && /^[A-Za-z\-']+$/.test(q);
      const isChineseInput = detected === 'zh';

      const tasks: Promise<any>[] = [];

      // 离线翻译
      if (useOffline) {
        if (isChineseInput) {
          // 反向查询：中文 → 英文单词列表
          tasks.push(
            invoke<DictEntry[]>('ecdict_reverse_lookup', { chinese: q, limit: 8, accountId: currentAccountId }).then((rows) => {
              if (rows && rows.length > 0) {
                setOffline({
                  kind: 'words',
                  words: rows.map((e) => ({ word: e.word, entry: e })),
                });
              } else {
                setOffline({ kind: 'unsupported', message: `离线词典中没有包含「${q}」中文释义的英文词条` });
              }
            }),
          );
        } else if (isSingleWord) {
          tasks.push(
            (async () => {
              const [exact, base] = await Promise.all([
                lookupOfflineDictionary<DictEntry>(q),
                lemmatizeOfflineDictionary(q),
              ]);
              const normalizedBase = base && base.toLowerCase() !== q.toLowerCase() ? base : null;
              const entry = exact ?? (normalizedBase ? await lookupOfflineDictionary<DictEntry>(normalizedBase) : null);
              setLemma(normalizedBase);
              if (entry) {
                setOffline({ kind: 'word', single: entry });
              } else {
                setOffline({ kind: 'unsupported', message: `离线词典未收录「${q}」` });
              }
            })(),
          );
        } else {
          // 英文短语/句子：分词并逐词查
          const words = q.split(/[^A-Za-z\-']+/).filter((w) => w.length >= 2);
          tasks.push((async () => {
            const rows = await Promise.all(
              words.map(async (w) => ({
                word: w,
                entry: await lookupOfflineDictionary<DictEntry>(w),
              })),
            );
            setOffline({ kind: 'words', words: rows });
          })());
        }
      }

      // 引擎/AI 翻译
      if (useEngine || useAI) {
        tasks.push(
          runTranslate({
            text: q, direction,
            enableEngine: useEngine, enableAI: useAI,
            forceRefresh,
          }).then((rs) => setCards(rs)),
        );
      }
      await Promise.all(tasks);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  /**
   * 切换收藏状态：
   * - 未收藏 → 加入单词本，五角星变实心
   * - 已收藏 → 从单词本移除（软删除到回收站），五角星变空心
   * onDone 用于通知调用方刷新按钮状态
   */
  async function toggleWord(
    word: string,
    meaning: string | null,
    phonetic: string | null,
    onDone: (nowFavored: boolean) => void,
  ) {
    const has = await isFavored(word);
    if (has) {
      await removeByText(word);
      onDone(false);
      setSavedTip(`✓ 已取消收藏「${word}」`);
    } else {
      const { created } = await createOrAppendWord({
        word,
        meaning: meaning ?? undefined,
        meaning_context: meaning ?? undefined,
        phonetic_us: phonetic ?? undefined,
        source: 'translate',
      });
      onDone(true);
      setSavedTip(created ? `✓ 已加入单词本` : `✓ 已在单词本 · 追加信息`);
    }
    setTimeout(() => setSavedTip(null), 2000);
  }

  const engineCards = cards.filter((c) => c.category === 'engine');
  const aiCards = cards.filter((c) => c.category === 'ai');
  const anythingSelected = useOffline || useEngine || useAI;

  return (
    <div className="p-6 max-w-[1100px] mx-auto">
      {/* 输入区 */}
      <div className="card mb-4">
        <div className="card-body">
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <select className="input-lite" value={mode} onChange={(e) => setMode(e.target.value as Mode)} style={{ width: 120 }}>
              <option value="auto">自动检测</option>
              <option value="en2zh">英 → 中</option>
              <option value="zh2en">中 → 英</option>
            </select>

            <div className="flex items-center gap-1 ml-2">
              <TypeChip label="离线翻译" color="#8B5CF6" active={useOffline} onClick={() => setUseOffline(!useOffline)} />
              <TypeChip label="引擎翻译" color="#EF4444" active={useEngine} onClick={() => setUseEngine(!useEngine)} />
              <TypeChip label="AI 翻译" color="#2E5BFF" active={useAI} onClick={() => setUseAI(!useAI)} />
            </div>

            <span className="text-xs text-ink-3 ml-2">Ctrl + Enter</span>
            <div className="flex-1" />
            <button className="btn btn-ghost" onClick={() => { setText(''); setLemma(null); setSuggestions([]); }}>清空</button>
            <button className="btn btn-ghost" onClick={() => handleTranslate(true)}
              disabled={loading || !text.trim() || !anythingSelected}
              title="绕过 24 小时缓存，强制重新调用引擎/AI">
              <RefreshCw size={12} /> 强制刷新
            </button>
            <button className="btn btn-primary" onClick={() => handleTranslate(false)}
              disabled={loading || !text.trim() || !anythingSelected}>
              {loading ? <><Loader2 size={12} className="animate-spin" /> 翻译中…</> : <><Search size={12} /> 翻译</>}
            </button>
          </div>
          <textarea rows={3} className="input-lite w-full text-[15px]"
            placeholder="输入单词、短语或句子……"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleTranslate(false); }} />
          {suggestions.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5" aria-label="词典前缀联想">
              <span className="self-center text-[11px] text-ink-3">词典联想</span>
              {suggestions.map((word) => (
                <button
                  key={word}
                  type="button"
                  className="rounded-full border border-line px-2 py-0.5 text-[12px] text-ink-2 hover:border-accent hover:text-accent"
                  onClick={() => { setText(word); setSuggestions([]); void handleTranslate(false, word); }}
                >
                  {word}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="card mb-4 !border !border-danger">
          <div className="card-body text-danger text-sm">{error}</div>
        </div>
      )}
      {savedTip && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-2.5 bg-ok text-white rounded-lg shadow-lg z-30 text-sm">
          {savedTip}
        </div>
      )}

      {/* 离线翻译分区 */}
      {useOffline && offline && (
        <Section title="离线翻译" color="#8B5CF6">
          {lemma && (
            <button
              className="mb-2 rounded-md bg-band px-2.5 py-1 text-[12px] text-ink-2 hover:text-accent"
              onClick={() => { setText(lemma); void handleTranslate(false, lemma); }}
              title="点击查看原形词条"
            >
              词形还原：{text.trim()} → <strong>{lemma}</strong>
            </button>
          )}
          {offline.kind === 'word' && offline.single && (
            <DictCard entry={offline.single}
              onToggle={(cb) => toggleWord(offline.single!.word, offline.single!.translation ?? null, offline.single!.phonetic ?? null, cb)} />
          )}
          {offline.kind === 'words' && offline.words && (
            <WordsGrid words={offline.words}
              onToggle={(w, e, cb) => toggleWord(w, e?.translation ?? null, e?.phonetic ?? null, cb)} />
          )}
          {offline.kind === 'unsupported' && (
            <div className="card">
              <div className="card-body text-ink-3 text-sm text-center py-6">
                {offline.message}
              </div>
            </div>
          )}
        </Section>
      )}

      {/* 引擎翻译分区 */}
      {useEngine && engineCards.length > 0 && (
        <Section title="引擎翻译" color="#EF4444">
          <div className="grid gap-3"
            style={{ gridTemplateColumns: `repeat(${Math.min(engineCards.length, 2)}, 1fr)` }}>
            {engineCards.map((c) => (
              <TransResultCard key={c.instanceId} card={c} />
            ))}
          </div>
        </Section>
      )}

      {/* AI 翻译分区 */}
      {useAI && aiCards.length > 0 && (
        <Section title="AI 翻译" color="#2E5BFF">
          <div className="grid gap-3"
            style={{ gridTemplateColumns: `repeat(${Math.min(aiCards.length, 2)}, 1fr)` }}>
            {aiCards.map((c) => (
              <TransResultCard key={c.instanceId} card={c}
                onKeywordClick={(kw) => { setText(kw); setTimeout(() => handleTranslate(false), 0); }} />
            ))}
          </div>
        </Section>
      )}

      {/* 空态 */}
      {!loading && !error && text.trim() && cards.length === 0 && !offline && anythingSelected && (
        <div className="card">
          <div className="card-body text-ink-3 text-sm text-center py-6">
            没有配置任何启用的翻译实例。前往「设置」页新增引擎或 AI 服务。
          </div>
        </div>
      )}
      {!anythingSelected && (
        <div className="card">
          <div className="card-body text-ink-3 text-sm text-center py-6">
            请至少勾选一种翻译类型
          </div>
        </div>
      )}
    </div>
  );
}

/* -----------------------------------------------------------------------------
 * 分区标题
 * -------------------------------------------------------------------------- */
function Section({ title, color, children }: { title: string; color: string; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <div className="flex items-center gap-2 mb-2">
        <span className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />
        <h2 className="text-[15px] font-bold" style={{ color }}>{title}</h2>
      </div>
      {children}
    </div>
  );
}

/* -----------------------------------------------------------------------------
 * 类型选择胶囊
 * -------------------------------------------------------------------------- */
function TypeChip({ label, color, active, onClick }: {
  label: string; color: string; active: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-2.5 py-1 text-xs rounded-full border transition ${active ? 'text-white' : 'text-ink-3 border-line hover:border-line-strong'}`}
      style={active ? { background: color, borderColor: color } : {}}
    >
      {active ? '✓' : '○'} {label}
    </button>
  );
}

/* -----------------------------------------------------------------------------
 * 单个翻译结果卡（引擎/AI 共用）
 * -------------------------------------------------------------------------- */
function TransResultCard({ card, onKeywordClick }: {
  card: TranslationCard;
  onKeywordClick?: (kw: string) => void;
}) {
  const badgeColor = card.category === 'engine' ? '#EF4444' : '#2E5BFF';
  return (
    <div className="card">
      <div className="card-title">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ background: badgeColor }} />
          <h3 className="!text-[14px]">{card.instanceName}</h3>
          {card.fromCache && (
            <span className="chip !py-0 !px-1.5 text-[10px] bg-band text-ink-3" title="来自 24 小时内的翻译缓存，点击「强制刷新」重新请求">
              缓存
            </span>
          )}
        </div>
        {card.ok
          ? <span className="text-[11px] text-ok">✓</span>
          : <span className="text-[11px] text-danger">✕</span>}
      </div>
      <div className="card-body">
        {!card.ok && (
          <div className="text-[12.5px] text-danger break-all">{card.error || '未知错误'}</div>
        )}
        {card.ok && (
          <>
            {card.formal && (
              <div className="text-[11px] text-ink-3 tracking-widest mb-1">自然表达</div>
            )}
            <div className="text-[14.5px] leading-7">{card.natural}</div>
            {card.formal && (
              <>
                <div className="text-[11px] text-ink-3 tracking-widest mt-3 mb-1">正式表达</div>
                <div className="text-[14.5px] leading-7">{card.formal}</div>
              </>
            )}
            {card.keywords && card.keywords.length > 0 && (
              <>
                <div className="text-[11px] text-ink-3 tracking-widest mt-3 mb-1.5">关键词</div>
                <div className="flex flex-wrap gap-1.5">
                  {card.keywords.map((kw) => (
                    <button key={kw}
                      className="chip !text-[12px] hover:bg-accent hover:text-white transition"
                      onClick={() => onKeywordClick?.(kw)}>
                      {kw}
                    </button>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* -----------------------------------------------------------------------------
 * 字典结果卡（离线翻译）
 * -------------------------------------------------------------------------- */
const POS_LABEL: Record<string, string> = {
  n: '名词', v: '动词', vi: '不及物动词', vt: '及物动词',
  adj: '形容词', a: '形容词', adv: '副词', ad: '副词',
  prep: '介词', conj: '连词', pron: '代词', interj: '感叹词',
  aux: '助动词', num: '数词', art: '冠词', abbr: '缩写',
};
const EXCHANGE_LABEL: Record<string, string> = {
  p: '过去式', d: '过去分词', i: '现在分词', '3': '第三人称单数',
  r: '比较级', t: '最高级', s: '复数', '0': '原型',
};

function parseTranslation(t?: string): { pos: string; text: string }[] {
  if (!t) return [];
  const norm = t.replace(/\\n/g, '\n');
  return norm.split(/\n+/).map((s) => s.trim()).filter(Boolean).map((line) => {
    const m = line.match(/^([a-z]+)\.\s*(.+)$/i);
    if (m) return { pos: m[1].toLowerCase(), text: m[2].trim() };
    return { pos: '', text: line };
  });
}
function parseExchange(e?: string): { key: string; label: string; value: string }[] {
  if (!e) return [];
  return e.split('/').map((seg) => {
    const [tag, val] = seg.split(':');
    if (!tag || !val) return null;
    return { key: tag, label: EXCHANGE_LABEL[tag] ?? tag, value: val };
  }).filter(Boolean) as { key: string; label: string; value: string }[];
}

/** 英文短语/句子的离线翻译：逐词卡片网格 */
function WordsGrid({ words, onToggle }: {
  words: { word: string; entry: DictEntry | null }[];
  onToggle: (w: string, e: DictEntry | null, cb: (fav: boolean) => void) => void;
}) {
  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
      {words.map((w, i) => (
        <WordCell key={`${w.word}-${i}`} word={w.word} entry={w.entry}
          onToggle={(cb) => onToggle(w.word, w.entry, cb)} />
      ))}
    </div>
  );
}

function WordCell({ word, entry, onToggle }: {
  word: string;
  entry: DictEntry | null;
  onToggle: (cb: (fav: boolean) => void) => void;
}) {
  const [fav, setFav] = useState(false);
  useEffect(() => { isFavored(word).then(setFav); }, [word]);
  return (
    <div className="card">
      <div className="card-body p-3">
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="serif text-[15px] font-semibold truncate">{word}</div>
            {entry?.phonetic && <>
              <button className="icon-btn !w-6 !h-6 shrink-0" title="播放读音" onClick={() => speakWord(word)}><Volume2 size={13} /></button>
              <span className="num text-[11px] text-ink-3 shrink-0">/{entry.phonetic}/</span>
            </>}
          </div>
          {entry && <button className={`icon-btn !w-7 !h-7 shrink-0 ${fav ? 'text-warn' : 'text-ink-3 hover:text-accent'}`}
            title={fav ? '取消收藏' : '收藏'} onClick={() => onToggle(setFav)}>
            <Star size={14} fill={fav ? 'currentColor' : 'none'} />
          </button>}
        </div>
        {entry ? (
          <>
            <div className="text-[12.5px] text-ink-2 line-clamp-3 whitespace-pre-line">
              {(entry.translation ?? '').replace(/\\n/g, '\n')}
            </div>
          </>
        ) : (
          <div className="text-[12px] text-ink-4">未收录</div>
        )}
      </div>
    </div>
  );
}

function speakWord(word: string) {
  try {
    const utterance = new SpeechSynthesisUtterance(word);
    utterance.lang = 'en-US';
    window.speechSynthesis.speak(utterance);
  } catch { /* ignore */ }
}

function DictCard({ entry, onToggle }: {
  entry: DictEntry;
  onToggle: (cb: (fav: boolean) => void) => void;
}) {
  const meanings = parseTranslation(entry.translation);
  const exchange = parseExchange(entry.exchange);
  const [fav, setFav] = useState(false);
  useEffect(() => { isFavored(entry.word).then(setFav); }, [entry.word]);
  return (
    <div className="card">
      <div className="card-title">
        <div className="flex items-center gap-3 min-w-0">
          <h3 className="!text-[22px]">{entry.word}</h3>
          <button className="icon-btn !w-7 !h-7 shrink-0" title="播放读音" onClick={() => speakWord(entry.word)}>
            <Volume2 size={14} />
          </button>
          {entry.phonetic && (
            <span className="num text-ink-3 text-[13px] shrink-0">/{entry.phonetic}/</span>
          )}
        </div>
        <button
          className={`btn !py-1 !px-3 text-xs ${fav ? '!bg-warn !border-warn text-white' : 'btn-primary'}`}
          onClick={() => onToggle(setFav)}>
          <Star size={12} fill={fav ? 'currentColor' : 'none'} />
          {fav ? '已收藏' : '快速收藏'}
        </button>
      </div>
      <div className="card-body grid gap-2">
        {meanings.length === 0 && <div className="text-ink-3 text-sm">未找到中文释义</div>}
        {meanings.map((m, i) => (
          <div key={i} className="flex gap-3 items-baseline py-1 border-b border-line/60 last:border-0">
            {m.pos && (
              <span className="chip !min-w-[52px] !justify-center shrink-0"
                style={{ background: 'rgb(var(--rgb-accent-tint))', color: 'rgb(var(--rgb-accent))' }}>
                {POS_LABEL[m.pos] ?? `${m.pos}.`}
              </span>
            )}
            <span className="text-[14.5px] leading-7">{m.text}</span>
          </div>
        ))}
        {exchange.length > 0 && (
          <div className="mt-3 pt-3 border-t border-line">
            <div className="text-[11px] text-ink-3 tracking-widest mb-1.5">词形变化</div>
            <div className="flex flex-wrap gap-2">
              {exchange.map((ex, i) => (
                <span key={i} className="chip !text-[12px]">
                  <span className="text-ink-4 mr-1">{ex.label}</span>
                  <span className="font-medium">{ex.value}</span>
                </span>
              ))}
            </div>
          </div>
        )}
        {entry.tag && (
          <div className="mt-2 text-[11.5px] text-ink-4">
            分级：<span className="num">{entry.tag}</span>
            {entry.frq ? <> · 词频 <span className="num">{entry.frq}</span></> : null}
          </div>
        )}
      </div>
    </div>
  );
}
