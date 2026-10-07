// =============================================================================
// lib/http.ts · 走 Rust 侧代理的 fetch 封装，避免 CORS
// =============================================================================
import { invoke } from '@tauri-apps/api/core';

interface ProxyRequest {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
}
interface ProxyResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

/**
 * 通过 Rust 侧发起 HTTP 请求，返回一个类似 fetch Response 的对象
 */
export async function httpProxy(req: ProxyRequest): Promise<{
  ok: boolean; status: number; headers: Record<string, string>;
  text: () => Promise<string>; json: () => Promise<any>;
}> {
  const resp = await invoke<ProxyResponse>('http_proxy', { req });
  return {
    ok: resp.status >= 200 && resp.status < 300,
    status: resp.status,
    headers: resp.headers,
    text: async () => resp.body,
    json: async () => JSON.parse(resp.body),
  };
}
