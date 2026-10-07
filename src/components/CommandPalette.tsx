// =============================================================================
// components/CommandPalette.tsx · Ctrl+K 全局命令面板
// =============================================================================
//
// 能力：
//   - 全局快捷键 Ctrl+K / Cmd+K 唤起
//   - 输入即时搜索：工作事项 / 项目 / 快捷链接
//   - `>` 前缀进入命令模式（新建、跳转设置等）
//   - 键盘导航 ↑↓ 选择、Enter 执行
// =============================================================================
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search, ListChecks, FolderKanban, Link2, Settings, LayoutDashboard,
  AlertTriangle, BookOpen, Plus, Trash2, Sparkles, Languages, Bot, Users,
} from 'lucide-react';
import { open as openInShell } from '@tauri-apps/plugin-shell';
import { query } from '@/db/client';
import { useAccountStore } from '@/stores/account';
import { knowledgeSearchTarget, projectFileSearchTarget, projectPanelSearchTarget, workSearchTarget } from '@/lib/navigation-targets';

type ResultKind = 'work' | 'project' | 'link' | 'knowledge' | 'file' | 'word' | 'command';
interface Result {
  kind: ResultKind;
  id: string;
  title: string;
  hint?: string;
  icon: React.ElementType;
  onSelect: () => void | Promise<void>;
}

