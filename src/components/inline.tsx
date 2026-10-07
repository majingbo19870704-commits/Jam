// =============================================================================
// components/inline.tsx · 行内编辑通用组件
// 供工作管理、项目管理、四个项目详情面板复用
// =============================================================================
import { useEffect, useRef, useState, type ReactNode } from 'react';

/* 双击文本编辑 */
export function InlineText({
  value, onChange, placeholder, muted = false,
}: { value: string; onChange: (v: string) => void; placeholder?: string; muted?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  if (editing) {
    return (
      <textarea
        autoFocus
        rows={1}
        className="w-full px-1.5 py-0.5 border border-accent rounded bg-canvas outline-none text-[12.5px] resize-none"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { setEditing(false); if (draft !== value) onChange(draft); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); (e.target as HTMLTextAreaElement).blur(); }
          if (e.key === 'Escape') { setDraft(value); setEditing(false); }
        }}
      />
    );
  }
  return (
    <div
      onDoubleClick={() => setEditing(true)}
      className={`min-h-[22px] leading-[22px] cursor-text truncate text-[12.5px] ${!value || muted ? 'text-ink-4' : ''}`}
      title={value}
    >
      {value || placeholder}
    </div>
  );
}

/* 单击弹日历（无图标） */
export function InlineDate({
  value, onChange, display = 'full',
}: { value: string; onChange: (v: string) => void; display?: 'full' | 'md' }) {
  const ref = useRef<HTMLInputElement>(null);
  const show = value ? (display === 'md' ? value.slice(5) : value) : '—';
  return (
    <div
      className="relative w-full h-[22px] cursor-pointer text-center"
      onClick={() => ref.current?.showPicker?.()}
    >
      <span className={`num text-[12.5px] leading-[22px] ${value ? '' : 'text-ink-4'}`}>{show}</span>
      <input
        ref={ref}
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="absolute inset-0 opacity-0 cursor-pointer date-noicon"
        tabIndex={-1}
      />
    </div>
  );
}

/* 单击弹下拉 */
export function InlineSelect<T extends string>({
  value, onChange, options, render,
}: {
  value: T | '';
  onChange: (v: string) => void;
  options: { v: string; label: string }[];
  render: (v: T | '') => ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <select
        autoFocus
        className="w-full px-1 py-0.5 border border-accent rounded bg-canvas outline-none text-[12.5px]"
        value={value}
        onChange={(e) => { onChange(e.target.value); setEditing(false); }}
        onBlur={() => setEditing(false)}
      >
        {options.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
      </select>
    );
  }
  return (
    <div onClick={() => setEditing(true)} className="cursor-pointer min-h-[22px] leading-[22px]">
      {render(value)}
    </div>
  );
}

/* 状态芯片 */
export function StatusChip({ s }: { s: 'new' | 'following' | 'closed' }) {
  const map = {
    new: ['status-new', '新建'],
    following: ['status-follow', '跟进'],
    closed: ['status-closed', '闭环'],
  } as const;
  const [cls, label] = map[s];
  return <span className={`chip ${cls}`}>{label}</span>;
}

/* 优先级芯片 */
export function PriorityChip({ p }: { p: 'high' | 'mid' | 'low' }) {
  const map = { high: ['priority-h', '高'], mid: ['priority-m', '中'], low: ['priority-l', '低'] } as const;
  const [cls, label] = map[p];
  return <span className={`chip ${cls}`}>{label}</span>;
}
