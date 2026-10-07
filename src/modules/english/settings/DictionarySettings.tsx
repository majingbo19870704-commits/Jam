import { useEffect, useState, type ReactNode } from 'react';
import { Plus, Trash2, Loader2, X, Upload, BookOpen, RefreshCw } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import {
  listDictSources, createDictSource, updateDictSource, deleteDictSource,
  type DictSource,
} from '@/db/translator-providers-dao';
import { getSetting, setSetting } from '@/db/english-dao';

interface Progress {
  running: boolean;
  imported: number;
  total_estimate: number;
  last_error?: string | null;
  finished_at?: string | null;
}

export function DictionarySettings() {
  const [items, setItems] = useState<DictSource[]>([]);
  const [ecdictCount, setEcdictCount] = useState<number | null>(null);
  const [wordnetCount, setWordnetCount] = useState<number | null>(null);
  const [progress, setProgress] = useState<Progress>({ running: false, imported: 0, total_estimate: 0 });
  const [ecdictEnabled, setEcdictEnabled] = useState(true);
  const [wordnetEnabled, setWordnetEnabled] = useState(true);
  const [wordnetUpdating, setWordnetUpdating] = useState(false);
  const [creating, setCreating] = useState(false);

  async function refresh() {
    const [sources, ecdictSetting, wordnetSetting] = await Promise.all([
      listDictSources(),
      getSetting('app', 'dictionary.ecdict.enabled').catch(() => null),
      getSetting('app', 'dictionary.wordnet.enabled').catch(() => null),
    ]);
    setItems(sources);
    setEcdictEnabled(ecdictSetting !== '0');
    setWordnetEnabled(wordnetSetting !== '0');
    try {
      const n = await invoke<number>('ecdict_status');
      setEcdictCount(n);
    } catch { setEcdictCount(0); }
    try {
      const n = await invoke<number>('wordnet_status');
      setWordnetCount(n);
    } catch { setWordnetCount(0); }
  }
  useEffect(() => { refresh(); }, []);

  useEffect(() => {
    if (!progress.running) return;
    const t = setInterval(async () => {
      try {
        const p = await invoke<Progress>('ecdict_progress');
        setProgress(p);
        if (!p.running) refresh();
      } catch { /* ignore */ }
    }, 800);
    return () => clearInterval(t);
  }, [progress.running]);

  async function toggle(id: string, v: boolean) {
    await updateDictSource(id, { is_enabled: v ? 1 : 0 });
    await refresh();
  }
  async function del(id: string, name: string) {
    if (!confirm(`确认删除词典「${name}」？词典中的词条也会移除。`)) return;
    await invoke('custom_dict_remove', { sourceId: id }).catch(() => undefined);
    await deleteDictSource(id);
    await refresh();
  }
  async function setBuiltinEnabled(dictionary: 'ecdict' | 'wordnet', enabled: boolean) {
    await setSetting('app', `dictionary.${dictionary}.enabled`, enabled ? '1' : '0');
    if (dictionary === 'ecdict') setEcdictEnabled(enabled);
    else setWordnetEnabled(enabled);
  }
  async function updateECDICTOnline() {
    setProgress({ running: true, imported: 0, total_estimate: 0 });
    try {
      const count = await invoke<number>('ecdict_update_online');
      alert(`ECDICT 已联网更新，共 ${count.toLocaleString()} 条词条。`);
      await refresh();
    } catch (error) {
      alert(`ECDICT 联网更新失败：${String(error)}`);
      setProgress({ running: false, imported: 0, total_estimate: 0 });
    }
  }
  async function updateWordNetOnline() {
    setWordnetUpdating(true);
    try {
      const count = await invoke<number>('wordnet_update_online');
      alert(`WordNet 已联网更新，共 ${count.toLocaleString()} 个词。`);
      await refresh();
    } catch (error) {
      alert(`WordNet 联网更新失败：${String(error)}`);
    } finally {
      setWordnetUpdating(false);
    }
  }

  const pctText = progress.total_estimate
    ? `${Math.min(99, Math.round(progress.imported / progress.total_estimate * 100))}%`
    : '';

  return (
    <div className="card">
      <div className="card-title">
        <h3>离线翻译</h3>
        <button className="btn btn-primary !py-1 !px-3 text-xs" onClick={() => setCreating(true)}>
          <Plus size={12} /> 新增词典
        </button>
      </div>
      <div className="card-body">
        <BuiltinDictionaryCard
          title="ECDICT 内置词典"
          description={ecdictCount === null ? '检查中…' : ecdictCount > 0 ? `已安装 ${ecdictCount.toLocaleString()} 条词条` : '尚未安装'}
          enabled={ecdictEnabled}
          updating={progress.running}
          onEnabledChange={(enabled) => void setBuiltinEnabled('ecdict', enabled)}
          onOnlineUpdate={updateECDICTOnline}
          fileUpdate={<ECDICTImportButton progress={progress} setProgress={setProgress} />}
        />

        <BuiltinDictionaryCard
          title="WordNet 语义词典"
          icon={<BookOpen size={14} />}
          description={wordnetCount === null ? '检查中…' : wordnetCount > 0 ? `已安装 ${wordnetCount.toLocaleString()} 个词，用于同义词、反义词和例句` : '尚未安装'}
          enabled={wordnetEnabled}
          updating={wordnetUpdating}
          onEnabledChange={(enabled) => void setBuiltinEnabled('wordnet', enabled)}
          onOnlineUpdate={updateWordNetOnline}
          fileUpdate={<WordNetImportButton onDone={refresh} />}
        />

        {progress.running && (
          <div className="mb-4">
            <div className="text-xs text-ink-3 mb-1.5">
              导入 <span className="num font-semibold">{progress.imported.toLocaleString()}</span> · {pctText}
            </div>
            <div className="h-1.5 bg-line rounded-full overflow-hidden">
              <div className="h-full bg-accent transition-all" style={{ width: pctText }} />
            </div>
          </div>
        )}

        {items.length === 0 && (
          <div className="text-ink-3 text-sm text-center py-6">
            还没有自定义词典。上面 ECDICT 是内置的，即刻可用；也可以点右上"新增词典"导入自己的
          </div>
        )}

        {items.length > 0 && (
          <table className="table w-full">
            <thead>
              <tr>
                <th className="w-12">#</th>
                <th className="!text-left">词典名称</th>
                <th>格式</th>
                <th>词条数</th>
                <th>文件大小</th>
                <th>更新时间</th>
                <th>启用</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={it.id}>
                  <td className="num text-ink-3">{i + 1}</td>
                  <td className="!text-left font-medium">{it.name}</td>
                  <td>{it.format}</td>
                  <td className="num">{it.entry_count.toLocaleString()}</td>
                  <td className="num">{formatBytes(it.file_size)}</td>
                  <td className="num text-ink-3 text-[12px]">
                    {new Date(it.updated_at).toLocaleDateString()}
                  </td>
                  <td>
                    <input type="checkbox" checked={it.is_enabled === 1}
                      onChange={(e) => toggle(it.id, e.target.checked)} />
                  </td>
                  <td>
                    <button className="btn btn-ghost !py-0.5 !px-2 text-xs text-danger"
                      onClick={() => del(it.id, it.name)}>
                      <Trash2 size={12} /> 删除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="mt-4 text-[11.5px] text-ink-4">
          提示：两个系统词典默认启用；停用后会立即从离线查询中排除，但已安装的数据不会删除。联网更新会下载公开词典源并替换对应数据。ECDICT 含音标、释义、词形变化、词频、分级；WordNet 提供同义词、反义词与例句，词根分析仍可按需通过已配置的 AI 补全并缓存。<br />
          自定义词典目前支持 ECDICT 兼容格式的 CSV：<span className="num">word,phonetic,definition,translation,pos,collins,oxford,tag,bnc,frq,exchange</span>
        </div>
      </div>

      {creating && (
        <DictImportModal
          onClose={() => setCreating(false)}
          onSaved={refresh}
        />
      )}
    </div>
  );
}

function BuiltinDictionaryCard({
  title, icon, description, enabled, updating, onEnabledChange, onOnlineUpdate, fileUpdate,
}: {
  title: string;
  icon?: ReactNode;
  description: string;
  enabled: boolean;
  updating: boolean;
  onEnabledChange: (enabled: boolean) => void;
  onOnlineUpdate: () => void;
  fileUpdate: ReactNode;
}) {
  return (
    <div className="p-3 rounded-lg bg-paper mb-4 flex items-center justify-between gap-4">
      <div className="min-w-0">
        <div className="text-sm font-medium flex items-center gap-1.5">{icon}{title}</div>
        <div className="text-xs text-ink-3 mt-1">{description}</div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <label className="text-xs text-ink-3 flex items-center gap-1 cursor-pointer whitespace-nowrap">
          <input type="checkbox" checked={enabled} onChange={(e) => onEnabledChange(e.target.checked)} />
          {enabled ? '已启用' : '已停用'}
        </label>
        <button className="btn whitespace-nowrap" onClick={onOnlineUpdate} disabled={updating}>
          {updating ? <><Loader2 size={12} className="animate-spin" /> 更新中…</> : <><RefreshCw size={12} /> 联网更新</>}
        </button>
        {fileUpdate}
      </div>
    </div>
  );
}

function WordNetImportButton({ onDone }: { onDone: () => void }) {
  const [importing, setImporting] = useState(false);
  async function pick() {
    const picked = await openDialog({
      directory: true, multiple: false, title: '选择 WordNet 的 dict 目录',
    });
    if (!picked) return;
    const path = typeof picked === 'string' ? picked : (picked as any).path;
    setImporting(true);
    try {
      const count = await invoke<number>('wordnet_import_dir', { directoryPath: path });
      alert(`WordNet 已导入 ${count.toLocaleString()} 个词。`);
      await onDone();
    } catch (e) {
      alert('导入失败：' + String(e));
    } finally { setImporting(false); }
  }
  return (
    <button className="btn whitespace-nowrap" onClick={pick} disabled={importing}>
      {importing ? <><Loader2 size={12} className="animate-spin" /> 导入中…</> : <><Upload size={12} /> 从文件更新</>}
    </button>
  );
}

function ECDICTImportButton({ progress, setProgress }: {
  progress: Progress;
  setProgress: (p: Progress) => void;
}) {
  async function pick() {
    const p = await openDialog({
      multiple: false,
      title: '选择 ECDICT CSV',
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    });
    if (!p) return;
    const path = typeof p === 'string' ? p : (p as any).path;
    setProgress({ running: true, imported: 0, total_estimate: 0 });
    try {
      await invoke<number>('ecdict_import_csv', { csvPath: path });
    } catch (e) {
      alert('导入失败：' + String(e));
      setProgress({ running: false, imported: 0, total_estimate: 0 });
    }
  }
  return (
    <button className="btn" onClick={pick} disabled={progress.running}>
      {progress.running ? <><Loader2 size={12} className="animate-spin" /> 导入中…</>
        : <><Upload size={12} /> 从文件更新</>}
    </button>
  );
}

function DictImportModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [csvPath, setCsvPath] = useState('');
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!name.trim() || !csvPath) { alert('请填写词典名并选择 CSV 文件'); return; }
    setSaving(true);
    try {
      const source = await createDictSource({
        name: name.trim(),
        source_url: sourceUrl.trim() || null,
        file_size: 0, entry_count: 0,
        format: 'ecdict',
        data_table: 'dict_custom_entry',
      });
      try {
        const count = await invoke<number>('custom_dict_import_csv', { sourceId: source.id, csvPath });
        alert(`已导入 ${count.toLocaleString()} 条词条；此词典已启用并会优先参与离线查词。`);
      } catch (error) {
        await deleteDictSource(source.id);
        throw error;
      }
      onSaved();
      onClose();
    } catch (error) {
      alert(`导入失败：${String(error)}`);
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-40 bg-black/30 grid place-items-center px-4" onClick={onClose}>
      <div className="w-[480px] max-w-full bg-canvas rounded-xl shadow-lg flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-line flex items-center justify-between">
          <div className="text-lg font-semibold">新增自定义词典</div>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="p-6 grid gap-3">
          <label className="grid gap-1">
            <span className="text-[11px] text-ink-3">词典名称 <span className="text-danger">*</span></span>
            <input className="input-lite" value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例：我的专业术语词典" />
          </label>
          <label className="grid gap-1">
            <span className="text-[11px] text-ink-3">下载 / 来源地址（可选）</span>
            <input className="input-lite" value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              placeholder="https://…" />
          </label>
          <div className="grid gap-1">
            <span className="text-[11px] text-ink-3">CSV 文件 <span className="text-danger">*</span></span>
            <div className="flex gap-2">
              <input className="input-lite flex-1" value={csvPath} readOnly placeholder="选择 ECDICT 兼容 CSV" />
              <button className="btn shrink-0" onClick={async () => {
                const picked = await openDialog({ multiple: false, filters: [{ name: 'CSV', extensions: ['csv'] }] });
                if (picked) setCsvPath(typeof picked === 'string' ? picked : (picked as any).path);
              }}>选择文件</button>
            </div>
          </div>
          <div className="text-[11.5px] text-ink-4">
            导入后会校验并写入词条。支持 ECDICT 表头；最少需要 <span className="num">word</span> 列，重复词以 CSV 中最后一条为准。
          </div>
        </div>
        <div className="px-6 py-4 border-t border-line flex gap-2 justify-end">
          <button className="btn" onClick={onClose}>取消</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
