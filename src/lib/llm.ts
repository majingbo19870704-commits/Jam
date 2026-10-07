// =============================================================================
// lib/llm.ts · 简易 LLM 客户端（走 OpenAI 兼容接口）
// =============================================================================
import { getSetting } from '@/db/english-dao';

interface CallInput {
  system: string;
  user: string;
}
interface CallOptions {
  temperature?: number;
  jsonMode?: boolean;
}

/**
 * 从设置里取 provider / key / model / base，向 OpenAI 兼容端点发一次请求
 * @returns 助手消息 content 字符串（不 parse）
 */
export async function callLLM(input: CallInput, opts: CallOptions = {}): Promise<string> {
  const provider = (await getSetting('app', 'english.llm_provider')) ?? 'deepseek';
  const key = (await getSetting('app', 'english.llm_key')) ?? '';
  const model = (await getSetting('app', 'english.llm_model')) ?? '';
  const base = (await getSetting('app', 'english.llm_base')) ?? '';

  if (!key) throw new Error('尚未配置 LLM API Key，请前往「英语学习 · 设置」填写');

  const cfg = resolveCfg(provider, base, model);

  const body: any = {
    model: cfg.model,
    messages: [
      { role: 'system', content: input.system },
      { role: 'user', content: input.user },
    ],
    temperature: opts.temperature ?? 0.2,
    stream: false,
  };
  if (opts.jsonMode && cfg.jsonSupported) {
    body.response_format = { type: 'json_object' };
  }

  const { httpProxy } = await import('./http');
  const res = await httpProxy({
    method: 'POST',
    url: cfg.endpoint,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LLM 调用失败 (${res.status})：${text}`);
  }
  const json = await res.json();
  return json.choices?.[0]?.message?.content ?? '';
}

/** 尝试解析 JSON —— 兼容 LLM 返回 ```json 包裹的 case */
export function parseJSON<T = unknown>(text: string): T | null {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
  try { return JSON.parse(trimmed); } catch { return null; }
}

function resolveCfg(provider: string, base: string, model: string) {
  const defaults: Record<string, { endpoint: string; model: string; jsonSupported: boolean }> = {
    deepseek: {
      endpoint: 'https://api.deepseek.com/v1/chat/completions',
      model: 'deepseek-chat', jsonSupported: true,
    },
    openai: {
      endpoint: 'https://api.openai.com/v1/chat/completions',
      model: 'gpt-4o-mini', jsonSupported: true,
    },
    anthropic: {
      // 走 Anthropic 官方；这里简单起见还走 OpenAI 兼容格式
      endpoint: 'https://api.anthropic.com/v1/chat/completions',
      model: 'claude-3-5-haiku-latest', jsonSupported: false,
    },
    custom: {
      endpoint: base || 'https://api.deepseek.com/v1/chat/completions',
      model: 'deepseek-chat', jsonSupported: true,
    },
  };
  const d = defaults[provider] ?? defaults.custom;
  return {
    endpoint: base
      ? (base.endsWith('/chat/completions') ? base : `${base.replace(/\/$/, '')}/chat/completions`)
      : d.endpoint,
    model: model || d.model,
    jsonSupported: d.jsonSupported,
  };
}
