import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  CheckCircle2,
  Download,
  FileUp,
  HardDrive,
  Loader2,
  LockKeyhole,
  PackageOpen,
  Trash2,
  Upload,
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { open as openInShell } from '@tauri-apps/plugin-shell';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { closeDbConnection } from '@/db/client';
import { getSetting, setSetting } from '@/db/english-dao';

interface BackupInfo {
  file_name: string;
  abs_path: string;
  size_bytes: number;
  created_at: string;
  encrypted: boolean;
}

interface BackupVerification {
  file_name: string;
  account_file_count: number;
  uncompressed_bytes: number;
}

export function BackupPage() {
  const nav = useNavigate();
  const [items, setItems] = useState<BackupInfo[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [passwordRequest, setPasswordRequest] = useState<{ title: string; hint: string } | null>(
    null,
  );
  const passwordResolver = useRef<((value: string | null) => void) | null>(null);

  const requestPassword = (title: string, hint: string) =>
    new Promise<string | null>((resolve) => {
      passwordResolver.current = resolve;
      setPasswordRequest({ title, hint });
    });
  const resolvePassword = (value: string | null) => {
    passwordResolver.current?.(value);
    passwordResolver.current = null;
    setPasswordRequest(null);
  };

  async function refresh() {
    setLoading(true);
    try {
      const list = await invoke<BackupInfo[]>('list_backups');
      setItems(list);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    refresh();
  }, []);

  async function createNow() {
    setBusy('creating');
    try {
      await invoke('create_backup');
      await refresh();
      alert('备份完成');
    } catch (e) {
      alert('备份失败：' + String(e));
    } finally {
      setBusy(null);
    }
  }

  async function restore(name: string, encrypted: boolean) {
    if (
      !confirm(
        `确认从「${name}」恢复？\n\n当前数据会先自动做一份预备份，然后被覆盖。恢复后需要重启应用。`,
      )
    )
      return;
    setBusy(`restore-${name}`);
    try {
      const password = encrypted
        ? await requestPassword('输入备份密码', '此密码只用于本次恢复，不会保存。')
        : null;
      if (encrypted && password === null) return;
      await closeDbConnection();
      await invoke('restore_backup', { fileName: name, password: password || null });
      alert('恢复完成，数据完整性已校验。应用将重新加载以识别恢复后的数据。');
      window.location.reload();
    } catch (e) {
      alert('恢复失败：' + String(e));
    } finally {
      setBusy(null);
    }
  }

  async function verify(name: string, encrypted: boolean) {
    setBusy(`verify-${name}`);
    try {
      const password = encrypted
        ? await requestPassword('输入备份密码', '此密码只用于本次校验，不会保存。')
        : null;
      if (encrypted && password === null) return;
      const result = await invoke<BackupVerification>('verify_backup', {
        fileName: name,
        password: password || null,
      });
      alert(
        `校验通过：数据库完整，可用于恢复。\n解压后数据：${formatBytes(result.uncompressed_bytes)}\n项目文件：${result.account_file_count} 个`,
      );
    } catch (e) {
      alert('校验未通过：' + String(e));
    } finally {
      setBusy(null);
    }
  }

  async function del(name: string) {
    if (!confirm(`确认删除备份「${name}」？此操作不可恢复。`)) return;
    setBusy(`del-${name}`);
    try {
      await invoke('delete_backup', { fileName: name });
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  async function openInExplorer(path: string) {
    // 定位到备份目录，简单处理成打开父目录
    const parent = path.replace(/[\\/][^\\/]+$/, '');
    try {
      await openInShell(parent);
    } catch {
      /* ignore */
    }
  }
  async function copyExternal(name: string) {
    const directory = await openDialog({
      title: '选择外部备份目录',
      directory: true,
      multiple: false,
    });
    if (!directory) return;
    setBusy(`copy-${name}`);
    try {
      const target = await invoke<string>('copy_backup_to_directory', {
        fileName: name,
        destinationDir: directory,
      });
      alert(`已复制到外部目录：\n${target}`);
    } catch (error) {
      alert('复制失败：' + String(error));
    } finally {
      setBusy(null);
    }
  }

  async function importExternalBackup(path?: string, password?: string | null) {
    let selectedPath = path;
    if (!selectedPath) {
      const picked = await openDialog({
        title: '选择要导入的 ZIP 备份',
        multiple: false,
        filters: [{ name: 'ZIP 备份', extensions: ['zip'] }],
      });
      if (!picked || Array.isArray(picked)) return;
      selectedPath = picked;
    }
    setBusy('importing');
    try {
      await invoke<BackupInfo>('import_backup', {
        sourcePath: selectedPath,
        password: password || null,
      });
      await refresh();
      alert('备份已导入并完成完整性校验。现在可在列表中校验或恢复。');
    } catch (error) {
      const message = String(error);
      if (!password && message.includes('加密')) {
        const entered = await requestPassword(
          '输入备份密码',
          '导入前会校验备份内容；密码不会保存。',
        );
        if (entered !== null) await importExternalBackup(selectedPath, entered);
      } else {
        alert('导入失败：' + message);
      }
    } finally {
      setBusy(null);
    }
  }

  const total = items.reduce((a, b) => a + b.size_bytes, 0);

  return (
    <div className="p-6 max-w-[1200px] mx-auto">
      <div className="flex items-center gap-2 text-sm text-ink-3 mb-3">
        <button
          className="hover:text-accent flex items-center gap-1"
          onClick={() => nav('/settings')}
        >
          <ArrowLeft size={14} /> 系统设置
        </button>
        <span className="text-ink-4">/</span>
        <span className="text-ink font-medium">数据备份</span>
      </div>

      {/* 顶部信息卡 */}
      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div
          className="metric"
          style={{ background: 'linear-gradient(135deg,#FFFFFF 0%,#EEF3FF 100%)' }}
        >
          <div
            className="w-11 h-11 rounded-xl grid place-items-center text-white absolute top-4 right-4 shadow-md"
            style={{ background: 'linear-gradient(135deg,#2E5BFF,#6E8CFF)' }}
          >
            <HardDrive size={20} />
          </div>
          <div className="label">备份数量</div>
          <div className="mt-5 flex min-w-0 items-baseline gap-2 pr-12">
            <div className="num whitespace-nowrap text-[30px] font-bold leading-none text-ink">
              {items.length}
            </div>
            <div className="min-w-0 truncate text-[12px] text-ink-3">份 · {formatBytes(total)}</div>
          </div>
        </div>
        <div
          className="metric"
          style={{ background: 'linear-gradient(135deg,#FFFFFF 0%,#E7F7F0 100%)' }}
        >
          <div
            className="w-11 h-11 rounded-xl grid place-items-center text-white absolute top-4 right-4 shadow-md"
            style={{ background: 'linear-gradient(135deg,#10B981,#34D9A5)' }}
          >
            <PackageOpen size={20} />
          </div>
          <div className="label">最近备份</div>
          <div className="mt-5 min-w-0 pr-12">
            <div className="num whitespace-nowrap text-[16px] font-semibold leading-none tracking-[-0.02em] text-ink">
              {items[0] ? formatDate(items[0].created_at) : '无'}
            </div>
            {items[0] && (
              <div className="mt-2 truncate text-[11px] text-ink-3" title={items[0].file_name}>
                {items[0].file_name}
              </div>
            )}
          </div>
        </div>
        <div
          className="metric"
          style={{ background: 'linear-gradient(135deg,#FFFFFF 0%,#F1EBFE 100%)' }}
        >
          <div
            className="w-11 h-11 rounded-xl grid place-items-center text-white absolute top-4 right-4 shadow-md"
            style={{ background: 'linear-gradient(135deg,#8B5CF6,#A78BFA)' }}
          >
            <Upload size={20} />
          </div>
          <div className="label">立即备份</div>
          <div>
            <button
              className="btn btn-primary mt-2"
              onClick={createNow}
              disabled={busy === 'creating'}
            >
              {busy === 'creating' ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Upload size={12} />
              )}
              {busy === 'creating' ? '备份中…' : '开始备份'}
            </button>
          </div>
        </div>
        <div
          className="metric"
          style={{ background: 'linear-gradient(135deg,#FFFFFF 0%,#FFF4E8 100%)' }}
        >
          <div
            className="absolute right-4 top-4 grid h-11 w-11 place-items-center rounded-xl text-white shadow-md"
            style={{ background: 'linear-gradient(135deg,#DC7A27,#F0A85A)' }}
          >
            <FileUp size={20} />
          </div>
          <div className="label">导入备份</div>
          <div>
            <button
              className="btn mt-2"
              onClick={() => void importExternalBackup()}
              disabled={busy === 'importing'}
            >
              {busy === 'importing' ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <FileUp size={12} />
              )}
              {busy === 'importing' ? '导入中…' : '选择 ZIP 文件'}
            </button>
          </div>
        </div>
      </div>

      {/* 备份列表 */}
      <div className="card">
        <div className="card-title">
          <h3>备份列表</h3>
          <span className="meta">按创建时间倒序</span>
        </div>
        <div className="p-0">
          <table className="table w-full">
            <thead>
              <tr>
                <th className="w-16">序号</th>
                <th>文件名</th>
                <th>创建时间</th>
                <th>大小</th>
                <th className="w-52">操作</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={5} className="text-center text-ink-3 py-8">
                    加载中…
                  </td>
                </tr>
              )}
              {!loading && items.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-center text-ink-3 py-10">
                    <div className="flex flex-col items-center gap-2">
                      <HardDrive size={28} className="text-ink-4" />
                      <div>还没有备份，点右上「开始备份」创建第一份</div>
                    </div>
                  </td>
                </tr>
              )}
              {items.map((b, i) => (
                <tr key={b.file_name}>
                  <td className="num text-ink-3">{i + 1}</td>
                  <td className="!text-left num text-[12.5px]">
                    <span className="inline-flex items-center gap-1">
                      {b.encrypted && (
                        <LockKeyhole size={13} className="text-accent" aria-label="已加密" />
                      )}
                      {b.file_name}
                    </span>
                  </td>
                  <td className="num text-ink-3">{formatDateTime(b.created_at)}</td>
                  <td className="num">{formatBytes(b.size_bytes)}</td>
                  <td>
                    <div className="flex gap-1 justify-center flex-wrap">
                      <button
                        className="btn btn-ghost !py-0.5 !px-2 text-xs text-success"
                        onClick={() => verify(b.file_name, b.encrypted)}
                        disabled={busy?.startsWith('verify')}
                      >
                        {busy === `verify-${b.file_name}` ? (
                          <>
                            <Loader2 size={12} className="animate-spin" /> 校验中…
                          </>
                        ) : (
                          <>
                            <CheckCircle2 size={12} /> 校验
                          </>
                        )}
                      </button>
                      <button
                        className="btn btn-ghost !py-0.5 !px-2 text-xs text-accent"
                        onClick={() => restore(b.file_name, b.encrypted)}
                        disabled={busy?.startsWith('restore')}
                      >
                        {busy === `restore-${b.file_name}` ? (
                          <>
                            <Loader2 size={12} className="animate-spin" /> 恢复中…
                          </>
                        ) : (
                          <>
                            <Download size={12} /> 恢复
                          </>
                        )}
                      </button>
                      <button
                        className="btn btn-ghost !py-0.5 !px-2 text-xs"
                        onClick={() => openInExplorer(b.abs_path)}
                      >
                        <PackageOpen size={12} /> 定位
                      </button>
                      <button
                        className="btn btn-ghost !py-0.5 !px-2 text-xs"
                        onClick={() => void copyExternal(b.file_name)}
                        disabled={busy?.startsWith('copy')}
                      >
                        <Upload size={12} />{' '}
                        {busy === `copy-${b.file_name}` ? '复制中…' : '外部副本'}
                      </button>
                      <button
                        className="btn btn-ghost !py-0.5 !px-2 text-xs text-danger"
                        onClick={() => del(b.file_name)}
                      >
                        <Trash2 size={12} /> 删除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-2 text-[11.5px] text-ink-4 border-t border-line">
          备份包含：日程、工作、项目、英语学习、快捷链接、AI 工作台/助手、系统参数及 API
          密钥等数据库数据，以及项目附件。可导入已保存的 ZIP
          备份；备份文件包含明文密钥，请仅保存在可信位置。文件保存在{' '}
          <span className="num">%APPDATA%/com.majin.personal-workstation/backups/</span>
        </div>
      </div>
      <AutoBackupSettings />
      {passwordRequest && (
        <BackupPasswordModal
          title={passwordRequest.title}
          hint={passwordRequest.hint}
          onCancel={() => resolvePassword(null)}
          onConfirm={(value) => resolvePassword(value)}
        />
      )}
    </div>
  );
}

function AutoBackupSettings() {
  const [enabled, setEnabled] = useState(false);
  const [days, setDays] = useState('7');
  const [keepCount, setKeepCount] = useState('20');
  const [saved, setSaved] = useState(false);
  const [pruned, setPruned] = useState<number | null>(null);

  useEffect(() => {
    void Promise.all([
      getSetting('app', 'backup.auto.enabled'),
      getSetting('app', 'backup.auto.interval_days'),
      getSetting('app', 'backup.auto.keep_count'),
    ]).then(([on, interval, keep]) => {
      setEnabled(on === '1');
      setDays(interval ?? '7');
      setKeepCount(keep ?? '20');
    });
  }, []);

  async function save() {
    const interval = Math.max(1, Math.min(30, Number(days) || 7));
    const retention = Math.max(3, Math.min(100, Number(keepCount) || 20));
    await Promise.all([
      setSetting('app', 'backup.auto.enabled', enabled ? '1' : '0'),
      setSetting('app', 'backup.auto.interval_days', String(interval)),
      setSetting('app', 'backup.auto.keep_count', String(retention)),
    ]);
    setDays(String(interval));
    setKeepCount(String(retention));
    setPruned(await invoke<number>('prune_backups', { keepCount: retention }));
    setSaved(true);
    window.setTimeout(() => {
      setSaved(false);
      setPruned(null);
    }, 3000);
  }

  return (
    <section className="card mt-5">
      <div className="card-title">
        <h3>自动备份</h3>
      </div>
      <div className="card-body grid gap-4 text-sm">
        <p className="text-ink-3">
          启用后，工作站会在启动时及每小时检查一次，到达周期便自动保存完整备份。
        </p>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
          />
          启用本机自动备份
        </label>
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-3">
            备份间隔
            <input
              className="input-lite w-20"
              type="number"
              min="1"
              max="30"
              value={days}
              onChange={(event) => setDays(event.target.value)}
            />
            天
          </label>
          <label className="flex items-center gap-3">
            保留最近
            <input
              className="input-lite w-20"
              type="number"
              min="3"
              max="100"
              value={keepCount}
              onChange={(event) => setKeepCount(event.target.value)}
            />
            份
          </label>
        </div>
        <p className="-mt-2 text-xs text-ink-4">
          保存策略会清理超出数量的最旧备份，始终至少保留 3 份。
        </p>
        <div>
          <button className="btn btn-primary" onClick={() => void save()}>
            保存自动备份策略
          </button>
          {saved && (
            <span className="ml-3 text-ok text-xs">
              已保存{pruned ? `，已清理 ${pruned} 份旧备份` : ''}
            </span>
          )}
        </div>
      </div>
    </section>
  );
}

function BackupPasswordModal({
  title,
  hint,
  onCancel,
  onConfirm,
}: {
  title: string;
  hint: string;
  onCancel: () => void;
  onConfirm: (value: string) => void;
}) {
  const [value, setValue] = useState('');
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 px-4" onClick={onCancel}>
      <form
        className="w-[420px] max-w-full rounded-xl bg-canvas p-6 shadow-lg"
        onSubmit={(event) => {
          event.preventDefault();
          if (value) onConfirm(value);
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-2 text-lg font-semibold">
          <LockKeyhole size={18} className="text-accent" />
          {title}
        </div>
        <p className="mt-2 text-sm text-ink-3">{hint}</p>
        <input
          autoFocus
          type="password"
          autoComplete="new-password"
          className="input-lite mt-4"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          aria-label="备份密码"
        />
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn" onClick={onCancel}>
            取消
          </button>
          <button className="btn btn-primary" disabled={!value}>
            确认
          </button>
        </div>
      </form>
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
function formatDate(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
