import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useThemeStore, type ThemeName, type ThemeSlot } from '@/stores/theme';
import { useAccountStore } from '@/stores/account';
import { useBrandStore, type BrandFont } from '@/stores/brand';
import { ProviderConnections } from '@/modules/ai-assistant/AiAssistantPage';
import { ParamSettings } from './ParamSettings';
import { ScheduleSettings } from './ScheduleSettings';
import { getSetting, setSetting } from '@/db/english-dao';
import { syncDailyDesktopReminder } from '@/lib/desktop-notifications';
import {
  changeOwnerPassword,
  getOwnerPasswordRequirement,
  rotateOwnerRecoveryCode,
  setOwnerPasswordRequirement,
  updateOwnerProfile,
} from '@/db/account-dao';

const THEMES: { name: ThemeName; label: string; color: string }[] = [
  { name: 'soft-light', label: '浅色白', color: '#4D7CFE' },
  { name: 'tech-dark', label: '科技黑', color: '#6D8CFF' },
  { name: 'neumorphic', label: '拟物化', color: '#456F88' },
];

const TABS = [
  ['appearance', '外观设置'],
  ['parameters', '参数设置'],
  ['schedule', '日程设置'],
  ['data', '数据管理'],
  ['accounts', '个人账户'],
  ['ai', 'AI 设置'],
] as const;
type SettingsTab = (typeof TABS)[number][0];

