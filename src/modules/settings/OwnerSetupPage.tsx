import { useEffect, useState, type FormEvent } from 'react';
import { Check, Copy, KeyRound, UserRound } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { initializeOwner, listOwnerCandidates } from '@/db/account-dao';
import { useAccountStore } from '@/stores/account';
import type { Account } from '@/types';

type Step = 'form' | 'recovery';

/** 首次使用与旧版多账号迁移共用的一次性主人档案初始化页。 */
export function OwnerSetupPage() {
  const [candidates, setCandidates] = useState<Account[]>([]);
  const [sourceId, setSourceId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [step, setStep] = useState<Step>('form');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const navigate = useNavigate();
  const setCurrent = useAccountStore((state) => state.setCurrent);

  useEffect(() => {
    void listOwnerCandidates().then((items) => {
      setCandidates(items);
      if (items.length === 1) {
        setSourceId(items[0].id);
        setDisplayName(items[0].display_name);
      }
    }).catch((reason) => setError(String(reason)));
  }, []);

  function selectSource(account: Account) {
    setSourceId(account.id);
    if (!displayName.trim() || candidates.some((candidate) => candidate.display_name === displayName)) {
      setDisplayName(account.display_name);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    if (!displayName.trim()) return setError('请输入你的显示名称。');
    if (password.length < 8) return setError('密码至少需要 8 位。');
    if (password !== confirm) return setError('两次输入的密码不一致。');
    setSaving(true);
    try {
      const { account, recoveryCode: nextRecoveryCode } = await initializeOwner({
        displayName,
        password,
        sourceAccountId: sourceId || undefined,
      });
      setCurrent({
        id: account.id,
        username: account.username,
        display_name: account.display_name,
        avatar_path: account.avatar_path,
      });
      setRecoveryCode(nextRecoveryCode);
      setStep('recovery');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  }

  async function copyRecovery() {
    await navigator.clipboard.writeText(recoveryCode);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <main className="grid min-h-screen place-items-center bg-paper p-4">
      <section className="card w-full max-w-[500px]">
        <div className="card-body p-8">
          <div className="mb-6 text-center">
            <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl text-white" style={{ background: 'linear-gradient(135deg, rgb(var(--rgb-accent)), #6E8CFF)' }}>
              <UserRound size={26} />
            </div>
            <h1 className="serif text-xl font-semibold">{step === 'form' ? '初始化个人工作台' : '保存恢复码'}</h1>
            <p className="mt-1 text-sm text-ink-3">{step === 'form' ? '建立此设备上唯一的主人档案' : '恢复码只会显示一次，请保存在密码管理器中。'}</p>
          </div>

          {step === 'form' ? (
            <form className="grid gap-3" onSubmit={submit}>
              {candidates.length > 1 && (
                <fieldset className="grid gap-2 rounded-lg border border-line p-3">
                  <legend className="px-1 text-xs text-ink-3">检测到旧版资料，选择要保留的数据</legend>
                  {candidates.map((account) => (
                    <label key={account.id} className="flex cursor-pointer items-center gap-2 text-sm">
                      <input type="radio" name="source" checked={sourceId === account.id} onChange={() => selectSource(account)} />
                      <span><b>{account.display_name}</b><small className="ml-1 text-ink-3">旧资料</small></span>
                    </label>
                  ))}
                </fieldset>
              )}
              <label className="text-xs text-ink-3" htmlFor="owner-name">显示名称</label>
              <input id="owner-name" autoFocus value={displayName} onChange={(event) => setDisplayName(event.target.value)} className="input-lite" placeholder="例如：小王" />
              <label className="mt-1 text-xs text-ink-3" htmlFor="owner-password">本机保护密码</label>
              <input id="owner-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} className="input-lite" placeholder="至少 8 位" autoComplete="new-password" />
              <label className="mt-1 text-xs text-ink-3" htmlFor="owner-confirm">确认密码</label>
              <input id="owner-confirm" type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} className="input-lite" autoComplete="new-password" />
              {error && <p className="text-xs text-danger">{error}</p>}
              <button type="submit" className="btn btn-primary mt-2 justify-center" disabled={saving}>{saving ? '保存中…' : '进入个人工作台'}</button>
            </form>
          ) : (
            <div className="grid gap-3">
              <div className="flex items-center gap-2 rounded-lg bg-c-amber-bg p-3 text-xs text-c-amber"><KeyRound size={15} />丢失密码时可用它重设本机保护密码。</div>
              <output className="rounded-lg border border-line bg-paper p-4 text-center font-mono text-lg tracking-wider">{recoveryCode}</output>
              <button className="btn justify-center" onClick={() => void copyRecovery()}>{copied ? <><Check size={14} />已复制</> : <><Copy size={14} />复制恢复码</>}</button>
              <button className="btn btn-primary mt-2 justify-center" onClick={() => navigate('/dashboard', { replace: true })}>我已保存，进入工作台</button>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
