import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, BookOpen, Plus, Trash2 } from 'lucide-react';
import {
  listDocuments, createDocument, softDeleteDocument,
  type ReadDocument,
} from '@/db/english-dao';

export function EnglishReadingPage() {
  const nav = useNavigate();
  const [docs, setDocs] = useState<ReadDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  async function refresh() {
    setLoading(true);
    try { setDocs(await listDocuments()); }
    finally { setLoading(false); }
  }
  useEffect(() => { refresh(); }, []);

  async function handleDelete(id: string) {
    if (!confirm('确认删除此文档？')) return;
    await softDeleteDocument(id);
    await refresh();
  }

  return (
    <div className="p-6 max-w-[1200px] mx-auto">
      {/* 顶部 */}
      <div className="flex items-center gap-3 mb-5">
        <button className="btn btn-ghost" onClick={() => nav('/english')}>
          <ArrowLeft size={14} /> 返回
        </button>
        <h1 className="serif text-[24px] font-semibold flex-1">阅读文章</h1>
        <button className="btn btn-primary" onClick={() => setCreating(true)}>
          <Plus size={12} /> 粘贴创建
        </button>
      </div>

      {creating && (
        <CreateModal onClose={() => setCreating(false)}
          onCreated={async (d) => { setCreating(false); await refresh(); nav(`/english/reading/${d.id}`); }} />
      )}

      {loading && <div className="p-10 text-center text-ink-3">加载中…</div>}

      {!loading && docs.length === 0 && (
        <div className="card">
          <div className="card-body py-12 text-center text-ink-3">
            <BookOpen className="mx-auto mb-3 text-ink-4" size={40} />
            <div className="mb-2">还没有阅读材料</div>
            <div className="text-[12.5px] text-ink-4">
              粘贴一段英文，点上方"粘贴创建"按钮开始
            </div>
          </div>
        </div>
      )}

      {!loading && docs.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          {docs.map((d) => (
            <div key={d.id} className="card group cursor-pointer hover:-translate-y-0.5 transition-transform"
              onClick={() => nav(`/english/reading/${d.id}`)}>
              <div className="card-body">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <h3 className="serif text-[16px] font-semibold flex-1">
                    {d.title || '(无标题)'}
                  </h3>
                  <button
                    className="opacity-0 group-hover:opacity-100 text-danger hover:bg-c-red-bg rounded p-1 transition"
                    onClick={(e) => { e.stopPropagation(); handleDelete(d.id); }}
                    title="删除">
                    <Trash2 size={14} />
                  </button>
                </div>
                <div className="text-[12.5px] text-ink-3 line-clamp-2 mb-3">
                  {d.content.slice(0, 140)}
                </div>
                <div className="flex items-center gap-3 text-[11.5px] text-ink-4 num">
                  <span>{d.word_count} 词</span>
                  <span>·</span>
                  <span>{new Date(d.updated_at).toLocaleDateString()}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function CreateModal({ onClose, onCreated }: {
  onClose: () => void;
  onCreated: (d: ReadDocument) => void;
}) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!content.trim()) return;
    setBusy(true);
    try {
      const d = await createDocument({
        title: title.trim() || null,
        content: content.trim(),
      });
      onCreated(d);
    } catch (e) {
      alert('创建失败：' + String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-40 grid place-items-center p-6"
      onClick={onClose}>
      <div className="card w-[720px] max-w-full max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}>
        <div className="card-title"><h3>粘贴创建阅读文档</h3></div>
        <div className="card-body grid gap-3 overflow-auto">
          <div>
            <label className="text-[12.5px] text-ink-3 mb-1 block">标题（可选）</label>
            <input className="input-lite w-full" placeholder="如：TED · The Power of Introverts"
              value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <label className="text-[12.5px] text-ink-3 mb-1 block">正文（英文段落，直接粘贴）</label>
            <textarea rows={12}
              className="input-lite w-full text-[14px] serif"
              placeholder="Paste the English article body here…"
              value={content} onChange={(e) => setContent(e.target.value)} />
            <div className="text-[11.5px] text-ink-4 mt-1 text-right num">
              {content.length} 字符
            </div>
          </div>
        </div>
        <div className="border-t border-line p-3 flex justify-end gap-2">
          <button className="btn" onClick={onClose}>取消</button>
          <button className="btn btn-primary" onClick={submit} disabled={busy || !content.trim()}>
            {busy ? '保存中…' : '创建'}
          </button>
        </div>
      </div>
    </div>
  );
}
