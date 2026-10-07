import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, Copy, Database, Download, FolderArchive, RefreshCw, Trash2, TriangleAlert } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { save as saveDialog } from '@tauri-apps/plugin-dialog';
import { buildDiagnosticReport, clearRuntimeDiagnostics, listRuntimeDiagnostics, type RuntimeDiagnostic } from '@/lib/runtime-diagnostics';

type AppDiagnostics = {
  platform: string;
  data_directory: string;
  database_status: string;
  database_size_bytes: number;
  backup_count: number;
  backup_size_bytes: number;
};

export function DiagnosticsPage() {
  const nav = useNavigate();
  const [data, setData] = useState<AppDiagnostics | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [events, setEvents] = useState<RuntimeDiagnostic[]>([]);
  const [exported, setExported] = useState(false);
  const healthy = data?.database_status === '数据库完整性正常';

  async function load() {
    setLoading(true);
    setError('');
    try {
      setData(await invoke<AppDiagnostics>('get_app_diagnostics'));
      setEvents(listRuntimeDiagnostics());
    }
    catch (reason) { setError(String(reason)); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  async function copyReport() {
    if (!data) return;
    const text = buildDiagnosticReport(data, events);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2_000);
    } catch { setError('无法复制诊断信息；请手动选择页面文字。'); }
  }

  async function exportReport() {
    if (!data) return;
    setError('');
    const path = await saveDialog({ title: '保存诊断报告', defaultPath: `个人工作站诊断_${dateStamp()}.txt`, filters: [{ name: '文本文件', extensions: ['txt'] }] });
    if (!path) return;
    try {
      await invoke('write_generated_text_file', { path, content: buildDiagnosticReport(data, events) });
      setExported(true);
      window.setTimeout(() => setExported(false), 2_000);
    } catch (reason) { setError(`保存诊断报告失败：${String(reason)}`); }
  }

  return (
    <div className="mx-auto max-w-[980px] p-6">
      <div className="mb-3 flex items-center gap-2 text-sm text-ink-3">
        <button className="flex items-center gap-1 hover:text-accent" onClick={() => nav('/settings')}><ArrowLeft size={14} /> 系统设置</button>
        <span className="text-ink-4">/</span><span className="font-medium text-ink">运行诊断</span>
      </div>
      <section className="overflow-hidden rounded-xl border border-line bg-canvas">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <h1 className="text-[18px] font-semibold text-ink">工作站健康检查</h1>
            <p className="mt-1 text-[13px] text-ink-3">仅检查本机状态，不上传工作内容、文件或密钥。</p>
          </div>
          <div className="flex flex-wrap gap-2"><button className="btn" onClick={() => void load()} disabled={loading}><RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> 刷新检查</button><button className="btn" onClick={() => void copyReport()} disabled={!data}><Copy size={13} /> {copied ? '已复制' : '复制报告'}</button><button className="btn btn-primary" onClick={() => void exportReport()} disabled={!data}><Download size={13} /> {exported ? '已保存' : '保存诊断报告'}</button></div>
        </div>
        {loading ? <div className="p-10 text-center text-sm text-ink-3">正在检查本机数据…</div> : error ? <div className="m-5 rounded-lg border border-danger/20 bg-c-red-bg p-4 text-sm text-danger"><TriangleAlert size={15} className="mr-2 inline" />{error}</div> : data && <div className="grid divide-y divide-line md:grid-cols-2 md:divide-x md:divide-y-0">
          <HealthItem icon={<CheckCircle2 size={18} />} label="数据库状态" value={data.database_status} tone={healthy ? 'ok' : 'warn'} />
          <HealthItem icon={<Database size={18} />} label="数据库大小" value={formatBytes(data.database_size_bytes)} />
          <HealthItem icon={<FolderArchive size={18} />} label="备份存量" value={`${data.backup_count} 份 · ${formatBytes(data.backup_size_bytes)}`} />
          <HealthItem icon={<Database size={18} />} label="数据位置" value={data.data_directory} mono />
        </div>}
        <div className="border-t border-line bg-paper px-5 py-3 text-[12px] leading-5 text-ink-3">若数据库状态提示需要检查，请先在“数据备份 / 恢复”中校验最近备份，再联系支持人员并附上复制的诊断报告。</div>
      </section>
      <section className="mt-5 overflow-hidden rounded-xl border border-line bg-canvas"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4"><div><h2 className="text-[16px] font-semibold text-ink">运行异常记录</h2><p className="mt-1 text-[13px] text-ink-3">记录页面加载和未处理错误摘要，保存在本机浏览器存储中。</p></div><button className="btn btn-ghost text-danger" disabled={!events.length} onClick={() => { if (!window.confirm('清除全部运行异常记录？')) return; clearRuntimeDiagnostics(); setEvents([]); }}><Trash2 size={13} /> 清除记录</button></div>{events.length ? <div className="divide-y divide-line">{events.map((event, index) => <details key={`${event.at}-${index}`} className="px-5 py-3"><summary className="cursor-pointer text-sm text-ink"><span className="mr-2 text-xs text-ink-3">{event.source}</span>{new Date(event.at).toLocaleString('zh-CN')}</summary><pre className="mt-2 whitespace-pre-wrap break-words text-xs leading-5 text-ink-3">{event.message}</pre></details>)}</div> : <div className="px-5 py-8 text-center text-sm text-ink-3">当前没有运行异常记录。</div>}</section>
    </div>
  );
}

function HealthItem({ icon, label, value, tone, mono = false }: { icon: React.ReactNode; label: string; value: string; tone?: 'ok' | 'warn'; mono?: boolean }) {
  return <div className="min-w-0 px-5 py-5"><div className={`flex items-center gap-2 text-xs ${tone === 'ok' ? 'text-ok' : tone === 'warn' ? 'text-warn' : 'text-ink-3'}`}>{icon}<span>{label}</span></div><div className={`mt-2 break-all text-sm font-medium text-ink ${mono ? 'num text-[12px]' : ''}`}>{value}</div></div>;
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function dateStamp() {
  const now = new Date();
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
}
