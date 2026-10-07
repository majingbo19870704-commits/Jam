import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, HelpCircle, Menu, Search } from 'lucide-react';
import { approxLunar, fmtDate, weekdayCn } from '@/lib/utils';
import { useAccountStore } from '@/stores/account';
import {
  refreshNotifications,
  unreadNotificationCount,
  type Notification,
} from '@/db/notification-dao';
import { snoozeScheduleReminder } from '@/db/schedule-event-dao';
import { query } from '@/db/client';
import {
  knowledgeSearchTarget,
  projectFileSearchTarget,
  projectPanelSearchTarget,
  workSearchTarget,
} from '@/lib/navigation-targets';
import { sendDesktopNotifications } from '@/lib/desktop-notifications';

type InlineSearchResult = { id: string; title: string; hint: string; to: string };

/**
 * 顶部条：模块标题 + 日期条 + 全局搜索 + 通知 + 头像
 * 页面标题通过 title prop 传入；侧边栏切换通过 onToggleNav 触发
 */
interface Props {
  title: string;
  onToggleNav?: () => void;
}

export function TopBar({ title, onToggleNav }: Props) {
  const [now, setNow] = useState(() => new Date());
  const [unread, setUnread] = useState(0);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<InlineSearchResult[]>([]);
  const [searchFocused, setSearchFocused] = useState(false);
  const [reminderPopups, setReminderPopups] = useState<Notification[]>([]);
  const navigate = useNavigate();
  const current = useAccountStore((s) => s.current);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const created = await refreshNotifications();
        void sendDesktopNotifications(created);
        if (active && created.length) {
          setReminderPopups((current) => [...current, ...created].slice(-4));
          window.setTimeout(
            () =>
              active &&
              setReminderPopups((current) =>
                current.filter((item) => !created.some((next) => next.id === item.id)),
              ),
            30_000,
          );
        }
        const count = await unreadNotificationCount();
        if (active) setUnread(count);
      } catch {
        if (active) setUnread(0);
      }
    };
    void load();
    // 精确提醒按分钟检查；去重键保证同一提醒只出现一次。
    const timer = window.setInterval(() => void load(), 60_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [current?.id]);
  useEffect(() => {
    const keyword = search.trim();
    if (!keyword || !current?.id) {
      setResults([]);
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      const like = `%${keyword}%`;
      void Promise.all([
        query<{ id: string; description: string }>(
          `SELECT id,description FROM work_item WHERE account_id=$1 AND is_deleted=0 AND description LIKE $2 LIMIT 5`,
          [current.id, like],
        ),
        query<{ id: string; name: string }>(
          `SELECT id,name FROM project WHERE account_id=$1 AND is_deleted=0 AND name LIKE $2 LIMIT 5`,
          [current.id, like],
        ),
        query<{ id: string; word: string; meaning: string | null }>(
          `SELECT id,word,meaning FROM word_card WHERE account_id=$1 AND is_deleted=0 AND (word LIKE $2 OR meaning LIKE $2 OR meaning_context LIKE $2) LIMIT 5`,
          [current.id, like],
        ),
        query<{ path: string; title: string }>(
          `SELECT d.path,d.title FROM knowledge_document_index d JOIN knowledge_vault v ON v.id=d.vault_id WHERE v.account_id=$1 AND v.is_deleted=0 AND (d.title LIKE $2 OR d.content LIKE $2) LIMIT 5`,
          [current.id, like],
        ),
        query<{ id: string; project_id: string; display_name: string; name: string }>(
          `SELECT f.id,f.project_id,f.display_name,p.name FROM project_file f JOIN project p ON p.id=f.project_id WHERE f.account_id=$1 AND f.is_deleted=0 AND (f.display_name LIKE $2 OR f.original_name LIKE $2) LIMIT 5`,
          [current.id, like],
        ),
        query<{ id: string; project_id: string; item: string; name: string }>(
          `SELECT w.id,w.project_id,w.item,p.name FROM project_wbs w JOIN project p ON p.id=w.project_id WHERE w.account_id=$1 AND w.is_deleted=0 AND (w.item LIKE $2 OR w.progress_note LIKE $2) LIMIT 5`,
          [current.id, like],
        ),
        query<{ id: string; project_id: string; risk: string; name: string }>(
          `SELECT r.id,r.project_id,r.risk,p.name FROM project_risk r JOIN project p ON p.id=r.project_id WHERE r.account_id=$1 AND r.is_deleted=0 AND (r.risk LIKE $2 OR r.countermeasure LIKE $2 OR r.progress_note LIKE $2) LIMIT 5`,
          [current.id, like],
        ),
        query<{ id: string; project_id: string; name: string; project_name: string }>(
          `SELECT m.id,m.project_id,m.name,p.name AS project_name FROM project_member m JOIN project p ON p.id=m.project_id WHERE m.account_id=$1 AND m.is_deleted=0 AND (m.name LIKE $2 OR m.company LIKE $2 OR m.department LIKE $2) LIMIT 5`,
          [current.id, like],
        ),
      ])
        .then(([works, projects, words, knowledge, files, tasks, risks, members]) => {
          if (!active) return;
          setResults(
            [
              ...works.map((item) => ({
                id: `work-${item.id}`,
                title: item.description || '未命名工作事项',
                hint: '工作事项',
                to: workSearchTarget(item.id),
              })),
              ...projects.map((item) => ({
                id: `project-${item.id}`,
                title: item.name || '未命名项目',
                hint: '项目',
                to: `/project/${item.id}`,
              })),
              ...words.map((item) => ({
                id: `word-${item.id}`,
                title: item.word,
                hint: `英语词条 · ${item.meaning ?? '无释义'}`,
                to: `/english/word/${item.id}`,
              })),
              ...knowledge.map((item) => ({
                id: `knowledge-${item.path}`,
                title: item.title || item.path,
                hint: '知识库资料',
                to: knowledgeSearchTarget(item.path),
              })),
              ...files.map((item) => ({
                id: `file-${item.id}`,
                title: item.display_name,
                hint: `项目文件 · ${item.name}`,
                to: projectFileSearchTarget(item.project_id, item.id),
              })),
              ...tasks.map((item) => ({
                id: `task-${item.id}`,
                title: item.item || '未命名项目任务',
                hint: `项目任务 · ${item.name}`,
                to: projectPanelSearchTarget(item.project_id, 'progress', item.id),
              })),
              ...risks.map((item) => ({
                id: `risk-${item.id}`,
                title: item.risk || '未命名项目风险',
                hint: `项目风险 · ${item.name}`,
                to: projectPanelSearchTarget(item.project_id, 'risk', item.id),
              })),
              ...members.map((item) => ({
                id: `member-${item.id}`,
                title: item.name || '未命名项目成员',
                hint: `项目成员 · ${item.project_name}`,
                to: projectPanelSearchTarget(item.project_id, 'member', item.id),
              })),
            ].slice(0, 12),
          );
        })
        .catch(() => active && setResults([]));
    }, 180);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [search, current?.id]);

  const initial = current?.display_name?.[0] ?? current?.username?.[0]?.toUpperCase() ?? 'U';
  const closePopup = (id: string) =>
    setReminderPopups((current) => current.filter((item) => item.id !== id));
  const snooze = async (item: Notification, minutes: number) => {
    const scheduleId =
      item.kind === 'schedule'
        ? new URLSearchParams(item.link?.split('?')[1] ?? '').get('focus')
        : null;
    if (scheduleId) await snoozeScheduleReminder(scheduleId, minutes);
    closePopup(item.id);
  };

  return (
    <header className="relative h-14 flex items-center justify-between px-6 bg-canvas border-b border-line">
      <div className="flex items-center gap-3">
        <button
          onClick={onToggleNav}
          className="text-ink-3 hover:text-ink"
          aria-label="切换导航栏"
          title="收起或展开左侧菜单"
        >
          <Menu size={20} />
        </button>
        <h2 className="text-[17px] font-semibold text-ink">{title}</h2>
        <div className="flex items-center gap-2.5 text-[12.5px] text-ink-3 pl-3.5 h-6 border-l border-line ml-2">
          <span className="num text-ink font-medium">{fmtDate(now)}</span>
          <span>{weekdayCn(now)}</span>
          <span className="text-ink-4">{approxLunar(now)}</span>
        </div>
      </div>

      <div className="relative flex flex-1 justify-center">
        <div className="flex min-w-[380px] items-center gap-2.5 rounded-lg bg-paper px-3.5 py-2 text-ink-3 focus-within:ring-2 focus-within:ring-accent/30">
          <Search size={14} />
          <input
            className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-3"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => window.setTimeout(() => setSearchFocused(false), 150)}
            placeholder="搜索文件、任务、笔记…"
            aria-label="全局搜索"
          />
          <span className="kbd">Ctrl K</span>
        </div>
        {searchFocused && search.trim() && (
          <div className="absolute top-[42px] z-50 w-[480px] overflow-hidden rounded-xl border border-line bg-canvas py-1 shadow-xl">
            {results.length ? (
              results.map((result) => (
                <button
                  key={result.id}
                  className="block w-full px-3.5 py-2 text-left hover:bg-paper"
                  onMouseDown={() => {
                    navigate(result.to);
                    setSearch('');
                  }}
                >
                  <span className="block truncate text-[13px] font-medium text-ink">
                    {result.title}
                  </span>
                  <span className="block truncate text-[11px] text-ink-3">{result.hint}</span>
                </button>
              ))
            ) : (
              <div className="px-3.5 py-4 text-center text-xs text-ink-3">未找到匹配内容</div>
            )}
          </div>
        )}
      </div>

      <div className="relative flex items-center gap-2.5 text-ink-3">
        <button
          onClick={() => navigate('/notifications')}
          className="relative w-8 h-8 grid place-items-center rounded-lg hover:bg-paper hover:text-ink"
          aria-label="打开通知中心"
        >
          <Bell size={18} />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-1 min-w-4 h-4 px-1 rounded-full bg-danger text-[10px] leading-4 text-white">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </button>
        <button
          onClick={() => navigate('/help')}
          className="w-8 h-8 grid place-items-center rounded-lg hover:bg-paper hover:text-ink"
          aria-label="打开帮助"
        >
          <HelpCircle size={18} />
        </button>
        <button
          type="button"
          onClick={() => navigate('/settings?tab=accounts')}
          title={current?.display_name}
          aria-label="打开个人账户设置"
          className="grid h-8 w-8 place-items-center rounded-full text-[13px] font-semibold text-white shadow-sm transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
          style={{
            background: 'linear-gradient(135deg, rgb(var(--rgb-c-purple)), rgb(var(--rgb-c-pink)))',
          }}
        >
          {initial}
        </button>
      </div>
      {reminderPopups.length > 0 && (
        <div
          className="fixed right-5 top-16 z-[70] w-[min(360px,calc(100vw-2.5rem))] space-y-2"
          aria-live="polite"
        >
          {reminderPopups.map((item) => (
            <section
              key={item.id}
              className="rounded-xl border border-[#D5E0ED] bg-canvas p-3.5 shadow-[0_12px_32px_rgba(31,52,78,.2)]"
            >
              <div className="flex items-start gap-2">
                <Bell size={16} className="mt-0.5 shrink-0 text-accent" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-ink">{item.title}</p>
                  <p className="mt-0.5 text-xs leading-5 text-ink-3">{item.body}</p>
                </div>
                <button
                  type="button"
                  className="text-ink-3 hover:text-ink"
                  onClick={() => closePopup(item.id)}
                  aria-label="关闭提醒"
                >
                  ×
                </button>
              </div>
              <div className="mt-3 flex items-center justify-between gap-2">
                <button
                  type="button"
                  className="text-xs text-accent hover:underline"
                  onClick={() => {
                    if (item.link) navigate(item.link);
                    closePopup(item.id);
                  }}
                >
                  查看
                </button>
                {item.kind === 'schedule' && (
                  <div className="flex items-center gap-1">
                    <span className="text-[11px] text-ink-3">稍后提醒</span>
                    {[5, 10, 30].map((minutes) => (
                      <button
                        key={minutes}
                        type="button"
                        className="rounded border border-line px-1.5 py-0.5 text-[11px] text-ink-3 hover:border-accent hover:text-accent"
                        onClick={() => void snooze(item, minutes)}
                      >
                        {minutes}分
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </section>
          ))}
        </div>
      )}
    </header>
  );
}
