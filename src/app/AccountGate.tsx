import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { LockKeyhole } from 'lucide-react';
import { useAccountStore } from '@/stores/account';
import {
  getOwnerAccount,
  ownerRequiresPasswordOnStart,
  verifyOwnerPassword,
} from '@/db/account-dao';
import type { Account } from '@/types';

const unlockedSessionKey = (accountId: string) => `pw:owner-unlocked:${accountId}`;

/**
 * 主人档案守卫：工作台只使用一个本机主人档案。
 * 每次启动都从数据库复核并恢复该档案，避免 localStorage 变成另一套“登录状态”。
 */
export function AccountGate() {
  const setCurrent = useAccountStore((s) => s.setCurrent);
  const logout = useAccountStore((s) => s.logout);
  const [ready, setReady] = useState(false);
  const [hasOwner, setHasOwner] = useState(false);
  const [lockedOwner, setLockedOwner] = useState<Account | null>(null);
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [verifying, setVerifying] = useState(false);

  const enterWorkspace = useCallback(
    (owner: Account) => {
      setCurrent({
        id: owner.id,
        username: owner.username,
        display_name: owner.display_name,
        avatar_path: owner.avatar_path,
      });
      setLockedOwner(null);
      setHasOwner(true);
    },
    [setCurrent],
  );

  useEffect(() => {
    let mounted = true;
    getOwnerAccount()
      .then((owner) => {
        if (!mounted) return;
        if (owner && !owner.requires_setup) {
          const requiresPassword = ownerRequiresPasswordOnStart(owner);
          const unlocked = sessionStorage.getItem(unlockedSessionKey(owner.id)) === '1';
          if (requiresPassword && !unlocked) {
            logout();
            setLockedOwner(owner);
          } else {
            enterWorkspace(owner);
          }
        }
        setReady(true);
      })
      .catch(() => setReady(true));
    return () => {
      mounted = false;
    };
  }, [enterWorkspace, logout]);

  async function unlock(event: FormEvent) {
    event.preventDefault();
    if (!lockedOwner || verifying) return;
    setVerifying(true);
    setPasswordError('');
    try {
      const valid = await verifyOwnerPassword(password);
      if (!valid) {
        setPasswordError('密码不正确，请重新输入。');
        return;
      }
      sessionStorage.setItem(unlockedSessionKey(lockedOwner.id), '1');
      setPassword('');
      enterWorkspace(lockedOwner);
    } catch (reason) {
      setPasswordError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setVerifying(false);
    }
  }

  if (!ready) return <div className="grid place-items-center h-screen text-ink-3">加载中…</div>;
  if (lockedOwner) {
    return (
      <main className="grid min-h-screen place-items-center bg-canvas p-6">
        <form className="card w-full max-w-[420px]" onSubmit={unlock}>
          <div className="card-body grid gap-4 p-6 sm:p-7">
            <div className="grid h-12 w-12 place-items-center rounded-xl bg-accent text-white shadow-sm">
              <LockKeyhole size={22} />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-ink">解锁个人工作站</h1>
              <p className="mt-1 text-sm text-ink-3">
                {lockedOwner.display_name}，请输入本机保护密码继续。
              </p>
            </div>
            <label className="grid gap-1.5 text-xs text-ink-3" htmlFor="owner-unlock-password">
              密码
              <input
                id="owner-unlock-password"
                className="input-lite"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                autoFocus
                required
              />
            </label>
            {passwordError && (
              <p className="text-xs text-danger" role="alert">
                {passwordError}
              </p>
            )}
            <button
              className="btn btn-primary w-full justify-center"
              type="submit"
              disabled={verifying}
            >
              {verifying ? '正在验证…' : '进入工作站'}
            </button>
          </div>
        </form>
      </main>
    );
  }
  if (hasOwner) return <Outlet />;
  return <Navigate to="/setup-owner" replace />;
}
