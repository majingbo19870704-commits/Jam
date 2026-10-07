import { Bell, CheckCheck, CircleHelp, Keyboard, Search, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { deleteReadNotifications, listNotifications, markNotificationsRead, refreshNotifications, type Notification } from '@/db/notification-dao';
import { getSetting, setSetting } from '@/db/english-dao';

const NOTIFICATION_KIND_LABEL: Record<Notification['kind'], string> = {
  overdue: '逾期事项', due: '今日到期', reminder: '工作提醒', schedule: '日程提醒', review: '英语复习', backup: '备份',
};

export function NotificationsPage() {
  const [items, setItems] = useState<Notification[]>([]);
  const [kind, setKind] = useState<'all' | Notification['kind']>('all');
  const [read, setRead] = useState<'all' | 'unread' | 'read'>('all');
  const [quietEnabled, setQuietEnabled] = useState(false);
  const [quietStart, setQuietStart] = useState('22:00');
  const [quietEnd, setQuietEnd] = useState('07:00');
  const nav = useNavigate();
  const load = async () => {
    await refreshNotifications();
    const [notifications, enabled, start, end] = await Promise.all([
      listNotifications(), getSetting('app', 'notification.quiet.enabled'), getSetting('app', 'notification.quiet.start'), getSetting('app', 'notification.quiet.end'),
    ]);
    setItems(notifications);
    setQuietEnabled(enabled === '1');
    setQuietStart(start ?? '22:00');
    setQuietEnd(end ?? '07:00');
  };
  useEffect(() => { void load(); }, []);
  const visibleItems = useMemo(() => items.filter((item) =>
    (kind === 'all' || item.kind === kind) && (read === 'all' || (read === 'unread' ? !item.is_read : !!item.is_read)),
  ), [items, kind, read]);
  const saveQuietHours = async (patch: Partial<{ enabled: boolean; start: string; end: string }>) => {
    const next = { enabled: quietEnabled, start: quietStart, end: quietEnd, ...patch };
    setQuietEnabled(next.enabled); setQuietStart(next.start); setQuietEnd(next.end);
    await Promise.all([
      setSetting('app', 'notification.quiet.enabled', next.enabled ? '1' : '0'),
      setSetting('app', 'notification.quiet.start', next.start),
      setSetting('app', 'notification.quiet.end', next.end),
    ]);
  };
  return (
    <div className="p-6 max-w-[960px] mx-auto">
      <div className="card">
        <div className="card-title flex-wrap gap-3"><div className="flex items-center gap-2"><Bell size={18} className="text-accent" /><h3>通知中心</h3></div><div className="flex items-center gap-2"><button className="btn btn-ghost !py-1" onClick={() => void markNotificationsRead().then(load)}><CheckCheck size={14} /> 全部已读</button><button className="btn btn-ghost !py-1 text-danger" disabled={!items.some((item) => item.is_read)} onClick={() => { if (window.confirm('清理全部已读通知？此操作不可恢复。')) void deleteReadNotifications().then(load); }}><Trash2 size={14} /> 清理已读</button></div></div>
        <div className="flex flex-wrap gap-2 border-b border-line px-5 py-3">
          <select aria-label="通知类型筛选" className="input-lite !w-auto !py-1.5 text-sm" value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}><option value="all">全部类型</option>{Object.entries(NOTIFICATION_KIND_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          <select aria-label="已读状态筛选" className="input-lite !w-auto !py-1.5 text-sm" value={read} onChange={(event) => setRead(event.target.value as typeof read)}><option value="all">全部状态</option><option value="unread">未读</option><option value="read">已读</option></select>
          <span className="self-center text-xs text-ink-3">显示 {visibleItems.length} 条</span>
        </div>
        <div className="card-body p-0">
          {visibleItems.length === 0 ? <div className="py-10 text-center text-ink-3"><Bell size={30} className="mx-auto mb-3 text-ink-4" /><p>{items.length ? '没有符合当前筛选条件的通知。' : '暂无通知。'}</p></div> : visibleItems.map((item) => <button key={item.id} className={`w-full px-5 py-4 text-left border-b border-line last:border-0 hover:bg-paper ${item.is_read ? 'opacity-65' : ''}`} onClick={() => void markNotificationsRead([item.id]).then(() => item.link && nav(item.link))}>
            <div className="flex items-center gap-2"><span className={`w-2 h-2 rounded-full ${item.is_read ? 'bg-line-strong' : item.kind === 'overdue' ? 'bg-danger' : 'bg-accent'}`} /><strong className="text-sm">{item.title}</strong><time className="ml-auto text-[11px] text-ink-4">{new Date(item.created_at).toLocaleString('zh-CN')}</time></div><p className="mt-1 pl-4 text-[13px] text-ink-3">{item.body}</p>
          </button>)}
        </div>
      </div>
      <div className="card mt-5"><div className="card-title"><div><h3>提醒静默时段</h3><p className="mt-1 text-xs font-normal text-ink-3">静默期间不弹出系统通知；提醒仍会进入本页，避免遗漏。</p></div><label className="flex items-center gap-2 text-sm font-normal text-ink-2"><input type="checkbox" checked={quietEnabled} onChange={(event) => void saveQuietHours({ enabled: event.target.checked })} /> 启用</label></div><div className="card-body flex flex-wrap items-center gap-3"><label className="text-sm text-ink-3">开始 <input className="input-lite ml-1 !w-auto !py-1.5" type="time" disabled={!quietEnabled} value={quietStart} onChange={(event) => void saveQuietHours({ start: event.target.value })} /></label><span className="text-ink-4">至</span><label className="text-sm text-ink-3">结束 <input className="input-lite ml-1 !w-auto !py-1.5" type="time" disabled={!quietEnabled} value={quietEnd} onChange={(event) => void saveQuietHours({ end: event.target.value })} /></label></div></div>
    </div>
  );
}

export function HelpPage() {
  return (
    <div className="p-6 max-w-[960px] mx-auto">
      <div className="card"><div className="card-title"><div className="flex items-center gap-2"><CircleHelp size={18} className="text-accent" /><h3>使用帮助</h3></div></div>
        <div className="card-body grid gap-4 text-sm text-ink-2">
          <section><div className="font-medium flex items-center gap-2"><Search size={15} /> 全局搜索</div><p className="mt-1 text-ink-3">直接在顶部输入框搜索待办、项目、项目任务、风险、成员、项目文件、知识库和英语词条；按 <span className="kbd">Ctrl K</span> 可使用完整命令面板。</p></section>
          <section><div className="font-medium flex items-center gap-2"><Keyboard size={15} /> 主页看板</div><p className="mt-1 text-ink-3">长按卡片后拖动可调整位置；拖动边缘或角落可调整尺寸，布局会自动保存。</p></section>
          <section><div className="font-medium">日程与提醒</div><p className="mt-1 text-ink-3">日程与工作事项分开维护；日程可设置一次性或按天、周、月重复提醒，到期后会显示在通知中心。</p></section>
          <section><div className="font-medium">报表与文件</div><p className="mt-1 text-ink-3">工作和项目报表可导入、导出；项目文件清单导入要求本机绝对路径，并在写入前显示预览和冲突结果。</p></section>
        </div>
      </div>
    </div>
  );
}
