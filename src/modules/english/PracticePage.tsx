import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookMarked, Flame, Headphones } from 'lucide-react';
import { statsDue } from '@/db/srs-dao';

export function PracticePage() {
  const nav = useNavigate();
  const [stats, setStats] = useState({ review: 0, dictation: 0, mistakes: 0 });
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try { setStats(await statsDue()); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  return (
    <div className="p-6 max-w-[1000px] mx-auto">
      <div className="serif text-[24px] font-semibold mb-1">练习中心</div>
      <div className="text-ink-3 text-[13px] mb-6">
        {loading ? '加载中…' :
         stats.review + stats.dictation + stats.mistakes === 0
           ? '今日没有待学习任务，可以自由练习或去翻译页收藏新词'
           : `共 ${stats.review + stats.dictation + stats.mistakes} 个待处理任务`}
      </div>

      <div className="grid grid-cols-3 gap-4">
        <PracticeCard
          color="#2E5BFF" color2="#6E8CFF"
          icon={<BookMarked size={24} />}
          label="今日复习"
          desc="SRS 间隔算法"
          count={stats.review}
          onClick={() => nav('/english/practice/srs')}
        />
        <PracticeCard
          color="#F59E0B" color2="#FBBF24"
          icon={<Headphones size={24} />}
          label="听写训练"
          desc="听音拼写 / 看中文写英文"
          count={stats.dictation}
          onClick={() => nav('/english/practice/dictation')}
        />
        <PracticeCard
          color="#EF4444" color2="#F87171"
          icon={<Flame size={24} />}
          label="错词强化"
          desc="易忘 / 听写易错"
          count={stats.mistakes}
          onClick={() => nav('/english/practice/mistakes')}
        />
      </div>
    </div>
  );
}

function PracticeCard({
  color, color2, icon, label, desc, count, onClick,
}: {
  color: string; color2: string; icon: React.ReactNode;
  label: string; desc: string; count: number; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="text-left p-6 rounded-2xl shadow-sm relative overflow-hidden hover:-translate-y-0.5 transition-transform"
      style={{ background: `linear-gradient(135deg,#FFFFFF,${hexToBg(color)})` }}
    >
      <div
        className="absolute top-4 right-4 w-12 h-12 rounded-2xl grid place-items-center text-white"
        style={{ background: `linear-gradient(135deg,${color},${color2})` }}
      >
        {icon}
      </div>
      <div className="text-[13px] text-ink-3 font-medium">{label}</div>
      <div className="num text-[44px] font-bold mt-1 -tracking-[0.02em]">{count}</div>
      <div className="text-[12.5px] text-ink-3 mt-1">{desc}</div>
      <div className="mt-3 inline-block px-3.5 py-1.5 rounded-lg text-white text-[12.5px] font-semibold"
        style={{ background: color }}>
        开始 →
      </div>
    </button>
  );
}

function hexToBg(hex: string): string {
  const map: Record<string, string> = {
    '#2E5BFF': '#EEF3FF',
    '#F59E0B': '#FFF3DC',
    '#EF4444': '#FEECEC',
  };
  return map[hex] ?? '#FFFFFF';
}
