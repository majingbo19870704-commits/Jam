import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, BookMarked, Flame, Headphones } from 'lucide-react';
import { listMistakes } from '@/db/srs-dao';
import type { WordCard } from '@/db/english-dao';

export function MistakesPage() {
  const nav = useNavigate();
  const [items, setItems] = useState<WordCard[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try { setItems(await listMistakes(30)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  return (
    <div className="p-6 max-w-[900px] mx-auto">
      <div className="flex items-center justify-between mb-4">
        <button className="btn btn-ghost" onClick={() => nav('/english/practice')}>
          <ArrowLeft size={14} /> 返回
        </button>
        <div className="serif text-[22px] font-semibold">
          <Flame className="inline text-danger mr-2" size={22} /> 错词强化
        </div>
        <div />
      </div>

      <div className="text-ink-3 text-[13px] mb-4">
        近 14 天 SRS 评"不认识"或听写错误的词，共 <span className="num font-semibold text-danger">{items.length}</span> 个
      </div>

      {loading && <div className="text-center text-ink-3 py-10">加载中…</div>}
      {!loading && items.length === 0 && (
        <div className="card p-10 text-center text-ink-3">
          <Flame size={32} className="mx-auto mb-3 text-ink-4" />
          <div>暂无错词，说明近期学习状态不错</div>
        </div>
      )}
      {items.length > 0 && (
        <>
          <div className="flex gap-3 mb-4">
            <button className="btn btn-primary flex-1 justify-center"
              onClick={() => nav('/english/practice/srs?mode=mistakes')}>
              <BookMarked size={14} /> 对错词开始 SRS 复习
            </button>
            <button className="btn flex-1 justify-center"
              onClick={() => nav('/english/practice/dictation?mode=mistakes')}>
              <Headphones size={14} /> 对错词开始听写
            </button>
          </div>
          <div className="card">
            <table className="table w-full">
              <thead>
                <tr>
                  <th className="w-12">#</th>
                  <th className="!text-left">单词</th>
                  <th className="!text-left">当前语境义</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {items.map((w, i) => (
                  <tr key={w.id}>
                    <td className="num text-ink-3">{i + 1}</td>
                    <td className="!text-left font-semibold cursor-pointer hover:text-accent"
                      onClick={() => nav(`/english/word/${w.id}`)}>{w.word}</td>
                    <td className="!text-left">{w.meaning_context ?? w.meaning ?? '—'}</td>
                    <td>
                      <span className="chip bg-c-amber-bg text-warn">
                        {w.status === 'new' ? '新词' : '学习中'}
                      </span>
                    </td>
                    <td>
                      <button className="btn btn-ghost !py-0.5 !px-2 text-xs text-accent"
                        onClick={() => nav(`/english/word/${w.id}`)}>详情</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
