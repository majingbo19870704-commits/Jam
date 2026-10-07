// =============================================================================
// SelectionTooltip · 划词翻译浮层
// =============================================================================
//
// 挂在 EnglishShell 顶部，全局监听：
//  1. 鼠标释放后如果有选中文本且是英文单词 → 停留 2s → 弹出小卡
//  2. 卡片显示离线词典查询结果 + 收藏按钮
//  3. 用户点击别处或再次选中不同文本 → 卡片消失
// =============================================================================
import { useEffect, useRef, useState } from 'react';
import { Star, X, Volume2 } from 'lucide-react';
import { createOrAppendWord, isFavored, lookupOfflineDictionary, removeByText } from '@/db/english-dao';

interface DictEntry {
  word: string;
  phonetic?: string;
  translation?: string;
}

interface Position {
  x: number;
  y: number;
}

export function SelectionTooltip() {
  const [text, setText] = useState<string | null>(null);
  const [entry, setEntry] = useState<DictEntry | null>(null);
  const [pos, setPos] = useState<Position | null>(null);
  const [fav, setFav] = useState(false);
  const timerRef = useRef<number | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onMouseUp(e: MouseEvent) {
      // 卡片本身内部的点击不重触发
      if (cardRef.current && cardRef.current.contains(e.target as Node)) return;

      const sel = window.getSelection();
      const raw = sel?.toString().trim() ?? '';
      // 只处理英文单词（≥2 字母，不含空格）
      if (!raw || raw.length < 2 || raw.length > 40 || /\s/.test(raw) || !/^[A-Za-z\-']+$/.test(raw)) {
        return;
      }
      // 记录位置
      const rect = sel!.getRangeAt(0).getBoundingClientRect();
      const p = { x: rect.left + rect.width / 2, y: rect.bottom + 8 };

      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(async () => {
        // 检查在延时期间是否又变了
        if (window.getSelection()?.toString().trim() !== raw) return;
        setText(raw);
        setPos(p);
        setFav(await isFavored(raw));
        try {
          const e = await lookupOfflineDictionary<DictEntry>(raw.toLowerCase());
          setEntry(e);
        } catch { setEntry(null); }
      }, 2000);
    }

    function onSelectionChange() {
      const raw = window.getSelection()?.toString().trim() ?? '';
      // 选择被清空 / 变化到非英文单词，直接隐藏
      if (!raw || /\s/.test(raw) || !/^[A-Za-z\-']+$/.test(raw)) {
        if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
        setText(null);
        setEntry(null);
        setPos(null);
      }
    }

    function onClickOutside(e: MouseEvent) {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) {
        // 点卡片外面关闭
        setText(null); setEntry(null); setPos(null);
      }
    }

    document.addEventListener('mouseup', onMouseUp);
    document.addEventListener('selectionchange', onSelectionChange);
    document.addEventListener('mousedown', onClickOutside);
    return () => {
      document.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('selectionchange', onSelectionChange);
      document.removeEventListener('mousedown', onClickOutside);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  async function toggleFav() {
    if (!text) return;
    if (fav) {
      await removeByText(text);
      setFav(false);
    } else {
      await createOrAppendWord({
        word: text,
        meaning: entry?.translation ?? null,
        meaning_context: entry?.translation ?? null,
        phonetic_us: entry?.phonetic ?? null,
        source: 'selection',
      });
      setFav(true);
    }
  }

  function speak() {
    if (!text) return;
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'en-US';
      window.speechSynthesis.speak(u);
    } catch { /* ignore */ }
  }

  if (!text || !pos) return null;

  // 屏幕边缘防溢出：卡片宽约 300px
  const left = Math.min(Math.max(pos.x - 150, 8), window.innerWidth - 308);
  const top = Math.min(pos.y, window.innerHeight - 200);

  return (
    <div ref={cardRef}
      className="fixed z-50 w-[300px] bg-canvas border border-line rounded-xl shadow-lg animate-fadein"
      style={{ left, top }}>
      <div className="px-3 py-2 border-b border-line flex items-center justify-between gap-2">
        <div className="flex items-baseline gap-2 min-w-0">
          <div className="serif text-[16px] font-semibold truncate">{text}</div>
          {entry?.phonetic && (
            <span className="num text-[11.5px] text-ink-3">/{entry.phonetic}/</span>
          )}
        </div>
        <div className="flex gap-1 shrink-0">
          <button className="icon-btn !w-6 !h-6" onClick={speak} title="播放发音">
            <Volume2 size={13} />
          </button>
          <button className={`icon-btn !w-6 !h-6 ${fav ? '!text-warn' : ''}`}
            onClick={toggleFav} title={fav ? '已收藏（点击取消）' : '快速收藏'}>
            <Star size={13} fill={fav ? 'currentColor' : 'none'} />
          </button>
          <button className="icon-btn !w-6 !h-6" onClick={() => setText(null)}>
            <X size={13} />
          </button>
        </div>
      </div>
      <div className="p-3 text-[12.5px] leading-6 text-ink whitespace-pre-line max-h-[180px] overflow-y-auto">
        {entry?.translation
          ? entry.translation.replace(/\\n/g, '\n')
          : <span className="text-ink-4">离线词典未收录</span>}
      </div>
    </div>
  );
}
