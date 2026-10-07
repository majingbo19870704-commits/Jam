import { AlertTriangle, Home, RefreshCw } from 'lucide-react';
import { useEffect } from 'react';
import { isRouteErrorResponse, useRouteError } from 'react-router-dom';
import { recordRuntimeDiagnostic } from '@/lib/runtime-diagnostics';

/** 按需加载模块失败时的可恢复页面，避免错误直接呈现为技术栈或空白区域。 */
export function RouteErrorPage() {
  const error = useRouteError();
  const detail = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : '未知错误';
  useEffect(() => { recordRuntimeDiagnostic('route-error', detail); }, [detail]);
  console.error('[route error]', error);

  return (
    <main className="min-h-screen grid place-items-center bg-paper px-6 text-center">
      <section className="max-w-md rounded-xl border border-line bg-canvas px-8 py-9 shadow-sm">
        <div className="mx-auto grid size-11 place-items-center rounded-xl bg-c-red-bg text-danger">
          <AlertTriangle size={22} />
        </div>
        <h1 className="mt-5 text-[19px] font-semibold text-ink">此页面暂时无法打开</h1>
        <p className="mt-2 text-sm leading-6 text-ink-3">
          页面资源可能正在更新，或上一次加载未完成。重新加载不会修改你的工作数据。
        </p>
        <div className="mt-6 flex justify-center gap-2">
          <button className="btn btn-primary" onClick={() => window.location.reload()}>
            <RefreshCw size={14} /> 重新加载
          </button>
          <button className="btn" onClick={() => { window.location.href = '/dashboard'; }}>
            <Home size={14} /> 返回主页
          </button>
        </div>
        <details className="mt-5 text-left text-[11px] text-ink-4">
          <summary className="cursor-pointer">查看错误信息</summary>
          <p className="mt-2 break-words leading-5">{detail}</p>
        </details>
      </section>
    </main>
  );
}
