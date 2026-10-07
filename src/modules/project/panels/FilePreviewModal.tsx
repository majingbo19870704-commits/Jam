import { useEffect, useState } from 'react';
import { X, ExternalLink, Download } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { open as openInShell } from '@tauri-apps/plugin-shell';
import type { ProjectFile } from '@/db/project-file-dao';

interface Props {
  file: ProjectFile;
  onClose: () => void;
}

type Kind = 'image' | 'pdf' | 'video' | 'audio' | 'text'
  | 'excel' | 'word' | 'ppt' | 'other';
type TextPreview = { content: string; truncated: boolean; totalBytes: number };

function detectKind(ext: string | null): Kind {
  if (!ext) return 'other';
  const e = ext.toLowerCase();
  if (['png','jpg','jpeg','gif','webp','bmp','svg','ico'].includes(e)) return 'image';
  if (e === 'pdf') return 'pdf';
  if (['mp4','webm','mov','ogv'].includes(e)) return 'video';
  if (['mp3','wav','ogg','flac','m4a','aac'].includes(e)) return 'audio';
  if (['xlsx','xls','xlsm','csv','tsv'].includes(e)) return 'excel';
  if (['docx','doc'].includes(e)) return 'word';
  if (['pptx','ppt'].includes(e)) return 'ppt';
  if (['txt','md','markdown','json','xml','log','yaml','yml','html',
       'js','ts','tsx','jsx','css','py','rs','java','go','c','h','cpp','sh'].includes(e)) return 'text';
  return 'other';
}

