import { NavLink, useNavigate } from 'react-router-dom';
import { useCallback, useRef, useState } from 'react';
import {
  LayoutDashboard,
  ListChecks,
  CalendarClock,
  FolderKanban,
  BookOpen,
  Archive,
  Languages,
  Bot,
  Sparkles,
  Link2,
  Settings,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAccountStore } from '@/stores/account';
import { useBrandStore } from '@/stores/brand';
import { SidebarPromoCard } from '@/components/ThemeDecorations';

const NAV = [
  { to: '/dashboard', icon: LayoutDashboard, label: '主页看板' },
  { to: '/work', icon: ListChecks, label: '工作管理' },
  { to: '/schedule', icon: CalendarClock, label: '日程管理' },
  { to: '/project', icon: FolderKanban, label: '项目管理' },
  { to: '/knowledge', icon: BookOpen, label: '知识管理' },
  { to: '/materials', icon: Archive, label: '资料管理' },
  { to: '/english', icon: Languages, label: '英语学习' },
  { to: '/ai-tools', icon: Sparkles, label: 'AI 工作台' },
  { to: '/ai-assistant', icon: Bot, label: 'AI 助手' },
  { to: '/quick-links', icon: Link2, label: '快捷链接' },
  { to: '/settings', icon: Settings, label: '系统设置' },
];

const NAV_ORDER_STORAGE_KEY = 'personal_workstation_nav_order';

function readNavigationOrder() {
  try {
    const saved = JSON.parse(localStorage.getItem(NAV_ORDER_STORAGE_KEY) ?? '[]') as string[];
    if (!Array.isArray(saved)) return NAV;
    const known = new Map(NAV.map((item) => [item.to, item]));
    const ordered = saved
      .map((to) => known.get(to))
      .filter((item): item is (typeof NAV)[number] => Boolean(item));
    return [...ordered, ...NAV.filter((item) => !saved.includes(item.to))];
  } catch {
    return NAV;
  }
}

/**
 * 左侧导航：整条浅蓝色贯穿到底
 * - 顶部：品牌
 * - 中部：8 个模块
 * - 底部：账号信息
 */
