import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { statsDue } from '@/db/srs-dao';
import {
  statsWord, currentStreakDays, newWordsThisWeek, getTodayCheckin, getSetting,
} from '@/db/english-dao';

const QUICKS = [
  { icon: '🔍', label: '查单词',   grad: 'linear-gradient(135deg,#2E5BFF,#6E8CFF)' },
  { icon: '💬', label: '翻译句子', grad: 'linear-gradient(135deg,#10B981,#34D9A5)' },
  { icon: '📖', label: '阅读文章', grad: 'linear-gradient(135deg,#EC4899,#F472B6)' },
  { icon: '⭐', label: '打开单词本', grad: 'linear-gradient(135deg,#8B5CF6,#A78BFA)' },
];

const TASKS = [
  { key: 'review',   icon: '📚', label: '今日复习', desc: 'SRS 间隔算法', color: '#2E5BFF', color2: '#6E8CFF', to: '/english/practice/srs' },
  { key: 'dictation',icon: '🎧', label: '听写训练', desc: '听音拼写 / 看中文写英文', color: '#F59E0B', color2: '#FBBF24', to: '/english/practice/dictation' },
  { key: 'mistakes', icon: '🔥', label: '错词强化', desc: '易忘 / 听写易错', color: '#EF4444', color2: '#F87171', to: '/english/practice/mistakes' },
] as const;

const DEFAULT_DAILY_GOAL = 20;