export function FilePreviewModal({ file, onClose }: Props) {
  const kind = detectKind(file.ext);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [textPreview, setTextPreview] = useState<TextPreview | null>(null);
  const [wordHtml, setWordHtml] = useState<string | null>(null);
  const [excelData, setExcelData] = useState<ExcelPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (kind === 'text') {
          const preview = await invoke<TextPreview>('read_file_text_preview', { relPath: file.rel_path });
          if (!cancelled) setTextPreview(preview);
        } else if (kind === 'word') {
          const b64 = await invoke<string>('read_file_base64', { relPath: file.rel_path });
          const buf = base64ToArrayBuffer(b64);
          const mammoth = await import('mammoth');
          const result = await mammoth.convertToHtml({ arrayBuffer: buf });
          if (!cancelled) setWordHtml(result.value);
        } else if (kind === 'excel') {
          const b64 = await invoke<string>('read_file_base64', { relPath: file.rel_path });
          const buf = base64ToArrayBuffer(b64);
          const XLSX = await import('xlsx');
          const wb = XLSX.read(buf, { type: 'array' });
          const sheets = wb.SheetNames.map((name) => ({
            name,
            data: XLSX.utils.sheet_to_json<string[]>(wb.Sheets[name], {
              header: 1, defval: '', blankrows: false,
            }) as (string | number)[][],
          }));
          if (!cancelled) setExcelData({ sheets });
        } else if (kind === 'pdf' || kind === 'image' || kind === 'video' || kind === 'audio') {
          const b64 = await invoke<string>('read_file_base64', { relPath: file.rel_path });
          if (!cancelled) {
            const mime = getMime(file.ext, kind);
            setDataUrl(`data:${mime};base64,${b64}`);
          }
        } else if (kind === 'ppt') {
          // 通过 LibreOffice 转 PDF 后预览
          const soffice = await invoke<string | null>('find_libreoffice');
          if (!soffice) {
            throw new Error('未检测到 LibreOffice。请先安装：https://www.libreoffice.org/download/  安装完重启应用即可预览 PPT');
          }
          const pdfRel = await invoke<string>('convert_to_pdf', { relPath: file.rel_path });
          const b64 = await invoke<string>('read_file_base64', { relPath: pdfRel });
          if (!cancelled) setDataUrl(`data:application/pdf;base64,${b64}`);
        }
      } catch (e) {
        if (!cancelled) setError(String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [file.rel_path, file.ext, kind]);

  async function openExternal() {
    try {
      const abs = await invoke<string>('resolve_data_path', { relPath: file.rel_path });
      await openInShell(abs);
    } catch (e) { alert('打开失败：' + String(e)); }
  }

  return (
    <div className="fixed inset-0 z-40 bg-black/50 grid place-items-center px-4" onClick={onClose}>
      <div className="w-[1100px] max-w-[95vw] h-[88vh] bg-canvas rounded-xl shadow-lg flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-line flex items-center justify-between">
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-semibold truncate">{file.display_name}</div>
            <div className="text-[11.5px] text-ink-3 truncate">
              {file.ext ?? '未知格式'} · {formatBytes(file.size_bytes)}
            </div>
          </div>
          <div className="flex items-center gap-1 ml-3">
            <button className="btn" onClick={openExternal}>
              <ExternalLink size={12} /> 用系统程序打开
            </button>
            <button className="icon-btn" onClick={onClose} title="关闭">
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto bg-paper">
          {loading && (
            <div className="grid place-items-center h-full text-ink-3">
              {kind === 'ppt' ? '正在用 LibreOffice 转换 PPT 为 PDF，首次约 3-10 秒…' : '加载中…'}
            </div>
          )}
          {error && !loading && (
            <div className="text-danger text-sm p-8">读取失败：{error}</div>
          )}

          {!loading && !error && kind === 'image' && dataUrl && (
            <div className="grid place-items-center h-full p-4">
              <img src={dataUrl} alt={file.display_name} className="max-w-full max-h-full object-contain" />
            </div>
          )}

          {!loading && !error && kind === 'pdf' && dataUrl && (
            <iframe src={dataUrl} title={file.display_name} className="w-full h-full bg-white border-0" />
          )}

          {!loading && !error && kind === 'video' && dataUrl && (
            <div className="grid place-items-center h-full p-4">
              <video src={dataUrl} controls className="max-w-full max-h-full" />
            </div>
          )}

          {!loading && !error && kind === 'audio' && dataUrl && (
            <div className="grid place-items-center h-full p-8 gap-4">
              <div className="text-6xl">🎵</div>
              <audio src={dataUrl} controls />
            </div>
          )}

          {!loading && !error && kind === 'text' && textPreview !== null && (
            <div className="h-full overflow-auto bg-canvas">
              {textPreview.truncated && <div className="sticky top-0 z-10 border-b border-warn/30 bg-c-warn-bg px-6 py-2 text-xs text-warn">仅预览前 1 MB（文件共 {formatBytes(textPreview.totalBytes)}）。请使用系统程序查看完整内容。</div>}
              <pre className="m-0 w-full p-6 text-[12.5px] leading-6 text-ink font-mono whitespace-pre-wrap">{textPreview.content}</pre>
            </div>
          )}

          {!loading && !error && kind === 'word' && wordHtml !== null && (
            <div className="bg-canvas h-full overflow-auto">
              <div className="max-w-[820px] mx-auto p-10 prose-word text-[14px] leading-7"
                dangerouslySetInnerHTML={{ __html: wordHtml }} />
            </div>
          )}

          {!loading && !error && kind === 'excel' && excelData && (
            <ExcelViewer data={excelData} />
          )}

          {!loading && !error && kind === 'ppt' && dataUrl && (
            <iframe src={dataUrl} title={file.display_name} className="w-full h-full bg-white border-0" />
          )}
          {!loading && !error && kind === 'ppt' && !dataUrl && (
            <div className="grid place-items-center h-full p-8 gap-3 text-center">
              <div className="text-6xl">📊</div>
              <div className="text-ink-2 font-medium">正在准备预览…</div>
            </div>
          )}

          {!loading && !error && kind === 'other' && (
            <div className="grid place-items-center h-full p-8 gap-3 text-ink-3">
              <Download size={40} className="text-ink-4" />
              <div>该格式不支持内嵌预览</div>
              <button className="btn btn-primary" onClick={openExternal}>
                <ExternalLink size={12} /> 用系统程序打开
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* Excel 预览：多 sheet tab + 表格渲染 */
interface ExcelPreview {
  sheets: { name: string; data: (string | number)[][] }[];
}
function ExcelViewer({ data }: { data: ExcelPreview }) {
  const [active, setActive] = useState(0);
  const sheet = data.sheets[active];
  if (!sheet) return null;
  const maxCols = sheet.data.reduce((m, r) => Math.max(m, r.length), 0);
  return (
    <div className="h-full flex flex-col bg-canvas">
      {data.sheets.length > 1 && (
        <div className="flex gap-1 px-3 py-1 bg-band border-b border-line overflow-x-auto">
          {data.sheets.map((s, i) => (
            <button key={s.name}
              onClick={() => setActive(i)}
              className={`px-3 py-1.5 text-xs whitespace-nowrap rounded-t ${
                i === active ? 'bg-canvas text-accent font-semibold' : 'text-ink-3 hover:bg-canvas'
              }`}>
              {s.name}
            </button>
          ))}
        </div>
      )}
      <div className="flex-1 overflow-auto">
        <table className="text-[12.5px] w-max">
          <thead>
            <tr>
              <th className="sticky top-0 left-0 z-20 w-10 h-7 bg-band border border-line" />
              {Array.from({ length: maxCols }).map((_, i) => (
                <th key={i} className="sticky top-0 z-10 min-w-[96px] h-7 bg-band border border-line text-ink-3 font-normal text-center num">
                  {colLetter(i)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sheet.data.map((row, ri) => (
              <tr key={ri}>
                <td className="sticky left-0 z-10 w-10 bg-band border border-line text-center text-ink-3 num">
                  {ri + 1}
                </td>
                {Array.from({ length: maxCols }).map((_, ci) => (
                  <td key={ci} className="min-w-[96px] px-2 py-1 border border-line text-ink truncate">
                    {row[ci] as any ?? ''}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function colLetter(n: number): string {
  let s = '';
  n = n + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function getMime(ext: string | null, kind: Kind): string {
  if (!ext) return 'application/octet-stream';
  const e = ext.toLowerCase();
  const map: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml', ico: 'image/x-icon',
    pdf: 'application/pdf',
    mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', ogv: 'video/ogg',
    mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', flac: 'audio/flac',
    m4a: 'audio/mp4', aac: 'audio/aac',
  };
  return map[e] ?? (kind === 'image' ? 'image/*' : kind === 'video' ? 'video/*' :
    kind === 'audio' ? 'audio/*' : 'application/octet-stream');
}