export function SideNav({
  collapsed = false,
  onToggle,
  width = 216,
  onWidthChange,
}: {
  collapsed?: boolean;
  onToggle?: () => void;
  width?: number;
  onWidthChange?: (width: number) => void;
}) {
  const current = useAccountStore((s) => s.current);
  const navigate = useNavigate();
  const brand = useBrandStore();
  const [orderedNav, setOrderedNav] = useState(readNavigationOrder);
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const navLongPressTimer = useRef<number | null>(null);
  const navDragRef = useRef<{
    itemTo: string;
    active: boolean;
    moved: boolean;
    cleanUp: () => void;
  } | null>(null);
  const suppressNavClickRef = useRef(false);
  const [draggingNav, setDraggingNav] = useState<string | null>(null);
  const initial = current?.display_name?.[0] ?? current?.username?.[0]?.toUpperCase() ?? 'U';

  function startResize(event: React.PointerEvent<HTMLButtonElement>) {
    if (collapsed || !onWidthChange) return;
    resizeRef.current = { startX: event.clientX, startWidth: width };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function resize(event: React.PointerEvent<HTMLButtonElement>) {
    const currentResize = resizeRef.current;
    if (!currentResize || !onWidthChange) return;
    onWidthChange(
      Math.max(180, Math.min(360, currentResize.startWidth + event.clientX - currentResize.startX)),
    );
  }
  function endResize() {
    resizeRef.current = null;
  }
  function editTitle() {
    const title = window.prompt('修改工作站名称', brand.title);
    if (title !== null) brand.setTitle(title.trim() || '个人工作站');
  }
  const clearNavLongPress = useCallback(() => {
    if (navLongPressTimer.current !== null) window.clearTimeout(navLongPressTimer.current);
    navLongPressTimer.current = null;
  }, []);
  function beginNavLongPress(event: React.PointerEvent<HTMLAnchorElement>, itemTo: string) {
    if (event.button !== 0) return;
    clearNavLongPress();
    navDragRef.current?.cleanUp();
    const drag = {
      itemTo,
      active: false,
      moved: false,
      cleanUp: () => undefined,
    };
    const finish = () => {
      if (navDragRef.current !== drag) return;
      clearNavLongPress();
      navDragRef.current = null;
      if (drag.active && drag.moved) {
        suppressNavClickRef.current = true;
        window.setTimeout(() => {
          suppressNavClickRef.current = false;
        }, 120);
      }
      setDraggingNav(null);
      drag.cleanUp();
    };
    const move = (pointer: PointerEvent) => {
      if (!drag.active) return;
      pointer.preventDefault();
      drag.moved = true;
      placeNavigationItem(drag.itemTo, pointer.clientX, pointer.clientY);
    };
    drag.cleanUp = () => {
      document.removeEventListener('pointermove', move, true);
      document.removeEventListener('pointerup', finish, true);
      document.removeEventListener('pointercancel', finish, true);
    };
    navDragRef.current = drag;
    // 从按下的那一刻就监听 document；长按完成后无需依赖原链接仍在鼠标下方。
    document.addEventListener('pointermove', move, { capture: true, passive: false });
    document.addEventListener('pointerup', finish, true);
    document.addEventListener('pointercancel', finish, true);
    navLongPressTimer.current = window.setTimeout(() => {
      if (navDragRef.current !== drag) return;
      drag.active = true;
      setDraggingNav(itemTo);
    }, 360);
  }
  const placeNavigationItem = useCallback((from: string, clientX: number, clientY: number) => {
    const hovered = document
      .elementFromPoint(clientX, clientY)
      ?.closest<HTMLElement>('[data-navigation-item]')?.dataset.navigationItem;
    if (!hovered || hovered === from) return;
    setOrderedNav((current) => {
      const source = current.findIndex((item) => item.to === from);
      const target = current.findIndex((item) => item.to === hovered);
      if (source < 0 || target < 0 || source === target) return current;
      const next = [...current];
      const [moved] = next.splice(source, 1);
      next.splice(target, 0, moved);
      localStorage.setItem(NAV_ORDER_STORAGE_KEY, JSON.stringify(next.map((item) => item.to)));
      return next;
    });
  }, []);
  return (
    <aside
      className="app-side-nav relative flex shrink-0 flex-col bg-sidebar-bg transition-[width] duration-200"
      style={{ width: collapsed ? 72 : width }}
    >
      {!collapsed && onWidthChange && (
        <button
          className="absolute -right-1 top-0 z-10 hidden h-full w-2 cursor-col-resize lg:block"
          onPointerDown={startResize}
          onPointerMove={resize}
          onPointerUp={endResize}
          onPointerCancel={endResize}
          aria-label="拖动调整左侧菜单宽度"
          title="拖动调整左侧菜单宽度"
        />
      )}
      <button
        className="app-side-toggle absolute -right-3 top-1/2 z-20 grid h-10 w-5 -translate-y-1/2 place-items-center rounded-r-lg border border-l-0 border-line bg-paper text-ink-3 shadow-[3px_2px_8px_rgba(36,59,88,.10)] hover:bg-canvas hover:text-accent"
        onClick={onToggle}
        aria-label={collapsed ? '向右展开左侧菜单' : '向左收起左侧菜单'}
        title={collapsed ? '展开左侧菜单' : '收起左侧菜单'}
      >
        {collapsed ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
      </button>
      {/* 品牌 */}
      <div
        className={`flex h-14 shrink-0 items-center gap-2.5 ${
          collapsed ? 'justify-center px-2' : 'px-5'
        }`}
      >
        <div
          className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-lg text-lg font-medium text-white shadow-md"
          style={{ background: 'linear-gradient(135deg, rgb(var(--rgb-accent)), #6E8CFF)' }}
        >
          {brand.logoDataUrl ? (
            <img src={brand.logoDataUrl} alt="工作站图标" className="h-full w-full object-cover" />
          ) : (
            '工'
          )}
        </div>
        {!collapsed && (
          <div className="min-w-0 leading-tight">
            <div
              role="button"
              tabIndex={0}
              className="cursor-text truncate select-none font-semibold"
              style={{
                fontFamily:
                  brand.font === 'sans'
                    ? "Inter, 'PingFang SC', sans-serif"
                    : brand.font === 'yahei'
                      ? "'Microsoft YaHei', sans-serif"
                      : "'Source Serif 4', 'Noto Serif SC', Georgia, serif",
                fontSize: `${brand.fontSize}px`,
                color: brand.color,
              }}
              onDoubleClick={editTitle}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  editTitle();
                }
              }}
              aria-label="修改工作站名称"
              title="双击或按 Enter 修改名称；更多样式请在系统设置中调整"
            >
              {brand.title || '个人工作站'}
            </div>
          </div>
        )}
      </div>

      {/* 导航 */}
      <nav
        className={`app-nav-list flex flex-1 flex-col gap-1 overflow-y-auto ${collapsed ? 'p-2' : 'p-3'}`}
      >
        {orderedNav.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              data-navigation-item={item.to}
              draggable={false}
              aria-label={item.label}
              aria-grabbed={draggingNav === item.to}
              title={collapsed ? item.label : undefined}
              onPointerDown={(event) => beginNavLongPress(event, item.to)}
              onDragStart={(event) => event.preventDefault()}
              onClick={(event) => {
                if (suppressNavClickRef.current) {
                  event.preventDefault();
                  event.stopPropagation();
                }
              }}
              className={({ isActive }) =>
                cn(
                  `app-nav-item flex touch-none select-none items-center rounded-lg py-2.5 text-[13.5px] transition-colors ${
                    collapsed ? 'justify-center px-2.5' : 'gap-3 px-3.5'
                  }`,
                  draggingNav === item.to && 'bg-sidebar-hover opacity-70',
                  isActive
                    ? 'app-nav-item-active bg-canvas text-accent font-semibold shadow-sm'
                    : 'text-ink-2 hover:bg-sidebar-hover hover:text-ink',
                )
              }
            >
              <Icon size={16} />
              {!collapsed && <span>{item.label}</span>}
            </NavLink>
          );
        })}
      </nav>

      {!collapsed && <SidebarPromoCard />}

      {/* 底部账号 */}
      <div className={`border-t border-sidebar-hover ${collapsed ? 'p-2' : 'p-3'}`}>
        <button
          type="button"
          onClick={() => navigate('/settings?tab=accounts')}
          className={`app-nav-account flex w-full items-center rounded-lg text-left hover:bg-sidebar-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
            collapsed ? 'justify-center px-1 py-1.5' : 'gap-2.5 px-1.5 py-1.5'
          }`}
          title={collapsed ? (current?.display_name ?? '未登录') : '打开个人账户设置'}
          aria-label="打开个人账户设置"
        >
          <div
            className="w-9 h-9 rounded-full grid place-items-center text-white text-sm font-semibold shadow-sm shrink-0"
            style={{
              background:
                'linear-gradient(135deg, rgb(var(--rgb-c-purple)), rgb(var(--rgb-c-pink)))',
            }}
          >
            {initial}
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <div className="text-[13px] font-medium truncate">
                {current?.display_name ?? '未登录'}
              </div>
              <div className="text-[11px] text-ink-3">个人账号</div>
            </div>
          )}
        </button>
      </div>
    </aside>
  );
}
