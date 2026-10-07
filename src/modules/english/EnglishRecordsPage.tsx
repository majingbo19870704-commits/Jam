import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Calendar, Flame, PieChart, TrendingUp } from 'lucide-react';
import { listRecentCheckin, type WordCheckin } from '@/db/english-dao';
import { statsReviewByRating, listRecentActivities, type Activity } from '@/db/srs-dao';

type Range = '7d' | '30d' | '84d';

const RANGE_META: Record<Range, { label: string; days: number }> = {
  '7d':  { label: '近 7 天',  days: 7 },
  '30d': { label: '近 30 天', days: 30 },
  '84d': { label: '近 12 周', days: 84 },
};

const RATING_META: Record<string, { label: string; color: string }> = {
  unknown: { label: '不认识', color: '#EF4444' },
  vague:   { label: '模糊',   color: '#F59E0B' },
  known:   { label: '认识',   color: '#10B981' },
  skip:    { label: '跳过',   color: '#94A3B8' },
};

export function EnglishRecordsPage() {
  const nav = useNavigate();
  const [range, setRange] = useState<Range>('30d');
  const [checkins, setCheckins] = useState<WordCheckin[]>([]);
  const [ratings, setRatings] = useState<Array<{ rating: string; n: number }>>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const days = RANGE_META[range].days;
        const fromDate = daysAgoLocal(days);
        const [c, r, a] = await Promise.all([
          listRecentCheckin(days),
          statsReviewByRating(fromDate),
          listRecentActivities(20),
        ]);
        setCheckins(c);
        setRatings(r);
        setActivities(a);
      } catch (e) {
        console.warn('load records failed:', e);
      } finally { setLoading(false); }
    })();
  }, [range]);

  const summary = useMemo(() => {
    let reviewed = 0, newCnt = 0, days = 0;
    for (const c of checkins) {
      reviewed += c.reviewed_count;
      newCnt += c.new_count;
      if (c.reviewed_count > 0 || c.new_count > 0) days += 1;
    }
    return { reviewed, newCnt, days };
  }, [checkins]);

  return (
    <div className="p-6 max-w-[1200px] mx-auto">
      {/* 顶部工具栏 */}
      <div className="flex items-center gap-3 mb-5">
        <button className="btn btn-ghost" onClick={() => nav('/english')}>
          <ArrowLeft size={14} /> 返回
        </button>
        <h1 className="serif text-[24px] font-semibold flex-1">学习记录</h1>
        <div className="flex gap-1">
          {(Object.entries(RANGE_META) as [Range, typeof RANGE_META[Range]][]).map(([k, v]) => (
            <button key={k}
              className={`px-3 py-1.5 rounded text-sm ${range === k ? 'bg-accent text-white' : 'btn'}`}
              onClick={() => setRange(k)}>{v.label}</button>
          ))}
        </div>
      </div>

      {loading && <div className="p-10 text-center text-ink-3">加载中…</div>}

      {!loading && (
        <>
          {/* 摘要 */}
          <div className="grid grid-cols-3 gap-4 mb-5">
            <SummaryCard color="#2E5BFF" icon={<Flame size={18} />} label="累计学习次数"
              value={summary.reviewed} sub={`${range === '84d' ? '近 12 周' : range === '30d' ? '近 30 天' : '近 7 天'}`} />
            <SummaryCard color="#10B981" icon={<TrendingUp size={18} />} label="新学词数"
              value={summary.newCnt} sub="从新词首次进入学习" />
            <SummaryCard color="#F59E0B" icon={<Calendar size={18} />} label="学习天数"
              value={summary.days} sub="有 reviewed / new 的天数" />
          </div>

          {/* 打卡热力图（12 周） */}
          <div className="card mb-4">
            <div className="card-title">
              <h3>打卡热力</h3><span className="meta">近 12 周（84 天）</span>
            </div>
            <div className="card-body">
              <HeatMap data={checkins} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 mb-4">
            {/* 每日趋势 */}
            <div className="card">
              <div className="card-title">
                <h3>每日趋势</h3><span className="meta">复习 vs 新学</span>
              </div>
              <div className="card-body">
                {checkins.length === 0
                  ? <div className="text-ink-3 text-sm text-center py-6">还没有学习记录</div>
                  : <TrendChart data={checkins} />}
              </div>
            </div>

            {/* 评分分布 */}
            <div className="card">
              <div className="card-title">
                <h3>评分分布</h3>
                <span className="meta"><PieChart size={12} className="inline" /> SRS</span>
              </div>
              <div className="card-body">
                {ratings.length === 0
                  ? <div className="text-ink-3 text-sm text-center py-6">还没有复习记录</div>
                  : <RatingPie data={ratings} />}
              </div>
            </div>
          </div>

          {/* 时间线 */}
          <div className="card">
            <div className="card-title"><h3>最近学习</h3><span className="meta">最新 20 条</span></div>
            <div className="card-body">
              {activities.length === 0
                ? <div className="text-ink-3 text-sm text-center py-6">还没有活动记录</div>
                : (
                  <div className="grid gap-2">
                    {activities.map((a, i) => (
                      <ActivityRow key={i} a={a} onWordClick={(id) => nav(`/english/word/${id}`)} />
                    ))}
                  </div>
                )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function SummaryCard({ color, icon, label, value, sub }: {
  color: string; icon: React.ReactNode; label: string; value: number; sub: string;
}) {
  return (
    <div className="card">
      <div className="card-body p-5">
        <div className="flex items-center gap-2 mb-2 text-ink-3 text-[12.5px]">
          <span className="w-8 h-8 rounded-lg grid place-items-center text-white"
            style={{ background: color }}>{icon}</span>
          {label}
        </div>
        <div className="num text-[32px] font-bold -tracking-[0.02em]">{value}</div>
        <div className="text-[11.5px] text-ink-4 mt-1">{sub}</div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* 热力图（12 周 × 7 天）                                                     */
function HeatMap({ data }: { data: WordCheckin[] }) {
  // 建立日期 → count 索引
  const map = new Map(data.map((c) => [c.checkin_date, c.reviewed_count + c.new_count]));
  const cells: { date: string; count: number }[] = [];
  for (let i = 83; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = fmtLocalDate(d);
    cells.push({ date: key, count: map.get(key) ?? 0 });
  }
  const max = cells.reduce((m, c) => Math.max(m, c.count), 0) || 1;

  // 排成 7 行 × 12 列（周维度）
  return (
    <div className="flex gap-1">
      {Array.from({ length: 12 }, (_, col) => (
        <div key={col} className="flex flex-col gap-1">
          {Array.from({ length: 7 }, (_, row) => {
            const idx = col * 7 + row;
            const cell = cells[idx];
            if (!cell) return <div key={row} className="w-3.5 h-3.5" />;
            const level = cell.count === 0 ? 0 : Math.ceil((cell.count / max) * 4);
            return (
              <div key={row}
                className="w-3.5 h-3.5 rounded-sm"
                title={`${cell.date} · ${cell.count} 次学习`}
                style={{
                  background: level === 0
                    ? 'rgb(var(--rgb-sidebar-hover))'
                    : `rgba(46, 91, 255, ${0.2 + level * 0.2})`,
                }} />
            );
          })}
        </div>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* 趋势折线（纯 SVG）                                                          */
function TrendChart({ data }: { data: WordCheckin[] }) {
  const W = 480, H = 180, PAD = { l: 30, r: 10, t: 12, b: 26 };
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const max = data.reduce((m, d) => Math.max(m, d.reviewed_count, d.new_count), 0) || 1;
  const n = data.length;
  const x = (i: number) => PAD.l + (n === 1 ? iw / 2 : (i / (n - 1)) * iw);
  const y = (v: number) => PAD.t + (1 - v / max) * ih;

  const pathReviewed = data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(d.reviewed_count).toFixed(1)}`).join(' ');
  const pathNew      = data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(d.new_count).toFixed(1)}`).join(' ');

  const ticks = [0, Math.ceil(max / 2), max];

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" className="block">
        {/* Y 轴刻度线 */}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.l} y1={y(t)} x2={W - PAD.r} y2={y(t)}
              stroke="rgb(var(--rgb-line))" strokeDasharray="2 3" />
            <text x={PAD.l - 6} y={y(t) + 3} fontSize="10" textAnchor="end"
              fill="rgb(var(--rgb-ink-3))">{t}</text>
          </g>
        ))}
        {/* 折线 */}
        <path d={pathReviewed} fill="none" stroke="#2E5BFF" strokeWidth="2" />
        <path d={pathNew}      fill="none" stroke="#10B981" strokeWidth="2" strokeDasharray="3 3" />
        {/* 点 */}
        {data.map((d, i) => (
          <g key={i}>
            <circle cx={x(i)} cy={y(d.reviewed_count)} r="2.5" fill="#2E5BFF">
              <title>{d.checkin_date} · 复习 {d.reviewed_count}</title>
            </circle>
            <circle cx={x(i)} cy={y(d.new_count)}      r="2.5" fill="#10B981">
              <title>{d.checkin_date} · 新学 {d.new_count}</title>
            </circle>
          </g>
        ))}
        {/* X 轴稀疏标签 */}
        {data.length > 0 && (
          <>
            <text x={x(0)}          y={H - 8} fontSize="10" fill="rgb(var(--rgb-ink-3))">
              {data[0].checkin_date.slice(5)}
            </text>
            <text x={x(n - 1)} y={H - 8} fontSize="10" textAnchor="end" fill="rgb(var(--rgb-ink-3))">
              {data[n - 1].checkin_date.slice(5)}
            </text>
          </>
        )}
      </svg>
      <div className="flex justify-center gap-4 text-[11.5px] text-ink-3 mt-1">
        <span><span className="inline-block w-3 h-0.5 align-middle mr-1" style={{ background: '#2E5BFF' }} />复习</span>
        <span><span className="inline-block w-3 h-0.5 align-middle mr-1" style={{ background: '#10B981' }} />新学</span>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* 评分饼图（纯 SVG）                                                          */
function RatingPie({ data }: { data: Array<{ rating: string; n: number }> }) {
  const total = data.reduce((s, d) => s + d.n, 0);
  if (total === 0) return null;
  const cx = 90, cy = 90, R = 78;
  let startAngle = -Math.PI / 2;
  const arcs = data.map((d) => {
    const angle = (d.n / total) * Math.PI * 2;
    const end = startAngle + angle;
    const x1 = cx + R * Math.cos(startAngle);
    const y1 = cy + R * Math.sin(startAngle);
    const x2 = cx + R * Math.cos(end);
    const y2 = cy + R * Math.sin(end);
    const large = angle > Math.PI ? 1 : 0;
    const d0 = `M ${cx} ${cy} L ${x1.toFixed(1)} ${y1.toFixed(1)} A ${R} ${R} 0 ${large} 1 ${x2.toFixed(1)} ${y2.toFixed(1)} Z`;
    startAngle = end;
    return { d: d0, item: d, pct: (d.n / total * 100).toFixed(1) };
  });

  return (
    <div className="flex items-center gap-6">
      <svg viewBox="0 0 180 180" width="180" height="180" className="shrink-0">
        {arcs.map((a, i) => (
          <path key={i} d={a.d}
            fill={RATING_META[a.item.rating]?.color ?? '#94A3B8'} stroke="#fff" strokeWidth="2">
            <title>{RATING_META[a.item.rating]?.label ?? a.item.rating}：{a.item.n}（{a.pct}%）</title>
          </path>
        ))}
      </svg>
      <div className="grid gap-1.5 text-[13px]">
        {arcs.map((a, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-sm" style={{ background: RATING_META[a.item.rating]?.color ?? '#94A3B8' }} />
            <span className="w-16">{RATING_META[a.item.rating]?.label ?? a.item.rating}</span>
            <span className="num text-ink-3">{a.item.n}</span>
            <span className="text-ink-4 text-[11.5px]">({a.pct}%)</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* 时间线单行                                                                  */
function ActivityRow({ a, onWordClick }: {
  a: Activity; onWordClick: (id: string) => void;
}) {
  const kindLabel = a.kind === 'srs' ? '复习' : '听写';
  const kindColor = a.kind === 'srs' ? '#2E5BFF' : '#F59E0B';
  const detailLabel: Record<string, string> = {
    unknown: '不认识', vague: '模糊', known: '认识',
    correct: '正确',   wrong: '错误',
  };
  const detailColor =
    a.detail === 'known' || a.detail === 'correct' ? 'text-ok'
    : a.detail === 'unknown' || a.detail === 'wrong' ? 'text-danger'
    : 'text-warn';
  return (
    <div className="flex items-center gap-3 py-1.5 border-b border-line/60 last:border-0">
      <span className="chip !py-0 !px-2 text-[11.5px]"
        style={{ background: `${kindColor}20`, color: kindColor }}>
        {kindLabel}
      </span>
      <button className="serif font-semibold hover:text-accent"
        onClick={() => onWordClick(a.word_id)}>
        {a.word}
      </button>
      <span className={`text-[12.5px] ${detailColor}`}>
        → {detailLabel[a.detail] ?? a.detail}
      </span>
      <span className="flex-1" />
      <span className="text-[11.5px] text-ink-4 num">
        {new Date(a.created_at).toLocaleString()}
      </span>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function fmtLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}
function daysAgoLocal(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - (days - 1));
  return fmtLocalDate(d);
}