export function EnglishTodayPage() {
  const nav = useNavigate();
  const [todo, setTodo] = useState({ review: 0, dictation: 0, mistakes: 0 });
  const [wStats, setWStats] = useState({ total: 0, new: 0, learning: 0, mastered: 0, paused: 0 });
  const [streak, setStreak] = useState(0);
  const [weekNew, setWeekNew] = useState(0);
  const [doneToday, setDoneToday] = useState(0);
  const [dailyGoal, setDailyGoal] = useState(DEFAULT_DAILY_GOAL);

  useEffect(() => {
    (async () => {
      try {
        const [d, w, sk, wn, tc, goal] = await Promise.all([
          statsDue(),
          statsWord(),
          currentStreakDays().catch(() => 0),
          newWordsThisWeek().catch(() => 0),
          getTodayCheckin().catch(() => null),
          getSetting('app', 'english.daily_goal').catch(() => null),
        ]);
        setTodo(d);
        setWStats(w);
        setStreak(sk);
        setWeekNew(wn);
        setDoneToday(tc?.reviewed_count ?? 0);
        const g = goal ? parseInt(goal, 10) : NaN;
        setDailyGoal(Number.isFinite(g) && g > 0 ? g : DEFAULT_DAILY_GOAL);
      } catch { /* 未登录或数据库还没就绪 */ }
    })();
  }, []);

  const plannedToday = todo.review + todo.dictation + todo.mistakes;
  const progressPct = dailyGoal > 0 ? Math.min(100, Math.round((doneToday / dailyGoal) * 100)) : 0;

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      {/* 顶部欢迎 */}
      <div className="flex items-end justify-between mb-6">
        <div>
          <div className="serif text-[26px] font-semibold -tracking-[0.02em]">
            早上好，{plannedToday > 0
              ? <>今天还有 <span className="text-accent">{plannedToday - doneToday}</span> 个学习任务</>
              : '开始今天的学习之旅吧'}
          </div>
          <div className="text-ink-3 text-[13px] mt-1">
            连续学习 <span className="num text-accent font-semibold">{streak}</span> 天 · 本周已学 <span className="num font-semibold">{weekNew}</span> 个词
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="text-[11px] text-ink-3 tracking-widest">TODAY</div>
            <div className="num text-[22px] font-semibold">
              {doneToday} <span className="text-ink-4 font-medium">/ {dailyGoal}</span>
            </div>
          </div>
          <div className="ring" style={{
            '--p': `${progressPct}`,
            '--size': '72px',
            background: `conic-gradient(rgb(var(--rgb-accent)) ${progressPct}%, rgb(var(--rgb-sidebar-hover)) 0)`,
          } as React.CSSProperties}>
            <span className="txt text-[13px]">
              {progressPct}%
            </span>
          </div>
        </div>
      </div>

      {/* 三张任务大卡 */}
      <div className="grid grid-cols-3 gap-4 mb-5">
        {TASKS.map((t) => (
          <button
            key={t.key}
            onClick={() => nav(t.to)}
            className="text-left p-6 rounded-2xl shadow-sm relative overflow-hidden hover:-translate-y-0.5 transition-transform"
            style={{ background: `linear-gradient(135deg,#FFFFFF,${hexToBg(t.color)})` }}
          >
            <div
              className="absolute top-4 right-4 w-12 h-12 rounded-2xl grid place-items-center text-white text-2xl"
              style={{ background: `linear-gradient(135deg,${t.color},${t.color2})` }}
            >
              {t.icon}
            </div>
            <div className="text-[13px] text-ink-3 font-medium">{t.label}</div>
            <div className="num text-[44px] font-bold mt-1 -tracking-[0.02em]">
              {(todo as any)[t.key] ?? 0}
            </div>
            <div className="text-[12.5px] text-ink-3 mt-1">{t.desc}</div>
            <div
              className="mt-3 inline-block px-3.5 py-1.5 rounded-lg text-white text-[12.5px] font-semibold"
              style={{ background: t.color }}
            >
              开始 →
            </div>
          </button>
        ))}
      </div>

      {/* 快速入口 + 本周 */}
      <div className="grid gap-4 mb-5" style={{ gridTemplateColumns: '5fr 7fr' }}>
        <div className="card">
          <div className="card-title"><h3>快速入口</h3></div>
          <div className="card-body">
            <div className="grid grid-cols-2 gap-3">
              {QUICKS.map((q) => (
                <button
                  key={q.label}
                  className="card p-4 flex flex-col items-center gap-2 hover:-translate-y-0.5 transition-transform"
                  onClick={() => {
                    if (q.label === '查单词' || q.label === '翻译句子') nav('/english/translate');
                    if (q.label === '打开单词本') nav('/english/wordbook');
                    if (q.label === '阅读文章') nav('/english/reading');
                  }}
                >
                  <div
                    className="w-11 h-11 rounded-xl grid place-items-center text-white text-xl"
                    style={{ background: q.grad }}
                  >
                    {q.icon}
                  </div>
                  <div className="text-[13px] font-medium">{q.label}</div>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-title"><h3>单词本概览</h3><span className="meta">当前账号</span></div>
          <div className="card-body">
            <div className="grid grid-cols-4 gap-3 text-center">
              <div><div className="text-[11px] text-ink-3">总数</div><div className="num text-[22px] font-semibold">{wStats.total}</div></div>
              <div><div className="text-[11px] text-ink-3">新词</div><div className="num text-[22px] font-semibold text-accent">{wStats.new}</div></div>
              <div><div className="text-[11px] text-ink-3">学习中</div><div className="num text-[22px] font-semibold text-warn">{wStats.learning}</div></div>
              <div><div className="text-[11px] text-ink-3">已掌握</div><div className="num text-[22px] font-semibold text-ok">{wStats.mastered}</div></div>
            </div>
          </div>
        </div>
      </div>

      {/* 待加强 */}
      <div className="card">
        <div className="card-title"><h3>待加强</h3><span className="meta">发现问题 · 立即训练</span></div>
        <div className="card-body">
          {todo.mistakes > 0 ? (
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-danger">
                  近 14 天有 {todo.mistakes} 个错词
                </div>
                <div className="text-ink-3 text-xs mt-1">
                  SRS 评"不认识" 或 听写错误的词，建议立即强化
                </div>
              </div>
              <button className="btn btn-primary" onClick={() => nav('/english/practice/mistakes')}>
                开始错词强化 →
              </button>
            </div>
          ) : (
            <div className="text-ink-3 text-sm py-2 text-center">
              近期没有错词，学习状态很好
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function hexToBg(hex: string): string {
  // 简单：把强色映射到极淡背景色
  const map: Record<string, string> = {
    '#2E5BFF': '#EEF3FF',
    '#F59E0B': '#FFF3DC',
    '#EF4444': '#FEECEC',
  };
  return map[hex] ?? '#FFFFFF';
}