function AppearanceSettings() {
  const theme = useThemeStore((state) => state.theme);
  const setTheme = useThemeStore((state) => state.setTheme);
  const decorations = useThemeStore((state) => state.decorations);
  const updateDecoration = useThemeStore((state) => state.updateDecoration);
  const resetDecoration = useThemeStore((state) => state.resetDecoration);
  const brand = useBrandStore();
  const logoInputRef = useRef<HTMLInputElement>(null);
  function importBrandLogo(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) return window.alert('请选择 PNG、JPG、WebP 等图片文件。');
    if (file.size > 1_000_000) return window.alert('图标图片请控制在 1 MB 以内。');
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string' && brand.setLogoDataUrl(reader.result);
    reader.readAsDataURL(file);
  }
  return (
    <div className="grid gap-4">
      <section className="card">
        <div className="card-title">
          <h3>主题</h3>
        </div>
        <div className="card-body">
          <p className="mb-4 text-sm text-ink-3">选择完整视觉主题，界面会立即预览并保存在本机。</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {THEMES.map((item) => {
              const active = item.name === theme;
              return (
                <button
                  key={item.name}
                  onClick={() => setTheme(item.name)}
                  className={`rounded-lg border p-3 text-left transition ${active ? 'border-accent ring-2 ring-accent/20' : 'border-line hover:border-line-strong'}`}
                >
                  <div
                    className={`mb-2 h-20 rounded-md theme-choice-preview theme-choice-preview-${item.name}`}
                    style={{
                      backgroundColor: item.color,
                    }}
                  />
                  <div className="flex items-center justify-between text-sm font-medium">
                    {item.label}
                    {active && <span className="text-xs text-accent">当前</span>}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </section>
      <section className="card">
        <div className="card-title">
          <h3>主题装饰</h3>
        </div>
        <div className="card-body grid gap-5">
          <p className="text-sm text-ink-3">
            分别设置顶部横幅和左侧 AI 卡片。图片与文案只在当前主题下生效，图片保存在此设备。
          </p>
          <ThemeDecorationEditor
            title="主页顶部横幅"
            description="显示在主页标题和看板内容之间，对应附件中的绿框。"
            value={decorations[theme].hero}
            onChange={(patch) => updateDecoration(theme, 'hero', patch)}
            onReset={() => resetDecoration(theme, 'hero')}
          />
          <div className="border-t border-line" />
          <ThemeDecorationEditor
            title="侧栏 AI 卡片"
            description="显示在导航与账号信息之间，对应附件中的红框。"
            value={decorations[theme].sidebar}
            onChange={(patch) => updateDecoration(theme, 'sidebar', patch)}
            onReset={() => resetDecoration(theme, 'sidebar')}
          />
        </div>
      </section>
      <section className="card">
        <div className="card-title">
          <h3>工作站标识</h3>
        </div>
        <div className="card-body grid gap-5 lg:grid-cols-[180px_minmax(0,1fr)]">
          <div className="rounded-xl border border-[#D9E4F1] bg-[#F6F9FD] p-4">
            <div className="mb-3 text-xs font-medium text-ink-3">侧栏预览</div>
            <div className="flex items-center gap-2.5">
              <span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-lg bg-accent text-lg font-medium text-white shadow-sm">
                {brand.logoDataUrl ? (
                  <img
                    src={brand.logoDataUrl}
                    alt="工作站图标预览"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  '工'
                )}
              </span>
              <span
                className="min-w-0 truncate font-semibold"
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
              >
                {brand.title || '个人工作站'}
              </span>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-sm">
              <span className="text-[11px] font-medium text-ink-3">显示名称</span>
              <input
                className="input-lite"
                value={brand.title}
                maxLength={32}
                onChange={(event) => brand.setTitle(event.target.value)}
              />
              <span className="text-[10.5px] text-ink-4">侧栏名称也可直接双击修改。</span>
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-[11px] font-medium text-ink-3">字体</span>
              <select
                className="input-lite"
                value={brand.font}
                onChange={(event) => brand.setFont(event.target.value as BrandFont)}
              >
                <option value="serif">衬线字体</option>
                <option value="sans">无衬线字体</option>
                <option value="yahei">微软雅黑</option>
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              <span className="flex items-center justify-between text-[11px] font-medium text-ink-3">
                字体大小 <b className="font-medium text-ink-2">{brand.fontSize}px</b>
              </span>
              <input
                type="range"
                min="13"
                max="28"
                value={brand.fontSize}
                onChange={(event) => brand.setFontSize(Number(event.target.value))}
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-[11px] font-medium text-ink-3">文字颜色</span>
              <div className="flex gap-2">
                <input
                  type="color"
                  className="h-9 w-11 cursor-pointer rounded border border-line bg-canvas p-1"
                  value={brand.color}
                  onChange={(event) => brand.setColor(event.target.value)}
                />
                <input
                  className="input-lite min-w-0 flex-1"
                  value={brand.color}
                  onChange={(event) => brand.setColor(event.target.value)}
                  maxLength={7}
                />
              </div>
            </label>
            <div className="flex flex-wrap items-end gap-2 sm:col-span-2">
              <input
                ref={logoInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                onChange={importBrandLogo}
              />
              <button className="btn" onClick={() => logoInputRef.current?.click()}>
                导入自定义图标
              </button>
              {brand.logoDataUrl && (
                <button className="btn" onClick={() => brand.setLogoDataUrl(null)}>
                  恢复默认图标
                </button>
              )}
              <button className="btn btn-ghost" onClick={brand.reset}>
                恢复默认标识
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function ThemeDecorationEditor({
  title,
  description,
  value,
  onChange,
  onReset,
}: {
  title: string;
  description: string;
  value: ThemeSlot;
  onChange: (patch: Partial<ThemeSlot>) => void;
  onReset: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  function importImage(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) return window.alert('请选择 PNG、JPG 或 WebP 图片。');
    if (file.size > 1_000_000) return window.alert('主题图片请控制在 1 MB 以内。');
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === 'string' && onChange({ imageDataUrl: reader.result });
    reader.readAsDataURL(file);
  }
  return (
    <section className="grid gap-3 lg:grid-cols-[220px_minmax(0,1fr)]">
      <div className="theme-setting-preview">
        <div
          className="theme-setting-preview-image"
          style={{
            ...(value.imageDataUrl ? { backgroundImage: `url(${value.imageDataUrl})` } : {}),
          }}
        />
        <span>{value.enabled ? '已启用' : '已隐藏'}</span>
      </div>
      <div className="grid gap-3">
        <div>
          <h4 className="text-sm font-semibold text-ink">{title}</h4>
          <p className="mt-1 text-xs text-ink-3">{description}</p>
        </div>
        <label className="flex items-center gap-2 text-sm text-ink-2">
          <input
            type="checkbox"
            checked={value.enabled}
            onChange={(event) => onChange({ enabled: event.target.checked })}
          />
          显示此装饰位
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-sm">
            <span className="text-[11px] font-medium text-ink-3">标题</span>
            <input
              className="input-lite"
              value={value.title}
              maxLength={40}
              onChange={(event) => onChange({ title: event.target.value })}
            />
          </label>
          <label className="grid gap-1 text-sm sm:col-span-2">
            <span className="text-[11px] font-medium text-ink-3">说明文字</span>
            <input
              className="input-lite"
              value={value.description}
              maxLength={60}
              onChange={(event) => onChange({ description: event.target.value })}
            />
          </label>
          <label className="grid gap-1 text-sm sm:col-span-2">
            <span className="flex justify-between text-[11px] font-medium text-ink-3">
              卡片透明度{' '}
              <b className="font-medium text-ink-2">{Math.round(value.cardOpacity * 100)}%</b>
            </span>
            <input
              type="range"
              min="30"
              max="100"
              value={Math.round(value.cardOpacity * 100)}
              onChange={(event) => onChange({ cardOpacity: Number(event.target.value) / 100 })}
            />
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={importImage}
          />
          <button className="btn" onClick={() => fileRef.current?.click()}>
            {value.imageDataUrl ? '替换图片' : '上传图片'}
          </button>
          {value.imageDataUrl && (
            <button className="btn" onClick={() => onChange({ imageDataUrl: null })}>
              移除图片
            </button>
          )}
          <button className="btn btn-ghost" onClick={onReset}>
            恢复此主题默认值
          </button>
        </div>
      </div>
    </section>
  );
}

function SettingRow({
  title,
  description,
  action,
  onClick,
}: {
  title: string;
  description: string;
  action: string;
  onClick: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <div className="text-sm font-medium">{title}</div>
        <p className="mt-1 text-xs text-ink-3">{description}</p>
      </div>
      <button className="btn" onClick={onClick}>
        {action}
      </button>
    </div>
  );
}

function DataSettings() {
  const nav = useNavigate();
  return (
    <section className="card">
      <div className="card-title">
        <h3>数据管理</h3>
      </div>
      <div className="card-body grid gap-3">
        <SettingRow
          title="回收站"
          description="查看、还原或永久删除已软删除的数据。"
          action="打开回收站"
          onClick={() => nav('/settings/recycle')}
        />
        <div className="border-t border-line" />
        <SettingRow
          title="数据备份 / 恢复"
          description="打包数据库和项目文件，随时恢复到备份时间点。"
          action="打开备份管理"
          onClick={() => nav('/settings/backup')}
        />
        <div className="border-t border-line" />
        <SettingRow
          title="运行诊断"
          description="检查数据库完整性、备份存量和本机数据位置，用于排查启动或数据问题。"
          action="打开诊断"
          onClick={() => nav('/settings/diagnostics')}
        />
      </div>
    </section>
  );
}

function AccountSettings() {
  const current = useAccountStore((state) => state.current);
  const setCurrent = useAccountStore((state) => state.setCurrent);
  const [displayName, setDisplayName] = useState(current?.display_name ?? '');
  const [profileMessage, setProfileMessage] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [nextPassword, setNextPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [securityMessage, setSecurityMessage] = useState('');
  const [recoveryPassword, setRecoveryPassword] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  // 数据层保存的是“是否要求密码”；界面按用户习惯展示“是否直接打开”。
  const [directOpen, setDirectOpen] = useState(true);
  const [passwordRequirementReady, setPasswordRequirementReady] = useState(false);
  const [savingPasswordRequirement, setSavingPasswordRequirement] = useState(false);

  useEffect(() => setDisplayName(current?.display_name ?? ''), [current?.display_name]);
  useEffect(() => {
    let mounted = true;
    void getOwnerPasswordRequirement()
      .then((required) => {
        if (mounted) setDirectOpen(!required);
      })
      .catch(() => {
        if (mounted) setSecurityMessage('读取启动密码设置失败。');
      })
      .finally(() => {
        if (mounted) setPasswordRequirementReady(true);
      });
    return () => {
      mounted = false;
    };
  }, []);

  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    setProfileMessage('');
    try {
      await updateOwnerProfile({ displayName });
      if (current) setCurrent({ ...current, display_name: displayName.trim() });
      setProfileMessage('个人资料已保存。');
    } catch (reason) {
      setProfileMessage(reason instanceof Error ? reason.message : String(reason));
    }
  }

  async function savePassword(event: FormEvent) {
    event.preventDefault();
    setSecurityMessage('');
    if (nextPassword !== confirmPassword) return setSecurityMessage('两次输入的新密码不一致。');
    try {
      await changeOwnerPassword(currentPassword, nextPassword);
      setCurrentPassword('');
      setNextPassword('');
      setConfirmPassword('');
      setSecurityMessage('本机保护密码已更新。');
    } catch (reason) {
      setSecurityMessage(reason instanceof Error ? reason.message : String(reason));
    }
  }

  async function rotateRecovery(event: FormEvent) {
    event.preventDefault();
    setRecoveryCode('');
    try {
      setRecoveryCode(await rotateOwnerRecoveryCode(recoveryPassword));
      setRecoveryPassword('');
    } catch (reason) {
      setSecurityMessage(reason instanceof Error ? reason.message : String(reason));
    }
  }

  async function copyRecovery() {
    await navigator.clipboard.writeText(recoveryCode);
    setSecurityMessage('恢复码已复制；请保存在密码管理器中。');
  }

  async function toggleDirectOpen(enabled: boolean) {
    const previous = directOpen;
    setDirectOpen(enabled);
    setSavingPasswordRequirement(true);
    setSecurityMessage('');
    try {
      await setOwnerPasswordRequirement(!enabled);
      setSecurityMessage(
        enabled ? '已保存；下次将直接打开软件，无需输入密码。' : '已保存；下次打开软件时需要输入密码。',
      );
    } catch (reason) {
      setDirectOpen(previous);
      setSecurityMessage(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSavingPasswordRequirement(false);
    }
  }

  return (
    <div className="grid max-w-2xl gap-4">
      <section className="card">
        <div className="card-title">
          <h3>个人资料</h3>
        </div>
        <form className="card-body grid gap-3" onSubmit={saveProfile}>
          <p className="text-sm text-ink-3">
            此工作台仅供你本人使用；不再提供账号切换、角色或成员管理。
          </p>
          <label className="text-xs text-ink-3" htmlFor="account-display-name">
            显示名称
          </label>
          <input
            id="account-display-name"
            className="input-lite max-w-md"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
          />
          {profileMessage && <p className="text-xs text-ink-3">{profileMessage}</p>}
          <button className="btn btn-primary w-fit" type="submit">
            保存个人资料
          </button>
        </form>
      </section>

      <section className="card">
        <div className="card-title">
          <h3>本机保护</h3>
        </div>
        <div className="card-body grid gap-5">
          <label className="flex max-w-md items-start gap-3 rounded-lg border border-line bg-paper p-3">
            <input
              className="mt-0.5"
              type="checkbox"
              checked={directOpen}
              disabled={!passwordRequirementReady || savingPasswordRequirement}
              onChange={(event) => void toggleDirectOpen(event.target.checked)}
            />
            <span>
              <span className="block text-sm font-medium text-ink">打开软件不需要输入密码</span>
              <span className="mt-1 block text-xs leading-5 text-ink-3">
                勾选后，默认直接打开软件，无需输入密码；取消勾选后，打开软件时需要验证本机保护密码。
                {savingPasswordRequirement && ' 正在保存…'}
              </span>
            </span>
          </label>
          <form className="grid gap-3" onSubmit={savePassword}>
            <p className="text-sm text-ink-3">
              修改用于保护本机工作台数据的密码。密码不会同步到网络服务。
            </p>
            <input
              className="input-lite max-w-md"
              type="password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              placeholder="当前密码"
              autoComplete="current-password"
              required
            />
            <input
              className="input-lite max-w-md"
              type="password"
              value={nextPassword}
              onChange={(event) => setNextPassword(event.target.value)}
              placeholder="新密码，至少 8 位"
              autoComplete="new-password"
              required
            />
            <input
              className="input-lite max-w-md"
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              placeholder="再次输入新密码"
              autoComplete="new-password"
              required
            />
            <button className="btn w-fit" type="submit">
              修改密码
            </button>
          </form>
          <form className="grid gap-3 border-t border-line pt-5" onSubmit={rotateRecovery}>
            <p className="text-sm text-ink-3">
              更新恢复码会让旧恢复码立即失效。请先输入当前密码确认。
            </p>
            <input
              className="input-lite max-w-md"
              type="password"
              value={recoveryPassword}
              onChange={(event) => setRecoveryPassword(event.target.value)}
              placeholder="当前密码"
              autoComplete="current-password"
              required
            />
            <button className="btn w-fit" type="submit">
              生成新的恢复码
            </button>
            {recoveryCode && (
              <div className="grid max-w-md gap-2 rounded-lg bg-paper p-3">
                <output className="font-mono tracking-wider">{recoveryCode}</output>
                <button className="btn w-fit" type="button" onClick={() => void copyRecovery()}>
                  复制恢复码
                </button>
              </div>
            )}
          </form>
          {securityMessage && <p className="text-xs text-ink-3">{securityMessage}</p>}
        </div>
      </section>
    </div>
  );
}

function NotificationSettings() {
  const [desktopNotifications, setDesktopNotifications] = useState(true);
  const [dailyReminder, setDailyReminder] = useState(false);
  const [dailyReminderTime, setDailyReminderTime] = useState('09:00');
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    void Promise.all([
      getSetting('app', 'notification.desktop.enabled'),
      getSetting('app', 'notification.desktop.daily.enabled'),
      getSetting('app', 'notification.desktop.daily.time'),
    ]).then(([desktop, daily, dailyTime]) => {
      setDesktopNotifications(desktop !== '0');
      setDailyReminder(daily === '1');
      setDailyReminderTime(/^\d{2}:\d{2}$/.test(dailyTime ?? '') ? dailyTime! : '09:00');
    });
  }, []);
  async function save() {
    const [rawHour, rawMinute] = dailyReminderTime.split(':').map(Number);
    const hour = Math.max(0, Math.min(23, Number.isFinite(rawHour) ? rawHour : 9));
    const minute = Math.max(0, Math.min(59, Number.isFinite(rawMinute) ? rawMinute : 0));
    const normalizedReminderTime = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    await Promise.all([
      setSetting('app', 'notification.desktop.enabled', desktopNotifications ? '1' : '0'),
      setSetting('app', 'notification.desktop.daily.enabled', dailyReminder ? '1' : '0'),
      setSetting('app', 'notification.desktop.daily.time', normalizedReminderTime),
    ]);
    const scheduled = await syncDailyDesktopReminder(dailyReminder, hour, minute);
    if (dailyReminder && !scheduled)
      alert('系统未授予通知权限，每日提醒没有启用；应用内通知中心不受影响。');
    setSaved(true);
    window.setTimeout(() => {
      setSaved(false);
    }, 3000);
  }
  return (
    <section className="card">
      <div className="card-title">
        <h3>通知提醒</h3>
      </div>
      <div className="card-body grid gap-4 text-sm">
        <label className="flex items-start gap-2">
          <input
            className="mt-0.5"
            type="checkbox"
            checked={desktopNotifications}
            onChange={(event) => setDesktopNotifications(event.target.checked)}
          />
          <span>
            <span className="font-medium text-ink">显示 Windows 系统提醒</span>
            <span className="mt-0.5 block text-xs text-ink-4">
              应用运行时每 5 分钟检查一次待办、逾期和英语复习；通知中心始终保留记录。
            </span>
          </span>
        </label>
        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={dailyReminder}
            onChange={(event) => setDailyReminder(event.target.checked)}
          />
          每日工作站提醒
          <input
            className="input-lite w-28"
            type="time"
            value={dailyReminderTime}
            disabled={!dailyReminder}
            onChange={(event) => setDailyReminderTime(event.target.value)}
            aria-label="每日提醒时间"
          />
        </label>
        <p className="-mt-2 text-xs text-ink-4">
          每日提醒会以系统计划通知形式提示你打开工作站查看当天的实际事项。
        </p>
        <div>
          <button className="btn btn-primary" onClick={() => void save()}>
            保存提醒设置
          </button>
          {saved && <span className="ml-3 text-ok text-xs">已保存</span>}
        </div>
      </div>
    </section>
  );
}

export function SettingsPage() {
  const [params, setParams] = useSearchParams();
  const requested = params.get('tab');
  const activeTab: SettingsTab = TABS.some(([id]) => id === requested)
    ? (requested as SettingsTab)
    : 'appearance';
  const [renderedTabs, setRenderedTabs] = useState<SettingsTab[]>([activeTab]);
  function selectTab(tab: SettingsTab) {
    if (!renderedTabs.includes(tab)) setRenderedTabs((current) => [...current, tab]);
    setParams(tab === 'appearance' ? {} : { tab });
  }
  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-[1280px] flex-col p-4 sm:p-6">
      <header className="mb-4 px-1">
        <h1 className="serif text-[28px] font-semibold text-ink">系统设置</h1>
        <p className="mt-1 text-[13px] text-ink-3">在这里管理工作站外观、数据、账号和 AI 服务。</p>
      </header>
      <nav
        className="mb-4 flex shrink-0 gap-1 overflow-x-auto rounded-xl border border-line bg-paper p-1.5"
        aria-label="设置分类"
      >
        {TABS.map(([id, label]) => (
          <button
            key={id}
            onClick={() => selectTab(id)}
            className={`whitespace-nowrap rounded-lg px-3.5 py-2 text-sm transition ${activeTab === id ? 'bg-canvas font-semibold text-accent shadow-sm' : 'text-ink-3 hover:text-ink'}`}
          >
            {label}
          </button>
        ))}
      </nav>
      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {renderedTabs.map((tab) => (
          <div key={tab} className={tab === activeTab ? 'block pb-4' : 'hidden'}>
            {tab === 'appearance' && <AppearanceSettings />}
            {tab === 'parameters' && <ParamSettings />}
            {tab === 'schedule' && (
              <div className="grid gap-4">
                <ScheduleSettings />
                <NotificationSettings />
              </div>
            )}
            {tab === 'data' && <DataSettings />}
            {tab === 'accounts' && <AccountSettings />}
            {tab === 'ai' && <ProviderConnections embedded />}
          </div>
        ))}
      </div>
    </div>
  );
}
