import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { SelectionTooltip } from './SelectionTooltip';

const EN_TABS = [
  { to: '/english',            label: '🏠 今日学习', end: true },
  { to: '/english/translate',  label: '🔍 翻译' },
  { to: '/english/wordbook',   label: '⭐ 单词本' },
  { to: '/english/practice',   label: '🎯 练习' },
  { to: '/english/reading',    label: '📖 阅读' },
  { to: '/english/records',    label: '📊 学习记录' },
  { to: '/english/settings',   label: '⚙ 设置' },
];

/**
 * 英语学习模块的公共外壳：顶部二级 Tab + Outlet
 */
export function EnglishShell() {
  const { pathname } = useLocation();
  // 兼容子路由：/english/wordbook/xxx 也认为 wordbook 激活
  void pathname;
  return (
    <div className="flex flex-col h-full">
      <div className="bg-canvas border-b border-line px-6 sticky top-0 z-10">
        <div className="flex gap-1">
          {EN_TABS.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.end}
              className={({ isActive }) =>
                `px-3.5 py-2 text-[13px] border-b-2 -mb-px transition ${
                  isActive
                    ? 'border-accent text-accent font-semibold'
                    : 'border-transparent text-ink-3 hover:text-ink'
                }`
              }
            >
              {t.label}
            </NavLink>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        <Outlet />
      </div>
      <SelectionTooltip />
    </div>
  );
}
