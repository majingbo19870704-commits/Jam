import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, Undo2, Volume2 } from 'lucide-react';
import { listDueForReview, listMistakes, rateWord, undoLastRating } from '@/db/srs-dao';
import { previewNextInterval } from '@/lib/srs';
import type { WordCard } from '@/db/english-dao';

type Rating = 'unknown' | 'vague' | 'known';

export function SrsReviewPage() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const mode = params.get('mode'); // null | 'mistakes'
  const isMistakes = mode === 'mistakes';

  const [queue, setQueue] = useState<WordCard[]>([]);
  const [index, setIndex] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [lastRatedId, setLastRatedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [done, setDone] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const rows = isMistakes
        ? await listMistakes(30)
        : await listDueForReview(40);
      setQueue(rows);
      if (rows.length === 0) setDone(true);
    } finally { setLoading(false); }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [isMistakes]);

  const current = queue[index];

  function speak(w: string) {
    try {
      const u = new SpeechSynthesisUtterance(w);
      u.lang = 'en-US';
      window.speechSynthesis.speak(u);
    } catch { /* ignore */ }
  }

  const handleRate = useCallback(async (rating: Rating) => {
    if (!current) return;
    await rateWord(current.id, rating);
    setLastRatedId(current.id);
    if (index + 1 >= queue.length) {
      setDone(true);
    } else {
      setIndex(index + 1);
      setShowAnswer(false);
    }
  }, [current, index, queue.length]);

  const handleSkip = useCallback(() => {
    if (index + 1 >= queue.length) setDone(true);
    else { setIndex(index + 1); setShowAnswer(false); }
  }, [index, queue.length]);

  const handleUndo = useCallback(async () => {
    if (!lastRatedId) return;
    await undoLastRating(lastRatedId);
    setLastRatedId(null);
    // 回退一步：若已完成，回到上一张
    if (done) {
      setDone(false);
      setIndex(Math.max(0, queue.length - 1));
    } else {
      setIndex(Math.max(0, index - 1));
    }
    setShowAnswer(true);
  }, [lastRatedId, done, index, queue.length]);

  // 键盘快捷键
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (done) return;
      if (!showAnswer) {
        if (e.key === ' ' || e.code === 'Space') {
          e.preventDefault(); setShowAnswer(true);
        }
        return;
      }
      if (e.key === '1') handleRate('unknown');
      if (e.key === '2') handleRate('vague');
      if (e.key === '3') handleRate('known');
      if (e.ctrlKey && (e.key === 'z' || e.key === 'Z')) handleUndo();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showAnswer, done, handleRate, handleUndo]);

  if (loading) return <div className="p-10 text-center text-ink-3">加载中…</div>;

  if (done || !current) {
    return (
      <div className="p-8 max-w-[600px] mx-auto text-center">
        <div className="text-6xl mb-4">🎉</div>
        <div className="serif text-[26px] font-semibold mb-2">
          {isMistakes ? '本轮错词已重刷一遍' : '今日复习完成'}
        </div>
        <div className="text-ink-3 mb-8">
          {queue.length > 0
            ? `本次${isMistakes ? '强化' : '复习'} ${queue.length} 个词`
            : (isMistakes ? '近期没有错词，学习状态很好' : '当前没有待复习的词')}
        </div>
        <div className="flex gap-3 justify-center">
          <button className="btn" onClick={() => nav(isMistakes ? '/english/practice/mistakes' : '/english/practice')}>
            {isMistakes ? '返回错词列表' : '返回练习中心'}
          </button>
          <button className="btn btn-primary" onClick={() => nav('/english/wordbook')}>去单词本</button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-[640px] mx-auto">
      {/* 顶部进度 */}
      <div className="flex items-center justify-between mb-3">
        <button className="btn btn-ghost" onClick={() => nav(isMistakes ? '/english/practice/mistakes' : '/english/practice')}>
          <ArrowLeft size={14} /> 退出
        </button>
        <div className="flex items-center gap-3">
          <span className="num text-[15px] font-semibold text-accent">{index + 1}</span>
          <span className="text-ink-3">/ {queue.length}</span>
          <div className="w-40 h-1.5 bg-line rounded-full overflow-hidden">
            <div className="h-full bg-accent transition-all"
              style={{ width: `${((index) / queue.length) * 100}%` }} />
          </div>
        </div>
        <button className="btn btn-ghost" onClick={handleUndo} disabled={!lastRatedId} title="撤销 Ctrl+Z">
          <Undo2 size={14} /> 撤销
        </button>
      </div>

      {/* 错词强化模式提示 */}
      {isMistakes && (
        <div className="mb-4 chip bg-c-red-bg text-danger" style={{ fontSize: 12.5 }}>
          <AlertTriangle size={12} /> 错词强化模式 · 只练近 14 天评过"不认识"或听写错误的词
        </div>
      )}

      {/* 卡片 */}
      <div className="card mb-4">
        <div className="text-center text-ink-3 text-[11.5px] tracking-widest py-3 border-b border-line/60">
          CARD {index + 1} · {current.status === 'new' ? '新词' : '学习中'} ·
          间隔 <span className="num">{current.interval_days ?? 1}</span> 天 ·
          难度 <span className="num">{(current.easiness ?? 2.5).toFixed(2)}</span>
        </div>

        <div className="py-12 px-8 text-center">
          <div className="serif text-[56px] leading-tight font-medium -tracking-[0.02em] break-words">{current.word}</div>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-x-6 gap-y-3">
            {current.phonetic_us && (
              <span className="num text-ink-3 text-[14px] whitespace-nowrap">/{current.phonetic_us}/</span>
            )}
            <button className="btn !py-1.5 !px-4 whitespace-nowrap" onClick={() => speak(current.word)}>
              <Volume2 size={14} /> 播放发音
            </button>
          </div>
        </div>

        {!showAnswer ? (
          <div className="text-center py-6 border-t border-line">
            <button className="btn btn-primary !py-3 !px-12 text-[15px]"
              onClick={() => setShowAnswer(true)}>
              显示答案 <span className="kbd ml-2" style={{ background: 'rgba(255,255,255,0.2)', color: '#fff' }}>Space</span>
            </button>
          </div>
        ) : (
          <>
            <div className="border-t border-line py-6 px-6">
              <div className="serif text-[20px] font-medium">
                {current.meaning_context ?? current.meaning ?? '（未填写释义）'}
              </div>
              {current.example && (
                <div className="mt-3 text-[14px] text-ink-3 italic">{current.example}</div>
              )}
            </div>
            <div className="border-t border-line p-4 grid grid-cols-3 gap-3">
              <RatingBtn tone="unknown" label="不认识"
                interval={previewNextInterval(toState(current), 'unknown')}
                onClick={() => handleRate('unknown')} />
              <RatingBtn tone="vague" label="模糊"
                interval={previewNextInterval(toState(current), 'vague')}
                onClick={() => handleRate('vague')} />
              <RatingBtn tone="known" label="认识"
                interval={previewNextInterval(toState(current), 'known')}
                onClick={() => handleRate('known')} />
            </div>
            <div className="border-t border-line px-4 py-3 flex justify-center gap-4 text-[12px] text-ink-3">
              <button className="hover:text-accent" onClick={handleSkip}>跳过 →</button>
              <span>·</span>
              <a href={`/english/word/${current.id}`} className="hover:text-accent">查看词条</a>
            </div>
          </>
        )}
      </div>

      <div className="text-center text-ink-4 text-[11.5px]">
        <span className="kbd">Space</span> 显示答案 &nbsp;
        <span className="kbd">1</span> 不认识 &nbsp;
        <span className="kbd">2</span> 模糊 &nbsp;
        <span className="kbd">3</span> 认识 &nbsp;
        <span className="kbd">Ctrl Z</span> 撤销
      </div>
    </div>
  );
}

