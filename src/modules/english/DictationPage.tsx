import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, Check, Flame, Volume2, X } from 'lucide-react';
import { listDueForDictation, listMistakes, logDictation } from '@/db/srs-dao';
import type { WordCard } from '@/db/english-dao';

type Mode = 'listen_spell' | 'cn2en';
type Phase = 'input' | 'result';

export function DictationPage() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const queueMode = params.get('mode'); // null | 'mistakes'
  const isMistakes = queueMode === 'mistakes';

  const [queue, setQueue] = useState<WordCard[]>([]);
  const [index, setIndex] = useState(0);
  const [mode, setMode] = useState<Mode>('listen_spell');
  const [phase, setPhase] = useState<Phase>('input');
  const [input, setInput] = useState('');
  const [correct, setCorrect] = useState(false);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ correct: 0, wrong: 0 });
  const inputRef = useRef<HTMLInputElement>(null);

  async function load() {
    setLoading(true);
    try {
      const rows = isMistakes
        ? await listMistakes(20)
        : await listDueForDictation(20);
      setQueue(rows);
      if (rows.length === 0) setDone(true);
    } finally { setLoading(false); }
  }
  // load 只需要在模式切换时刷新，避免状态更新导致重复加载。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [isMistakes]);

  useEffect(() => {
    if (phase === 'input' && queue.length > 0 && mode === 'listen_spell') {
      // 自动播放一次
      setTimeout(() => speak(queue[index]?.word ?? ''), 200);
    }
    inputRef.current?.focus();
  }, [index, phase, queue, mode]);

  const current = queue[index];

  function speak(w: string) {
    if (!w) return;
    try {
      const u = new SpeechSynthesisUtterance(w);
      u.lang = 'en-US';
      window.speechSynthesis.speak(u);
    } catch { /* ignore */ }
  }

  const submit = useCallback(async () => {
    if (!current || phase !== 'input') return;
    const answer = current.word.trim().toLowerCase();
    const user = input.trim().toLowerCase();
    const isCorrect = answer === user;
    setCorrect(isCorrect);
    setPhase('result');
    setStats((s) => ({ correct: s.correct + (isCorrect ? 1 : 0), wrong: s.wrong + (isCorrect ? 0 : 1) }));
    await logDictation(current.id, mode, input, isCorrect);
  }, [current, input, mode, phase]);

  const next = useCallback(() => {
    if (index + 1 >= queue.length) {
      setDone(true);
    } else {
      setIndex(index + 1);
      setInput('');
      setPhase('input');
    }
  }, [index, queue.length]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Enter') {
        if (phase === 'input') submit();
        else next();
      }
      if (e.key === 'Escape' && phase === 'input') next(); // 跳过
      if (e.key === ' ' && phase === 'input' && mode === 'listen_spell') {
        // 按空格再听一次（避开正在打字时空格）—— 若焦点在 input 内会先加入内容，这里通过修饰键区分
        if (e.ctrlKey) { e.preventDefault(); speak(current?.word ?? ''); }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, submit, next, current, mode]);

  if (loading) return <div className="p-10 text-center text-ink-3">加载中…</div>;

  if (done || !current) {
    return (
      <div className="p-8 max-w-[600px] mx-auto text-center">
        <div className="text-6xl mb-4">🎧</div>
        <div className="serif text-[26px] font-semibold mb-2">
          {isMistakes ? '本轮错词听写完成' : '听写完成'}
        </div>
        <div className="text-ink-3 mb-8">
          {queue.length === 0
            ? (isMistakes ? '近期没有错词，学习状态很好' : '当前没有可听写的词')
            : (
              <>正确 <span className="num text-ok font-bold">{stats.correct}</span> ·
                错误 <span className="num text-danger font-bold ml-1">{stats.wrong}</span></>
            )}
        </div>
        <div className="flex gap-3 justify-center">
          <button className="btn" onClick={() => nav(isMistakes ? '/english/practice/mistakes' : '/english/practice')}>
            {isMistakes ? '返回错词列表' : '返回练习中心'}
          </button>
          {stats.wrong > 0 && !isMistakes && (
            <button className="btn btn-primary"
              onClick={() => nav('/english/practice/mistakes')}>
              <Flame size={14} /> 错词强化
            </button>
          )}
        </div>
      </div>
    );
  }

  const diff = diffChars(current.word, input);

  return (
    <div className="p-6 max-w-[720px] mx-auto">
      {/* 顶部进度 */}
      <div className="flex items-center justify-between mb-3">
        <button className="btn btn-ghost" onClick={() => nav(isMistakes ? '/english/practice/mistakes' : '/english/practice')}>
          <ArrowLeft size={14} /> 退出
        </button>
        <div className="flex items-center gap-3">
          <span className="num text-[15px] font-semibold text-warn">{index + 1}</span>
          <span className="text-ink-3">/ {queue.length}</span>
          <div className="w-40 h-1.5 bg-line rounded-full overflow-hidden">
            <div className="h-full transition-all"
              style={{ width: `${(index / queue.length) * 100}%`, background: 'linear-gradient(90deg,#F59E0B,#FBBF24)' }} />
          </div>
        </div>
        <div className="text-[13px] text-ink-3">
          正 <span className="num text-ok font-bold">{stats.correct}</span>
          &nbsp;错 <span className="num text-danger font-bold">{stats.wrong}</span>
        </div>
      </div>

      {/* 错词强化模式提示 */}
      {isMistakes && (
        <div className="mb-4 chip bg-c-red-bg text-danger" style={{ fontSize: 12.5 }}>
          <AlertTriangle size={12} /> 错词强化模式 · 只听写近 14 天评过"不认识"或听写错误的词
        </div>
      )}

      {/* 模式切换 */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        <ModeBtn active={mode === 'listen_spell'} label="听音拼写" desc="听发音，输入英文"
          onClick={() => setMode('listen_spell')} />
        <ModeBtn active={mode === 'cn2en'} label="看中文写英文" desc="看含义，输入英文"
          onClick={() => setMode('cn2en')} />
      </div>

      {/* 题目 */}
      <div className="card mb-4">
        <div className="card-body p-8 text-center">
          {mode === 'listen_spell' ? (
            <>
              <div className="text-[11.5px] text-ink-3 tracking-widest mb-3">听音拼写</div>
              <button className="btn btn-primary !py-3 !px-8 !text-[16px]"
                onClick={() => speak(current.word)}>
                <Volume2 size={16} /> 播放发音
              </button>
            </>
          ) : (
            <>
              <div className="text-[11.5px] text-ink-3 tracking-widest mb-3">看中文写英文</div>
              <div className="serif text-[24px] font-semibold">
                {current.meaning_context ?? current.meaning ?? '（未填写释义）'}
              </div>
            </>
          )}

          {phase === 'input' ? (
            <div className="mt-8">
              <input
                ref={inputRef}
                className="w-full py-4 px-6 text-center text-[26px] serif border-2 border-line rounded-xl outline-none focus:border-accent"
                placeholder="输入英文…"
                value={input}
                onChange={(e) => setInput(e.target.value)}
              />
              <div className="mt-6 flex gap-3 justify-center">
                <button className="btn btn-ghost" onClick={next}>跳过</button>
                <button className="btn btn-primary !py-2 !px-8" onClick={submit}
                  disabled={!input.trim()}>
                  提交 <span className="kbd ml-2" style={{ background: 'rgba(255,255,255,0.2)', color: '#fff' }}>Enter</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-8">
              {correct ? (
                <div className="text-ok text-[42px] mb-2">
                  <Check className="inline" size={44} />
                </div>
              ) : (
                <div className="text-danger text-[42px] mb-2">
                  <X className="inline" size={44} />
                </div>
              )}
              <div className="serif text-[28px] tracking-wide">
                {diff.map((c, i) => (
                  <span key={i}
                    className={
                      c.type === 'correct' ? 'text-ok' :
                      c.type === 'wrong' ? 'text-danger line-through' :
                      c.type === 'missing' ? 'text-danger border-b-2 border-danger' :
                      'text-ink-4'
                    }
                    style={{ padding: '0 1px' }}>
                    {c.char}
                  </span>
                ))}
              </div>
              {!correct && (
                <div className="text-ink-3 text-[13px] mt-3">
                  你输入：<span className="num">{input || '(空)'}</span>
                </div>
              )}
              <div className="mt-4 p-4 rounded-xl bg-paper text-left">
                <div className="serif text-[16px] font-medium">{current.word}</div>
                {current.phonetic_us && (
                  <div className="text-ink-3 num text-[12px] mt-1">/{current.phonetic_us}/</div>
                )}
                <div className="text-ink-3 text-[13px] mt-2">
                  {current.meaning_context ?? current.meaning ?? ''}
                </div>
              </div>
              <div className="mt-6 flex gap-3 justify-center">
                <button className="btn" onClick={() => speak(current.word)}>
                  <Volume2 size={12} /> 再听一次
                </button>
                <button className="btn btn-primary !py-2 !px-8" onClick={next}>
                  下一题 → <span className="kbd ml-2" style={{ background: 'rgba(255,255,255,0.2)', color: '#fff' }}>Enter</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="text-center text-ink-4 text-[11.5px]">
        <span className="kbd">Enter</span> 提交/下一题 &nbsp;
        <span className="kbd">Esc</span> 跳过 &nbsp;
        <span className="kbd">Ctrl Space</span> 再听
      </div>
    </div>
  );
}

function ModeBtn({ active, label, desc, onClick }: {
  active: boolean; label: string; desc: string; onClick: () => void;
}) {
  return (
    <button onClick={onClick}
      className={`p-4 rounded-xl border-2 flex items-center gap-3 text-left transition ${
        active ? 'border-accent bg-accent-tint' : 'border-line hover:border-line-strong'
      }`}>
      <div className="text-2xl">
        {label === '听音拼写' ? '🎧' : '🇨🇳'}
      </div>
      <div>
        <div className="text-[14px] font-semibold">{label}</div>
        <div className="text-[11.5px] text-ink-3">{desc}</div>
      </div>
    </button>
  );
}

/** 逐字对比：answer vs user，返回带类型的字符列表 */
function diffChars(answer: string, user: string): Array<{ char: string; type: 'correct' | 'wrong' | 'missing' | 'extra' }> {
  const a = answer.toLowerCase();
  const u = user.toLowerCase();
  const out: Array<{ char: string; type: 'correct' | 'wrong' | 'missing' | 'extra' }> = [];
  const len = Math.max(a.length, u.length);
  for (let i = 0; i < len; i++) {
    if (i >= a.length) out.push({ char: u[i], type: 'extra' });
    else if (i >= u.length) out.push({ char: a[i], type: 'missing' });
    else if (a[i] === u[i]) out.push({ char: a[i], type: 'correct' });
    else out.push({ char: a[i], type: 'missing' });
  }
  return out;
}
