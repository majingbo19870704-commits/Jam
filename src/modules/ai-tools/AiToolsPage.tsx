import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import {
  Bot,
  ExternalLink,
  Globe2,
  KeyRound,
  Plus,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Trash2,
  X,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { open as openInShell } from '@tauri-apps/plugin-shell';
import { LogicalPosition, LogicalSize } from '@tauri-apps/api/dpi';
import { Webview } from '@tauri-apps/api/webview';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  createAiTool,
  deleteAiTool,
  listAiTools,
  reorderAiTools,
  updateAiTool,
  type AiToolLink,
} from '@/db/ai-tool-dao';
import {
  deleteAiWebAccount,
  getAiWebAccount,
  hasAiWebAccountPassword,
  saveAiWebAccount,
  type AiWebAccount,
  type WebAccountDraft,
} from '@/db/ai-web-account-dao';
import { useAccountStore } from '@/stores/account';
import { useThemeStore } from '@/stores/theme';

type WorkspaceDraft = {
  name: string;
  url: string;
  description: string;
};

const DEFAULT_WORKSPACES: WorkspaceDraft[] = [
  { name: 'ChatGPT', url: 'https://chatgpt.com', description: 'OpenAI 官方对话与创作工作区' },
  { name: 'Claude', url: 'https://claude.ai', description: 'Anthropic Claude 网页工作区' },
  { name: '通义千问', url: 'https://www.qianwen.com', description: '阿里通义千问网页工作区' },
  { name: '豆包', url: 'https://www.doubao.com/chat/', description: '字节豆包网页工作区' },
  { name: 'Kimi', url: 'https://www.kimi.com', description: 'Kimi 对话、研究与创作工作区' },
];

const WORKSPACE_STYLES: Record<string, { glyph: string; color: string; tint: string }> = {
  ChatGPT: { glyph: 'G', color: '#10A37F', tint: '#E8F7F2' },
  Claude: { glyph: 'C', color: '#C56A45', tint: '#FFF1EB' },
  通义千问: { glyph: 'Q', color: '#4D6BFE', tint: '#EEF1FF' },
  豆包: { glyph: 'D', color: '#2D7FF9', tint: '#EAF3FF' },
  Kimi: { glyph: 'K', color: '#7563EE', tint: '#F0EEFF' },
};

function workspaceStyle(name: string) {
  return (
    WORKSPACE_STYLES[name] ?? {
      glyph: name.trim().charAt(0).toUpperCase() || 'A',
      color: '#2E5BFF',
      tint: '#EAF1FD',
    }
  );
}

function windowLabel(id: string) {
  return `ai-workspace-${id.replace(/[^A-Za-z0-9_\-/:]/g, '-')}`;
}

function embeddedBrowserLabel(id: string) {
  return `ai-embedded-${id.replace(/[^A-Za-z0-9_\-/:]/g, '-')}`;
}