function toState(w: WordCard) {
  return {
    ease: w.easiness ?? 2.5,
    interval_days: w.interval_days ?? 1,
    repetitions: w.repetitions ?? 0,
  };
}

function RatingBtn({ tone, label, interval, onClick }: {
  tone: 'unknown' | 'vague' | 'known';
  label: string; interval: number; onClick: () => void;
}) {
  const styles = {
    unknown: { bg: 'linear-gradient(135deg,#FFFFFF,#FEECEC)', border: 'var(--rgb-danger)', color: 'var(--rgb-danger)' },
    vague:   { bg: 'linear-gradient(135deg,#FFFFFF,#FFF3DC)', border: 'var(--rgb-warn)',   color: 'var(--rgb-warn)' },
    known:   { bg: 'linear-gradient(135deg,#FFFFFF,#E7F7F0)', border: 'var(--rgb-ok)',     color: 'var(--rgb-ok)' },
  }[tone];
  return (
    <button
      onClick={onClick}
      className="p-4 rounded-xl text-center border-2 border-transparent hover:-translate-y-0.5 transition-all"
      style={{ background: styles.bg, borderColor: `rgb(${styles.border} / 0.5)` }}
    >
      <div className="kbd inline-block mb-1.5" style={{ background: 'rgba(0,0,0,0.05)' }}>
        {tone === 'unknown' ? '1' : tone === 'vague' ? '2' : '3'}
      </div>
      <div className="text-[15px] font-semibold" style={{ color: `rgb(${styles.color})` }}>
        {label}
      </div>
      <div className="text-[11.5px] text-ink-3 mt-1">
        {interval === 1 ? '明天再学' : `${interval} 天后复习`}
      </div>
    </button>
  );
}
