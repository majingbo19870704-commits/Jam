import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Save, Trash2 } from 'lucide-react';
import {
  getDocument, updateDocument, softDeleteDocument, listWords,
  type ReadDocument,
} from '@/db/english-dao';

/**
 * 单文档阅读页
 *  - 正文段落用 <p> 渲染，保留换行
 *  - 划词时依赖全局 SelectionTooltip（EnglishShell 已挂）自动弹卡
 *  - 顶栏可修改标题、切换编辑模式（编辑保存正文）
 */
/** 把段落文本按已收藏词集合拆分，返回带高亮标记的片段数组。 */
function highlightParagraph(text: string, wordSet: Set<string>): ReactNode[] {
  if (wordSet.size === 0) return [text];
  // 按单词边界分词，保留空格和标点
  const tokens = text.split(/(\b[a-zA-Z'-]+\b)/g);
  return tokens.map((token, i) => {
    if (wordSet.has(token.toLowerCase())) {
      return (
        <mark
          key={i}
          className="rounded px-0.5"
          style={{ background: 'rgba(46,91,255,0.15)', color: 'inherit' }}
          title={`已收藏词：${token}`}
        >
          {token}
        </mark>
      );
    }
    return token;
  });
}

export function ReadingDocumentPage() {
  const nav = useNavigate();
  const { id } = useParams();
  const [doc, setDoc] = useState<ReadDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [savedWords, setSavedWords] = useState<Set<string>>(new Set());
  const [showHighlight, setShowHighlight] = useState(true);

  async function load() {
    if (!id) return;
    setLoading(true);
    try {
      const [d, words] = await Promise.all([
        getDocument(id),
        listWords(),
      ]);
      setDoc(d);
      setTitle(d?.title ?? '');
      setContent(d?.content ?? '');
      setSavedWords(new Set(words.map((w) => w.word.toLowerCase())));
    } finally { setLoading(false); }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [id]);

  const wordSet = useMemo(
    () => (showHighlight ? savedWords : new Set<string>()),
    [showHighlight, savedWords],
  );

  async function saveTitle() {
    if (!doc) return;
    const t = title.trim() || null;
    if (t === (doc.title ?? null)) return;
    await updateDocument(doc.id, { title: t });
    await load();
  }

  async function saveContent() {
    if (!doc) return;
    if (content === doc.content) { setEditing(false); return; }
    await updateDocument(doc.id, { content });
    setEditing(false);
    await load();
  }

  async function handleDelete() {
    if (!doc) return;
    if (!confirm('确认删除此文档？')) return;
    await softDeleteDocument(doc.id);
    nav('/english/reading');
  }

  if (loading) return <div className="p-10 text-center text-ink-3">加载中…</div>;
  if (!doc) return <div className="p-6 text-ink-3">文档不存在或已删除</div>;

  const paragraphs = doc.content.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);

  return (
    <div className="p-6 max-w-[900px] mx-auto">
      {/* 顶栏 */}
      <div className="flex items-center gap-2 mb-3">
        <button className="btn btn-ghost" onClick={() => nav('/english/reading')}>
          <ArrowLeft size={14} /> 返回列表
        </button>
        <div className="flex-1" />
        <button
          className={`btn ${showHighlight ? 'btn-primary' : ''}`}
          onClick={() => setShowHighlight((v) => !v)}
          title={showHighlight ? '关闭生词高亮' : '开启生词高亮（高亮已收藏单词）'}
        >
          {showHighlight ? '生词高亮 开' : '生词高亮 关'}
        </button>
        {!editing ? (
          <button className="btn" onClick={() => setEditing(true)}>编辑正文</button>
        ) : (
          <button className="btn btn-primary" onClick={saveContent}>
            <Save size={12} /> 保存正文
          </button>
        )}
        <button className="btn btn-danger" onClick={handleDelete}>
          <Trash2 size={12} /> 删除
        </button>
      </div>

      {/* 标题 */}
      <input
        className="input-lite w-full serif text-[26px] font-semibold mb-1 !border-transparent hover:!border-line focus:!border-line-strong"
        placeholder="(无标题) 点这里编辑"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={saveTitle}
      />
      <div className="flex items-center gap-3 text-[11.5px] text-ink-4 num mb-4">
        <span>{doc.word_count} 词</span>
        <span>·</span>
        <span>创建于 {new Date(doc.created_at).toLocaleString()}</span>
      </div>

      {/* 正文 */}
      <div className="card">
        <div className="card-body p-8">
          {editing ? (
            <textarea
              className="w-full outline-none resize-none serif text-[16px] leading-8 bg-transparent"
              rows={Math.max(12, content.split('\n').length + 2)}
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />
          ) : (
            <div className="serif text-[16px] leading-8 text-ink space-y-4 select-text">
              {paragraphs.length === 0
                ? <div className="text-ink-4 italic">（正文为空，点上方"编辑正文"添加内容）</div>
                : paragraphs.map((p, i) => (
                    <p key={i}>{highlightParagraph(p, wordSet)}</p>
                  ))}
            </div>
          )}
        </div>
      </div>

      {!editing && (
        <div className="mt-3 text-[11.5px] text-ink-4 text-center">
          提示：选中英文单词停留 2 秒会弹出词典卡片，可快速收藏到单词本
        </div>
      )}
    </div>
  );
}