function WorkspaceModal({
  initial,
  onClose,
  onDelete,
  onSave,
}: {
  initial?: AiToolLink;
  onClose: () => void;
  onDelete?: () => Promise<void>;
  onSave: (draft: WorkspaceDraft) => Promise<void>;
}) {
  const [draft, setDraft] = useState<WorkspaceDraft>({
    name: initial?.name ?? '',
    url: initial?.url ?? '',
    description: initial?.description ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    const name = draft.name.trim();
    const url = draft.url.trim();
    if (!name) {
      setError('请输入工作区名称。');
      return;
    }
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
    } catch {
      setError('请输入以 http:// 或 https:// 开头的网址。');
      return;
    }
    setSaving(true);
    try {
      await onSave({ name, url, description: draft.description.trim() });
      onClose();
    } catch (e) {
      setError(`保存失败：${String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[100] grid place-items-center bg-slate-950/35 p-4 backdrop-blur-[1px]"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="flex max-h-[calc(100vh-2rem)] w-full max-w-[520px] flex-col overflow-hidden rounded-2xl border border-[#D7E1EE] bg-canvas shadow-[0_24px_72px_rgba(22,37,57,.28)]"
        role="dialog"
        aria-modal="true"
        aria-label={initial ? '编辑网页工作区' : '添加网页工作区'}
      >
        <div className="flex items-start justify-between border-b border-[#E2E9F1] px-5 py-4">
          <div>
            <h2 className="text-[16px] font-semibold leading-6 text-ink">
              {initial ? '编辑网页工作区' : '添加网页工作区'}
            </h2>
            <p className="mt-1 text-[12px] font-normal text-ink-3">
              登录由对应网站自行完成，个人工作站不保存网站密码。
            </p>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">
            <X size={16} />
          </button>
        </div>
        <div className="grid gap-4 overflow-y-auto px-5 py-4">
          <label className="form-label">
            工作区名称 <span className="text-danger">*</span>
            <input
              className="input mt-1"
              value={draft.name}
              onChange={(event) =>
                setDraft((current) => ({ ...current, name: event.target.value }))
              }
              placeholder="例如：团队版 ChatGPT"
            />
          </label>
          <label className="form-label">
            网页地址 <span className="text-danger">*</span>
            <input
              className="input mt-1"
              value={draft.url}
              onChange={(event) => setDraft((current) => ({ ...current, url: event.target.value }))}
              placeholder="https://…"
            />
          </label>
          <label className="form-label">
            使用说明
            <input
              className="input mt-1"
              value={draft.description}
              onChange={(event) =>
                setDraft((current) => ({ ...current, description: event.target.value }))
              }
              placeholder="说明此工作区对应的账号或使用场景"
            />
          </label>
          {error && (
            <div className="rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">{error}</div>
          )}
        </div>
        <div className="flex items-center justify-between border-t border-[#E2E9F1] px-5 py-3.5">
          <div>
            {onDelete && (
              <button
                className="btn btn-danger"
                disabled={saving}
                onClick={async () => {
                  if (!confirm(`删除网页工作区「${initial?.name}」？`)) return;
                  setSaving(true);
                  try {
                    await onDelete();
                    onClose();
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                <Trash2 size={14} /> 删除工作区
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button className="btn" onClick={onClose} disabled={saving}>
              取消
            </button>
            <button className="btn btn-primary" onClick={submit} disabled={saving}>
              保存工作区
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

const DEFAULT_USERNAME_SELECTOR =
  'input[type="email"], input[name="email"], input[name="username"]';
const DEFAULT_PASSWORD_SELECTOR = 'input[type="password"]';

function WebLoginModal({
  workspace,
  initial,
  onClose,
  onSave,
  onDelete,
}: {
  workspace: AiToolLink;
  initial: AiWebAccount | null;
  onClose: () => void;
  onSave: (draft: WebAccountDraft) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<WebAccountDraft>({
    loginUrl: initial?.login_url ?? workspace.url,
    username: initial?.username ?? '',
    password: '',
    usernameSelector: initial?.username_selector ?? DEFAULT_USERNAME_SELECTOR,
    passwordSelector: initial?.password_selector ?? DEFAULT_PASSWORD_SELECTOR,
    submitSelector: initial?.submit_selector ?? '',
    autoLogin: Boolean(initial?.auto_login),
  });
  const [hasPassword, setHasPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!initial) return;
    void hasAiWebAccountPassword(initial)
      .then(setHasPassword)
      .catch(() => setHasPassword(false));
  }, [initial]);

  function patch<K extends keyof WebAccountDraft>(key: K, value: WebAccountDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function submit() {
    setSaving(true);
    setError('');
    try {
      await onSave(draft);
      onClose();
    } catch (reason) {
      setError(String(reason).replace(/^Error: /, ''));
    } finally {
      setSaving(false);
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[110] grid place-items-center bg-slate-950/35 p-4 backdrop-blur-[1px]"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="flex max-h-[calc(100vh-2rem)] w-full max-w-[620px] flex-col overflow-hidden rounded-2xl border border-[#D7E1EE] bg-canvas shadow-[0_24px_72px_rgba(22,37,57,.28)]"
        role="dialog"
        aria-modal="true"
        aria-label={`${workspace.name} 登录配置`}
      >
        <div className="flex items-start justify-between border-b border-[#E2E9F1] px-5 py-4">
          <div>
            <h2 className="text-[16px] font-semibold leading-6 text-ink">登录配置</h2>
            <p className="mt-1 text-[12px] leading-5 text-ink-3">
              密码仅以 Windows 本机加密方式保存，自动填充不会把密码发送给模型。
            </p>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">
            <X size={16} />
          </button>
        </div>
        <div className="grid gap-4 overflow-y-auto px-5 py-4">
          <label className="form-label">
            登录页面地址 <span className="text-danger">*</span>
            <input
              className="input mt-1"
              value={draft.loginUrl}
              onChange={(event) => patch('loginUrl', event.target.value)}
              placeholder="https://example.com/login"
            />
          </label>
          <label className="form-label">
            登录账号 <span className="text-danger">*</span>
            <input
              className="input mt-1"
              value={draft.username}
              onChange={(event) => patch('username', event.target.value)}
              autoComplete="username"
            />
          </label>
          <label className="form-label">
            网站密码{' '}
            {initial && <span className="ml-1 font-normal text-ink-3">（留空则保持不变）</span>}
            <input
              className="input mt-1"
              type="password"
              value={draft.password}
              onChange={(event) => patch('password', event.target.value)}
              autoComplete="new-password"
              placeholder={hasPassword ? '已加密保存' : '输入网站密码'}
            />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="form-label">
              账号输入框选择器 <span className="text-danger">*</span>
              <input
                className="input mt-1 font-mono text-[12px]"
                value={draft.usernameSelector}
                onChange={(event) => patch('usernameSelector', event.target.value)}
              />
            </label>
            <label className="form-label">
              密码输入框选择器 <span className="text-danger">*</span>
              <input
                className="input mt-1 font-mono text-[12px]"
                value={draft.passwordSelector}
                onChange={(event) => patch('passwordSelector', event.target.value)}
              />
            </label>
          </div>
          <label className="form-label">
            提交按钮选择器{' '}
            <span className="font-normal text-ink-3">（可选；留空只填入，不点击登录）</span>
            <input
              className="input mt-1 font-mono text-[12px]"
              value={draft.submitSelector}
              onChange={(event) => patch('submitSelector', event.target.value)}
              placeholder='button[type="submit"]'
            />
          </label>
          <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-[#DCE6F2] bg-[#F7FAFE] px-3 py-3 text-[12px] text-ink-2">
            <input
              className="mt-0.5"
              type="checkbox"
              checked={draft.autoLogin}
              onChange={(event) => patch('autoLogin', event.target.checked)}
            />
            <span>
              <span className="block font-medium text-ink">打开工作区后自动填充</span>
              仅在当前页面与上方登录地址同一网站时执行。验证码、扫码和双重验证需要手动完成。
            </span>
          </label>
          {error && (
            <div className="rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">{error}</div>
          )}
        </div>
        <div className="flex items-center justify-between border-t border-[#E2E9F1] px-5 py-3.5">
          <div>
            {initial && (
              <button
                className="btn btn-danger"
                disabled={saving}
                onClick={async () => {
                  if (!confirm(`清除「${workspace.name}」的登录配置和本机加密密码？`)) return;
                  setSaving(true);
                  try {
                    await onDelete();
                    onClose();
                  } catch (reason) {
                    setError(String(reason).replace(/^Error: /, ''));
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                <Trash2 size={14} /> 清除登录配置
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button className="btn" onClick={onClose} disabled={saving}>
              取消
            </button>
            <button className="btn btn-primary" onClick={submit} disabled={saving}>
              保存登录配置
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function AiWorkbenchPage() {
  const theme = useThemeStore((state) => state.theme);
  const [workspaces, setWorkspaces] = useState<AiToolLink[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [previewKey, setPreviewKey] = useState(0);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AiToolLink | null>(null);
  const [loginWorkspace, setLoginWorkspace] = useState<AiToolLink | null>(null);
  const [loginProfile, setLoginProfile] = useState<AiWebAccount | null>(null);
  const [fillingLogin, setFillingLogin] = useState(false);
  const [message, setMessage] = useState('');
  const [embeddedBrowserError, setEmbeddedBrowserError] = useState('');
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [listCollapsed, setListCollapsed] = useState(() => {
    try {
      return localStorage.getItem('ai_workbench_service_list_collapsed') === 'true';
    } catch {
      return false;
    }
  });
  const [serviceListWidth, setServiceListWidth] = useState(() => {
    try {
      const saved = Number(localStorage.getItem('ai_workbench_service_list_width'));
      return Number.isFinite(saved) && saved >= 140 && saved <= 360 ? saved : 188;
    } catch {
      return 188;
    }
  });
  const serviceResizeRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const browserHostRef = useRef<HTMLDivElement | null>(null);
  const embeddedBrowserRef = useRef<Webview | null>(null);
  const embeddedBrowserRefs = useRef(new Map<string, Webview>());
  const embeddedBrowserWorkspaceRef = useRef<string | null>(null);
  const embeddedBrowserPreviewRef = useRef<number | null>(null);
  const embeddedBrowserTaskRef = useRef(0);
  const accountId = useAccountStore((state) => state.currentAccountId);

  async function refresh(preferredId?: string) {
    setLoading(true);
    try {
      let rows = await listAiTools('AI 工作台');
      if (rows.length === 0) {
        for (const workspace of DEFAULT_WORKSPACES) {
          await createAiTool({ ...workspace, groupName: 'AI 工作台' });
        }
        rows = await listAiTools('AI 工作台');
      }
      setWorkspaces(rows);
      setActiveId((current) => {
        if (preferredId && rows.some((workspace) => workspace.id === preferredId))
          return preferredId;
        if (current && rows.some((workspace) => workspace.id === current)) return current;
        return rows[0]?.id ?? null;
      });
    } catch (e) {
      setMessage(`无法读取 AI 工作区：${String(e)}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  const activeWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === activeId) ?? null,
    [workspaces, activeId],
  );

  async function sizeEmbeddedBrowser(browser = embeddedBrowserRef.current) {
    const host = browserHostRef.current;
    if (!browser || !host) return;
    const rect = host.getBoundingClientRect();
    if (rect.width < 32 || rect.height < 32) return;
    await Promise.all([
      browser.setPosition(new LogicalPosition(Math.round(rect.left), Math.round(rect.top))),
      browser.setSize(new LogicalSize(Math.round(rect.width), Math.round(rect.height))),
    ]);
  }

  async function closeEmbeddedBrowser(workspaceId?: string) {
    const retained = workspaceId
      ? (embeddedBrowserRefs.current.get(workspaceId) ??
        (await Webview.getByLabel(embeddedBrowserLabel(workspaceId))))
      : null;
    const entries = workspaceId
      ? [[workspaceId, retained] as const]
      : Array.from(embeddedBrowserRefs.current.entries());
    for (const [id, browser] of entries) {
      embeddedBrowserRefs.current.delete(id);
      if (!browser) continue;
      try {
        await browser.close();
      } catch {
        /* Native view may already be closed. */
      }
    }
    if (!workspaceId || embeddedBrowserWorkspaceRef.current === workspaceId) {
      embeddedBrowserRef.current = null;
      embeddedBrowserWorkspaceRef.current = null;
      embeddedBrowserPreviewRef.current = null;
    }
  }

  async function hideEmbeddedBrowsers() {
    await Promise.all(
      Array.from(embeddedBrowserRefs.current.values()).map((browser) =>
        browser.hide().catch(() => undefined),
      ),
    );
  }

  async function openLoginConfig(workspace: AiToolLink) {
    try {
      const profile = await getAiWebAccount(workspace.id);
      setLoginProfile(profile);
      setLoginWorkspace(workspace);
    } catch (error) {
      setMessage(`无法读取登录配置：${String(error)}`);
    }
  }

  const fillConfiguredLogin = useCallback(
    async (workspace: AiToolLink, quiet = false, webviewLabel?: string) => {
      if (!accountId) return;
      setFillingLogin(true);
      try {
        await invoke('fill_configured_web_login', {
          request: { accountId, workspaceId: workspace.id, webviewLabel },
        });
        if (!quiet) {
          setMessage('已填入登录账号和密码；如网站要求验证码或双重验证，请继续手动完成。');
        }
      } catch (error) {
        if (!quiet) setMessage(`无法自动填充：${String(error).replace(/^Error: /, '')}`);
      } finally {
        setFillingLogin(false);
      }
    },
    [accountId],
  );

  useEffect(() => {
    const task = ++embeddedBrowserTaskRef.current;
    const shouldHideForDialog = creating || Boolean(editing) || Boolean(loginWorkspace);

    async function mountEmbeddedBrowser() {
      if (shouldHideForDialog) {
        try {
          await Promise.all(
            Array.from(embeddedBrowserRefs.current.values()).map((browser) => browser.hide()),
          );
        } catch {
          // A view that is still being created does not need to block the dialog.
        }
        return;
      }

      if (!activeWorkspace) {
        await closeEmbeddedBrowser();
        return;
      }

      await Promise.all(
        Array.from(embeddedBrowserRefs.current.entries())
          .filter(([id]) => id !== activeWorkspace.id)
          .map(([, browser]) => browser.hide()),
      );
      let existing = embeddedBrowserRefs.current.get(activeWorkspace.id);
      if (!existing) {
        try {
          existing =
            (await Webview.getByLabel(embeddedBrowserLabel(activeWorkspace.id))) ?? undefined;
          if (existing) embeddedBrowserRefs.current.set(activeWorkspace.id, existing);
        } catch {
          // The prior view may have been closed externally; create a new one below.
        }
      }
      if (existing) {
        embeddedBrowserRef.current = existing;
        embeddedBrowserWorkspaceRef.current = activeWorkspace.id;
        try {
          await sizeEmbeddedBrowser(existing);
          await existing.show();
          setEmbeddedBrowserError('');
        } catch (error) {
          if (task === embeddedBrowserTaskRef.current)
            setEmbeddedBrowserError(`无法显示内置浏览器：${String(error)}`);
        }
        return;
      }

      if (task !== embeddedBrowserTaskRef.current || !browserHostRef.current) return;

      const rect = browserHostRef.current.getBoundingClientRect();
      if (rect.width < 32 || rect.height < 32) return;
      setEmbeddedBrowserError('');
      const browser = new Webview(getCurrentWindow(), embeddedBrowserLabel(activeWorkspace.id), {
        url: activeWorkspace.url,
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        // 此标签固定，因此关闭或重启工作站后仍会使用同一受保护的数据目录保存网站会话。
        dataDirectory: 'site-session',
        incognito: false,
        focus: true,
        backgroundColor:
          theme === 'tech-dark' ? '#0F1D35' : theme === 'neumorphic' ? '#EDF2F4' : '#FFFFFF',
      });
      embeddedBrowserRef.current = browser;
      embeddedBrowserRefs.current.set(activeWorkspace.id, browser);
      embeddedBrowserWorkspaceRef.current = activeWorkspace.id;
      embeddedBrowserPreviewRef.current = previewKey;
      void browser.once('tauri://created', async () => {
        if (
          task !== embeddedBrowserTaskRef.current ||
          embeddedBrowserRefs.current.get(activeWorkspace.id) !== browser
        ) {
          await browser.hide().catch(() => undefined);
          return;
        }
        try {
          await sizeEmbeddedBrowser(browser);
          if (embeddedBrowserWorkspaceRef.current === activeWorkspace.id) await browser.show();
          const profile = await getAiWebAccount(activeWorkspace.id);
          if (profile?.auto_login) {
            window.setTimeout(() => {
              if (
                task === embeddedBrowserTaskRef.current &&
                embeddedBrowserRefs.current.get(activeWorkspace.id) === browser
              ) {
                void fillConfiguredLogin(activeWorkspace, true);
              }
            }, 1300);
          }
        } catch (error) {
          setEmbeddedBrowserError(`无法调整内置浏览器：${String(error)}`);
        }
      });
      void browser.once('tauri://error', (event) => {
        if (
          task === embeddedBrowserTaskRef.current &&
          embeddedBrowserRefs.current.get(activeWorkspace.id) === browser
        )
          setEmbeddedBrowserError(`无法创建内置浏览器：${String(event.payload)}`);
      });
    }

    void mountEmbeddedBrowser();
  }, [activeWorkspace, creating, editing, fillConfiguredLogin, loginWorkspace, previewKey, theme]);

  useEffect(() => {
    const host = browserHostRef.current;
    if (!host || creating || editing || loginWorkspace || !activeWorkspace) return;
    const resize = () => {
      void sizeEmbeddedBrowser().catch((error) => {
        setEmbeddedBrowserError(`无法调整内置浏览器：${String(error)}`);
      });
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    window.addEventListener('resize', resize);
    resize();
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', resize);
    };
  }, [activeWorkspace, creating, editing, loginWorkspace, listCollapsed, serviceListWidth]);

  useEffect(
    () => () => {
      ++embeddedBrowserTaskRef.current;
      // 一级菜单切换会卸载页面；此处只隐藏，不销毁网页服务的会话和页面内容。
      void hideEmbeddedBrowsers();
    },
    [],
  );

  async function openNativeWorkspace(workspace: AiToolLink) {
    try {
      const label = windowLabel(workspace.id);
      const existing = await WebviewWindow.getByLabel(label);
      if (existing) {
        await existing.setFocus();
        return;
      }
      const child = new WebviewWindow(label, {
        url: workspace.url,
        title: `${workspace.name} · AI 工作台`,
        // 受保护的 WebView 数据目录会保留网站自身 Cookie/本地会话。
        dataDirectory: 'site-session',
        incognito: false,
        width: 1280,
        height: 900,
        minWidth: 860,
        minHeight: 620,
        center: true,
      });
      child.once('tauri://error', (event) =>
        setMessage(`无法打开内置网页窗口：${String(event.payload)}`),
      );
      child.once('tauri://created', async () => {
        try {
          const profile = await getAiWebAccount(workspace.id);
          if (profile?.auto_login) {
            window.setTimeout(() => void fillConfiguredLogin(workspace, true, label), 1300);
          }
        } catch {
          // 登录配置不影响独立网页窗口本身的打开。
        }
      });
    } catch (e) {
      setMessage(`无法打开内置网页窗口：${String(e)}`);
    }
  }

  async function openInBrowser(workspace: AiToolLink) {
    try {
      await openInShell(workspace.url);
    } catch (e) {
      setMessage(`无法调用系统浏览器：${String(e)}`);
    }
  }

  function toggleServiceList() {
    setListCollapsed((collapsed) => {
      const next = !collapsed;
      localStorage.setItem('ai_workbench_service_list_collapsed', String(next));
      return next;
    });
  }

  function startServiceListResize(event: React.PointerEvent<HTMLButtonElement>) {
    if (listCollapsed) return;
    serviceResizeRef.current = { startX: event.clientX, startWidth: serviceListWidth };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function resizeServiceList(event: React.PointerEvent<HTMLButtonElement>) {
    const resize = serviceResizeRef.current;
    if (!resize) return;
    const next = Math.max(140, Math.min(360, resize.startWidth + event.clientX - resize.startX));
    setServiceListWidth(next);
    localStorage.setItem('ai_workbench_service_list_width', String(next));
  }
  function endServiceListResize() {
    serviceResizeRef.current = null;
  }

  async function moveWorkspace(id: string, direction: -1 | 1) {
    const from = workspaces.findIndex((workspace) => workspace.id === id);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= workspaces.length) return;
    const next = [...workspaces];
    [next[from], next[to]] = [next[to], next[from]];
    setWorkspaces(next);
    try {
      await reorderAiTools(
        next.map((workspace) => workspace.id),
        'AI 工作台',
      );
    } catch (error) {
      setMessage(`保存工作区顺序失败：${String(error)}`);
      await refresh(activeId ?? undefined);
    }
  }

  async function moveWorkspaceBefore(sourceId: string, targetId: string) {
    const from = workspaces.findIndex((workspace) => workspace.id === sourceId);
    const target = workspaces.findIndex((workspace) => workspace.id === targetId);
    if (from < 0 || target < 0 || from === target) return;
    const next = [...workspaces];
    const [moving] = next.splice(from, 1);
    next.splice(from < target ? target - 1 : target, 0, moving);
    setWorkspaces(next);
    try {
      await reorderAiTools(
        next.map((workspace) => workspace.id),
        'AI 工作台',
      );
    } catch (error) {
      setMessage(`保存工作区顺序失败：${String(error)}`);
      await refresh(activeId ?? undefined);
    }
  }

  async function removeWorkspace(workspace: AiToolLink) {
    if (!confirm(`删除网页工作区「${workspace.name}」？`)) return;
    try {
      await closeEmbeddedBrowser(workspace.id);
      await deleteAiTool(workspace.id);
      await refresh();
    } catch (error) {
      setMessage(`删除工作区失败：${String(error)}`);
    }
  }

  return (
    <div className="ai-workbench flex h-full min-h-0 flex-col p-3 sm:p-4 xl:p-5">
      <div className="mx-auto flex min-h-0 w-full max-w-[1680px] flex-1 flex-col gap-3 sm:gap-4">
        {message && (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-[12.5px] text-amber-800">
            <span>{message}</span>
            <button
              className="icon-btn !h-6 !w-6 text-amber-800"
              onClick={() => setMessage('')}
              aria-label="关闭提示"
            >
              <X size={14} />
            </button>
          </div>
        )}

        <section
          className="ai-workbench-grid grid min-h-0 flex-1 grid-cols-1 overflow-visible rounded-2xl border border-line bg-canvas shadow-[0_18px_44px_rgba(34,56,84,0.08)]"
          style={
            {
              '--ai-workbench-list-width': `${listCollapsed ? 0 : serviceListWidth}px`,
            } as CSSProperties
          }
        >
          <aside
            className={`relative flex min-h-0 flex-col border-b border-line bg-band lg:border-b-0 ${
              listCollapsed
                ? 'h-0 overflow-visible border-0 p-0 lg:h-auto lg:border-r-0'
                : 'p-3 lg:border-r'
            }`}
          >
            {!listCollapsed && (
              <>
                <div className="flex items-center justify-between px-2 pb-3 pt-1">
                  <span className="text-[12px] font-semibold text-ink-2">网页服务</span>
                  <div className="flex items-center gap-1.5">
                    <span className="rounded-full bg-accent-tint px-2 py-0.5 text-[11px] text-ink-3 num">
                      {workspaces.length}
                    </span>
                    <button
                      className="grid h-7 w-7 place-items-center rounded-lg bg-accent text-white shadow-sm hover:brightness-95"
                      onClick={() => setCreating(true)}
                      title="新增工作区"
                      aria-label="新增工作区"
                    >
                      <Plus size={15} />
                    </button>
                  </div>
                </div>
                <div className="flex gap-2 overflow-x-auto pb-2 lg:flex-1 lg:flex-col lg:overflow-y-auto lg:overflow-x-visible">
                  {loading && (
                    <div className="px-2 py-6 text-center text-xs text-ink-3">正在加载工作区…</div>
                  )}
                  {!loading &&
                    workspaces.map((workspace) => {
                      const style = workspaceStyle(workspace.name);
                      const isActive = workspace.id === activeWorkspace?.id;
                      return (
                        <div
                          key={workspace.id}
                          draggable
                          onDragStart={(event) => {
                            event.dataTransfer.effectAllowed = 'move';
                            event.dataTransfer.setData('text/plain', workspace.id);
                            setDraggingId(workspace.id);
                          }}
                          onDragOver={(event) => event.preventDefault()}
                          onDrop={(event) => {
                            event.preventDefault();
                            const sourceId = event.dataTransfer.getData('text/plain') || draggingId;
                            if (sourceId) void moveWorkspaceBefore(sourceId, workspace.id);
                            setDraggingId(null);
                          }}
                          onDragEnd={() => setDraggingId(null)}
                          className={`group relative min-w-[176px] lg:min-w-0 ${
                            draggingId === workspace.id ? 'opacity-45' : ''
                          }`}
                        >
                          <button
                            onClick={() => {
                              setActiveId(workspace.id);
                            }}
                            className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2.5 pr-11 text-left transition-colors ${
                              isActive
                                ? 'bg-canvas shadow-[0_3px_10px_rgba(36,59,88,0.10)]'
                                : 'hover:bg-paper'
                            }`}
                          >
                            <span
                              className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[13px] font-bold"
                              style={{ background: style.tint, color: style.color }}
                            >
                              {style.glyph}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[12.5px] font-semibold text-ink">
                                {workspace.name}
                              </span>
                            </span>
                          </button>
                          <div className="absolute right-1 top-1 hidden grid-cols-2 gap-0.5 rounded-md bg-canvas/95 p-0.5 shadow-sm group-hover:grid group-focus-within:grid">
                            <button
                              className="grid h-5 w-5 place-items-center rounded text-ink-3 hover:bg-paper hover:text-ink"
                              onClick={(event) => {
                                event.stopPropagation();
                                setEditing(workspace);
                              }}
                              title={`编辑 ${workspace.name}`}
                              aria-label={`编辑 ${workspace.name}`}
                            >
                              <Settings2 size={12} />
                            </button>
                            <button
                              className="grid h-5 w-5 place-items-center rounded text-ink-3 hover:bg-danger/10 hover:text-danger"
                              onClick={(event) => {
                                event.stopPropagation();
                                void removeWorkspace(workspace);
                              }}
                              title={`删除 ${workspace.name}`}
                              aria-label={`删除 ${workspace.name}`}
                            >
                              <Trash2 size={12} />
                            </button>
                            <button
                              className="grid h-5 w-5 place-items-center rounded text-ink-3 hover:bg-paper hover:text-ink disabled:opacity-30"
                              disabled={workspaces[0]?.id === workspace.id}
                              onClick={(event) => {
                                event.stopPropagation();
                                void moveWorkspace(workspace.id, -1);
                              }}
                              title="上移"
                              aria-label={`上移 ${workspace.name}`}
                            >
                              <ChevronUp size={12} />
                            </button>
                            <button
                              className="grid h-5 w-5 place-items-center rounded text-ink-3 hover:bg-paper hover:text-ink disabled:opacity-30"
                              disabled={workspaces.at(-1)?.id === workspace.id}
                              onClick={(event) => {
                                event.stopPropagation();
                                void moveWorkspace(workspace.id, 1);
                              }}
                              title="下移"
                              aria-label={`下移 ${workspace.name}`}
                            >
                              <ChevronDown size={12} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                </div>
                <div className="mt-2 border-t border-line px-2 pt-3 text-[11px] leading-5 text-ink-3">
                  <ShieldCheck
                    size={13}
                    className="mr-1 inline-block align-[-2px] text-[#4267A5]"
                  />
                  登录资料可按工作区单独配置，密码仅保存于本机加密存储。
                </div>
              </>
            )}
            {!listCollapsed && (
              <button
                className="absolute -right-1 top-0 z-10 hidden h-full w-2 cursor-col-resize lg:block"
                onPointerDown={startServiceListResize}
                onPointerMove={resizeServiceList}
                onPointerUp={endServiceListResize}
                onPointerCancel={endServiceListResize}
                aria-label="拖动调整网页服务列表宽度"
                title="拖动调整网页服务列表宽度"
              />
            )}
            <button
              className="absolute -right-3 top-1/2 z-20 grid h-10 w-5 -translate-y-1/2 place-items-center rounded-r-lg border border-l-0 border-line bg-canvas text-ink-3 shadow-[3px_2px_8px_rgba(36,59,88,.10)] hover:bg-paper hover:text-accent"
              onClick={toggleServiceList}
              title={listCollapsed ? '展开网页服务列表' : '收起网页服务列表'}
              aria-label={listCollapsed ? '展开网页服务列表' : '收起网页服务列表'}
            >
              {listCollapsed ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
            </button>
          </aside>

          <main className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-r-2xl bg-paper p-3 sm:p-4">
            {!activeWorkspace && !loading && (
              <div className="grid flex-1 place-items-center rounded-xl border border-dashed border-[#C7D4E5] bg-canvas p-8 text-center">
                <div>
                  <Bot size={28} className="mx-auto mb-3 text-ink-4" />
                  <p className="font-medium text-ink">还没有网页工作区</p>
                  <p className="mt-1 text-sm text-ink-3">
                    添加一个服务地址后，即可在这里集中使用。
                  </p>
                </div>
              </div>
            )}

            {activeWorkspace &&
              (() => {
                const style = workspaceStyle(activeWorkspace.name);
                return (
                  <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-line bg-canvas shadow-sm">
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-band px-4 py-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <span
                          className="grid h-8 w-8 place-items-center rounded-lg text-xs font-bold"
                          style={{ background: style.tint, color: style.color }}
                        >
                          {style.glyph}
                        </span>
                        <div className="min-w-0">
                          <div className="truncate text-[13.5px] font-semibold">
                            {activeWorkspace.name}
                          </div>
                          <div className="truncate text-[11px] text-ink-3">
                            {activeWorkspace.url}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          className="btn !px-2.5"
                          onClick={() => void fillConfiguredLogin(activeWorkspace)}
                          disabled={fillingLogin}
                          title="按此工作区的登录配置填充账号和密码"
                        >
                          <KeyRound size={14} /> {fillingLogin ? '正在填充' : '自动登录'}
                        </button>
                        <button
                          className="icon-btn"
                          onClick={() => void openLoginConfig(activeWorkspace)}
                          title="登录配置"
                          aria-label="登录配置"
                        >
                          <Settings2 size={15} />
                        </button>
                        <button
                          className="icon-btn"
                          onClick={() =>
                            void closeEmbeddedBrowser(activeWorkspace.id).then(() =>
                              setPreviewKey((key) => key + 1),
                            )
                          }
                          title="刷新预览"
                          aria-label="刷新预览"
                        >
                          <RefreshCw size={15} />
                        </button>
                        <button
                          className="btn !px-2.5"
                          onClick={() => openNativeWorkspace(activeWorkspace)}
                          title="在独立窗口中打开"
                        >
                          <Globe2 size={14} /> 独立窗口
                        </button>
                        <button
                          className="btn !px-2.5"
                          onClick={() => openInBrowser(activeWorkspace)}
                          title="在系统浏览器中打开"
                        >
                          <ExternalLink size={14} /> 浏览器
                        </button>
                      </div>
                    </div>
                    <div ref={browserHostRef} className="relative min-h-[540px] flex-1 bg-canvas">
                      {embeddedBrowserError && (
                        <div className="grid h-full place-items-center p-8 text-center">
                          <div className="max-w-md rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
                            <p className="font-semibold">内置浏览器未能启动</p>
                            <p className="mt-2 text-[12px] leading-5">{embeddedBrowserError}</p>
                            <button
                              className="btn btn-primary mt-4"
                              onClick={() =>
                                void closeEmbeddedBrowser(activeWorkspace.id).then(() =>
                                  setPreviewKey((key) => key + 1),
                                )
                              }
                            >
                              重新打开
                            </button>
                          </div>
                        </div>
                      )}
                      {!embeddedBrowserError && (
                        <div className="pointer-events-none grid h-full place-items-center text-center text-sm text-ink-3">
                          正在打开 {activeWorkspace.name}…
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}
          </main>
        </section>
      </div>

      {creating && (
        <WorkspaceModal
          onClose={() => setCreating(false)}
          onSave={async (draft) => {
            const created = await createAiTool({ ...draft, groupName: 'AI 工作台' });
            await refresh(created.id);
          }}
        />
      )}
      {editing && (
        <WorkspaceModal
          initial={editing}
          onClose={() => setEditing(null)}
          onDelete={async () => {
            await deleteAiTool(editing.id);
            await refresh();
          }}
          onSave={async (draft) => {
            await updateAiTool(editing.id, { ...draft, groupName: 'AI 工作台' });
            await refresh(editing.id);
          }}
        />
      )}
      {loginWorkspace && (
        <WebLoginModal
          workspace={loginWorkspace}
          initial={loginProfile}
          onClose={() => {
            setLoginWorkspace(null);
            setLoginProfile(null);
          }}
          onSave={async (draft) => {
            const saved = await saveAiWebAccount(loginWorkspace.id, draft);
            setLoginProfile(saved);
          }}
          onDelete={async () => {
            await deleteAiWebAccount(loginWorkspace.id);
            setLoginProfile(null);
          }}
        />
      )}
    </div>
  );
}