/** 由 AppShell 常驻挂载 */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const nav = useNavigate();
  const currentAccountId = useAccountStore((s) => s.currentAccountId);

  // 全局快捷键
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('keydown', handler);
    const openFromTopbar = () => setOpen(true);
    window.addEventListener('open-command-palette', openFromTopbar);
    return () => {
      window.removeEventListener('keydown', handler);
      window.removeEventListener('open-command-palette', openFromTopbar);
    };
  }, []);

  // 打开时聚焦
  useEffect(() => {
    if (open) {
      setQ('');
      setIdx(0);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  const commands: Result[] = useMemo(() => ([
    {
      kind: 'command', id: 'new-work', title: '新建工作事项', hint: '跳到工作管理并添加一行',
      icon: Plus,
      onSelect: () => { nav('/work'); setOpen(false); },
    },
    {
      kind: 'command', id: 'new-project', title: '新建项目', hint: '跳到项目管理并创建',
      icon: Plus,
      onSelect: () => { nav('/project'); setOpen(false); },
    },
    {
      kind: 'command', id: 'go-dashboard', title: '前往：主页看板', icon: LayoutDashboard,
      onSelect: () => { nav('/dashboard'); setOpen(false); },
    },
    {
      kind: 'command', id: 'go-work', title: '前往：工作管理', icon: ListChecks,
      onSelect: () => { nav('/work'); setOpen(false); },
    },
    {
      kind: 'command', id: 'go-project', title: '前往：项目管理', icon: FolderKanban,
      onSelect: () => { nav('/project'); setOpen(false); },
    },
    {
      kind: 'command', id: 'go-knowledge', title: '前往：知识管理', icon: BookOpen,
      onSelect: () => { nav('/knowledge'); setOpen(false); },
    },
    {
      kind: 'command', id: 'go-english', title: '前往：英语学习', icon: Languages,
      onSelect: () => { nav('/english'); setOpen(false); },
    },
    {
      kind: 'command', id: 'go-ai', title: '前往：AI 工作台', icon: Sparkles,
      onSelect: () => { nav('/ai-tools'); setOpen(false); },
    },
    {
      kind: 'command', id: 'go-ai-assistant', title: '前往：AI 助手', icon: Bot,
      onSelect: () => { nav('/ai-assistant'); setOpen(false); },
    },
    {
      kind: 'command', id: 'go-links', title: '前往：快捷链接', icon: Link2,
      onSelect: () => { nav('/quick-links'); setOpen(false); },
    },
    {
      kind: 'command', id: 'go-settings', title: '前往：系统设置', icon: Settings,
      onSelect: () => { nav('/settings'); setOpen(false); },
    },
    {
      kind: 'command', id: 'go-recycle', title: '打开回收站', icon: Trash2,
      onSelect: () => { nav('/settings/recycle'); setOpen(false); },
    },
  ]), [nav]);

  const [results, setResults] = useState<Result[]>([]);

  useEffect(() => {
    if (!open) return;
    const kw = q.trim();
    if (kw.startsWith('>')) {
      const term = kw.slice(1).trim().toLowerCase();
      setResults(commands.filter((c) => !term || c.title.toLowerCase().includes(term)));
      setIdx(0);
      return;
    }
    if (!kw) {
      setResults(commands.slice(0, 6));
      setIdx(0);
      return;
    }

    // 数据检索
    let alive = true;
    (async () => {
      const acc = currentAccountId;
      if (!acc) { setResults([]); return; }
      const like = `%${kw}%`;
      try {
        const [works, projects, links, knowledge, files, words, tasks, risks, members] = await Promise.all([
          query<{ id: string; description: string; seq_no: number }>(
            `SELECT id, description, seq_no FROM work_item
             WHERE account_id = $1 AND is_deleted = 0 AND description LIKE $2
             LIMIT 8`,
            [acc, like],
          ),
          query<{ id: string; name: string; seq_no: number }>(
            `SELECT id, name, seq_no FROM project
             WHERE account_id = $1 AND is_deleted = 0 AND name LIKE $2
             LIMIT 8`,
            [acc, like],
          ),
          query<{ id: string; name: string; kind: 'url' | 'path'; url_or_path: string }>(
            `SELECT id, name, kind, url_or_path FROM quick_link
             WHERE account_id = $1 AND is_deleted = 0
               AND (name LIKE $2 OR url_or_path LIKE $2)
             LIMIT 8`,
            [acc, like],
          ),
          query<{ path: string; title: string; vault_id: string }>(
            `SELECT d.path,d.title,d.vault_id FROM knowledge_document_index d
             JOIN knowledge_vault v ON v.id=d.vault_id
             WHERE v.account_id=$1 AND v.is_deleted=0 AND (d.title LIKE $2 OR d.content LIKE $2)
             LIMIT 8`, [acc, like],
          ),
          query<{ id: string; project_id: string; display_name: string; name: string }>(
            `SELECT f.id,f.project_id,f.display_name,p.name FROM project_file f JOIN project p ON p.id=f.project_id
             WHERE f.account_id=$1 AND f.is_deleted=0 AND (f.display_name LIKE $2 OR f.original_name LIKE $2)
             LIMIT 8`, [acc, like],
          ),
          query<{ id: string; word: string; meaning: string | null }>(
            `SELECT id,word,meaning FROM word_card WHERE account_id=$1 AND is_deleted=0
             AND (word LIKE $2 OR meaning LIKE $2 OR meaning_context LIKE $2) LIMIT 8`, [acc, like],
          ),
          query<{ id: string; project_id: string; item: string; name: string }>(
            `SELECT w.id,w.project_id,w.item,p.name FROM project_wbs w JOIN project p ON p.id=w.project_id
             WHERE w.account_id=$1 AND w.is_deleted=0 AND w.item LIKE $2 LIMIT 8`, [acc, like],
          ),
          query<{ id: string; project_id: string; risk: string; name: string }>(
            `SELECT r.id,r.project_id,r.risk,p.name FROM project_risk r JOIN project p ON p.id=r.project_id
             WHERE r.account_id=$1 AND r.is_deleted=0 AND (r.risk LIKE $2 OR r.countermeasure LIKE $2) LIMIT 8`, [acc, like],
          ),
          query<{ id: string; project_id: string; name: string; project_name: string }>(
            `SELECT m.id,m.project_id,m.name,p.name AS project_name FROM project_member m JOIN project p ON p.id=m.project_id
             WHERE m.account_id=$1 AND m.is_deleted=0 AND (m.name LIKE $2 OR m.company LIKE $2 OR m.department LIKE $2) LIMIT 8`, [acc, like],
          ),
        ]);
        if (!alive) return;
        const rs: Result[] = [];
        works.forEach((w) => rs.push({
          kind: 'work', id: w.id, icon: ListChecks,
          title: w.description || '(空)',
          hint: `工作事项 · #${w.seq_no}`,
          onSelect: () => { nav(workSearchTarget(w.id)); setOpen(false); },
        }));
        projects.forEach((p) => rs.push({
          kind: 'project', id: p.id, icon: FolderKanban,
          title: p.name || '(空)',
          hint: `项目 · #${p.seq_no}`,
          onSelect: () => { nav(`/project/${p.id}`); setOpen(false); },
        }));
        links.forEach((l) => rs.push({
          kind: 'link', id: l.id, icon: l.kind === 'url' ? Link2 : Search,
          title: l.name,
          hint: `快捷链接 · ${l.url_or_path}`,
          onSelect: async () => {
            try { await openInShell(l.url_or_path); } catch { /* ignore */ }
            setOpen(false);
          },
        }));
        knowledge.forEach((item) => rs.push({
          kind: 'knowledge', id: `${item.vault_id}:${item.path}`, icon: BookOpen, title: item.title || item.path,
          hint: `知识库 · ${item.path}`, onSelect: () => { nav(knowledgeSearchTarget(item.path)); setOpen(false); },
        }));
        files.forEach((item) => rs.push({
          kind: 'file', id: item.id, icon: FolderKanban, title: item.display_name,
          hint: `项目文件 · ${item.name}`, onSelect: () => { nav(projectFileSearchTarget(item.project_id, item.id)); setOpen(false); },
        }));
        words.forEach((item) => rs.push({
          kind: 'word', id: item.id, icon: Languages, title: item.word,
          hint: `英语词条 · ${item.meaning ?? '无释义'}`, onSelect: () => { nav(`/english/word/${item.id}`); setOpen(false); },
        }));
        tasks.forEach((item) => rs.push({
          kind: 'project', id: `task-${item.id}`, icon: ListChecks, title: item.item || '(空任务)',
          hint: `项目任务 · ${item.name}`, onSelect: () => { nav(projectPanelSearchTarget(item.project_id, 'progress', item.id)); setOpen(false); },
        }));
        risks.forEach((item) => rs.push({
          kind: 'project', id: `risk-${item.id}`, icon: AlertTriangle, title: item.risk || '(空风险)',
          hint: `项目风险 · ${item.name}`, onSelect: () => { nav(projectPanelSearchTarget(item.project_id, 'risk', item.id)); setOpen(false); },
        }));
        members.forEach((item) => rs.push({
          kind: 'project', id: `member-${item.id}`, icon: Users, title: item.name || '(未命名成员)',
          hint: `项目成员 · ${item.project_name}`, onSelect: () => { nav(projectPanelSearchTarget(item.project_id, 'member', item.id)); setOpen(false); },
        }));
        // 加上匹配的命令
        commands.filter((c) => c.title.toLowerCase().includes(kw.toLowerCase()))
          .slice(0, 4).forEach((c) => rs.push(c));
        setResults(rs);
        setIdx(0);
      } catch {
        setResults([]);
      }
    })();
    return () => { alive = false; };
  }, [q, open, currentAccountId, commands, nav]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(results.length - 1, i + 1)); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)); }
    if (e.key === 'Enter') {
      e.preventDefault();
      results[idx]?.onSelect();
    }
  }

  if (!open) return null;

  const isCommandMode = q.trim().startsWith('>');

  return (
    <div className="fixed inset-0 z-50 bg-black/30 pt-[15vh] flex justify-center" onClick={() => setOpen(false)}>
      <div className="w-[640px] max-w-full bg-canvas rounded-xl shadow-lg flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-line flex items-center gap-3">
          <Search size={16} className="text-ink-3" />
          <input
            ref={inputRef}
            className="flex-1 outline-none text-[15px] bg-transparent"
            placeholder={isCommandMode
              ? '命令模式：搜索命令…'
              : '搜索事项、项目、链接…（输入 > 进入命令模式）'}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <span className="kbd">Esc</span>
        </div>

        <div className="max-h-[50vh] overflow-y-auto">
          {results.length === 0 && (
            <div className="p-8 text-center text-ink-3 text-sm">
              {q.trim() ? '未找到匹配项' : '开始输入以搜索…'}
            </div>
          )}
          {results.map((r, i) => {
            const Icon = r.icon;
            return (
              <button
                key={`${r.kind}-${r.id}`}
                onClick={() => r.onSelect()}
                onMouseEnter={() => setIdx(i)}
                className={`w-full px-4 py-2.5 text-left flex items-center gap-3 border-b border-line/60 ${
                  i === idx ? 'bg-accent-tint' : 'hover:bg-paper'
                }`}
              >
                <div className={`w-8 h-8 rounded-lg grid place-items-center ${
                  i === idx ? 'text-accent' : 'text-ink-3'
                }`}>
                  <Icon size={16} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13.5px] font-medium truncate">{r.title}</div>
                  {r.hint && <div className="text-[11.5px] text-ink-3 truncate">{r.hint}</div>}
                </div>
              </button>
            );
          })}
        </div>

        <div className="px-4 py-2 border-t border-line text-[11px] text-ink-4 flex gap-4">
          <span><span className="kbd">↑</span> <span className="kbd">↓</span> 移动</span>
          <span><span className="kbd">Enter</span> 打开</span>
          <span>输入 <span className="kbd">&gt;</span> 进入命令模式</span>
          <span className="ml-auto"><span className="kbd">Ctrl</span> <span className="kbd">K</span> 唤起</span>
        </div>
      </div>
    </div>
  );
}
