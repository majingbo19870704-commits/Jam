// =============================================================================
// lib/translators-v2.ts · 多实例翻译执行器
// =============================================================================
//
// 相较 translators.ts（v1，固定 3 家），v2 从数据库读所有启用的引擎/AI 实例，
// 并按 provider 类型走不同的签名 / 请求协议。
// =============================================================================
import { httpProxy } from './http';
import { parseJSON } from './llm';
import {
  listAIProviders,
  listEngineProviders,
  type AIProvider,
  type EngineProvider,
} from '@/db/translator-providers-dao';
import { findQueryCache, insertQueryHistory } from '@/db/english-dao';

export type Direction = 'en2zh' | 'zh2en';

export interface TranslationCard {
  category: 'engine' | 'ai';
  instanceId: string; // provider 实例 id
  instanceName: string; // 用户自定义的显示名
  provider: string; // 类型 code
  ok: boolean;
  natural?: string;
  formal?: string;
  keywords?: string[];
  error?: string;
  fromCache?: boolean; // 是否命中缓存
}

export interface RunOptions {
  text: string;
  direction: Direction;
  enableEngine: boolean;
  enableAI: boolean;
  /** 为 true 时绕过 24 小时缓存，强制发起真实请求 */
  forceRefresh?: boolean;
}

/** 缓存 TTL（小时） */
const CACHE_TTL_HOURS = 24;

/**
 * 主入口：读所有启用实例，并行调用，返回卡片列表
 * - 未指定 forceRefresh 时，命中 24 小时内缓存直接返回
 * - 成功结果（ok:true）会写回缓存
 */
export async function runTranslate(opts: RunOptions): Promise<TranslationCard[]> {
  const tasks: Promise<TranslationCard>[] = [];

  if (opts.enableEngine) {
    const engines = (await listEngineProviders()).filter((e) => e.is_enabled === 1);
    for (const e of engines)
      tasks.push(runOneWithCache('engine', e.id, () => runEngineOne(e, opts), opts));
  }
  if (opts.enableAI) {
    const ais = (await listAIProviders()).filter((a) => a.is_enabled === 1);
    for (const a of ais) tasks.push(runOneWithCache('ai', a.id, () => runAIOne(a, opts), opts));
  }
  if (tasks.length === 0) return [];
  return Promise.all(tasks);
}

/**
 * 单实例执行 + 缓存包装
 *  1. 若未强制刷新且命中缓存 → 直接返回缓存内容（标记 fromCache=true）
 *  2. 否则调用真实 fetcher；成功则写缓存
 */
async function runOneWithCache(
  kind: 'engine' | 'ai',
  instanceId: string,
  fetcher: () => Promise<TranslationCard>,
  opts: RunOptions,
): Promise<TranslationCard> {
  if (!opts.forceRefresh) {
    try {
      const cached = await findQueryCache<TranslationCard>(
        {
          query_text: opts.text,
          query_type: kind,
          provider_instance_id: instanceId,
          direction: opts.direction,
        },
        CACHE_TTL_HOURS,
      );
      if (cached && cached.ok) {
        return { ...cached, fromCache: true };
      }
    } catch (e) {
      console.warn('[runTranslate] cache lookup failed:', e);
    }
  }

  const fresh = await fetcher();
  if (fresh.ok) {
    try {
      await insertQueryHistory(
        {
          query_text: opts.text,
          query_type: kind,
          provider_instance_id: instanceId,
          direction: opts.direction,
        },
        fresh,
      );
    } catch (e) {
      console.warn('[runTranslate] cache write failed:', e);
    }
  }
  return fresh;
}

// -----------------------------------------------------------------------------
// 引擎调度
// -----------------------------------------------------------------------------
async function runEngineOne(e: EngineProvider, opts: RunOptions): Promise<TranslationCard> {
  const base: TranslationCard = {
    category: 'engine',
    instanceId: e.id,
    instanceName: e.display_name,
    provider: e.provider,
    ok: false,
  };
  try {
    const creds = safeParse(e.credentials);
    let result: { natural: string };
    switch (e.provider) {
      case 'baidu':
        result = await callBaidu(creds, opts);
        break;
      case 'deepl':
        result = await callDeepL(creds, opts);
        break;
      case 'youdao':
        result = await callYoudao(creds, opts);
        break;
      case 'tencent':
        result = await callTencent(creds, opts);
        break;
      case 'volc':
        result = await callVolc(creds, opts);
        break;
      case 'google':
        result = await callGoogle(creds, opts);
        break;
      case 'azure':
        result = await callAzure(creds, opts);
        break;
      case 'custom':
        result = { natural: '[自定义引擎需要在代码里补协议映射]' };
        break;
      default:
        throw new Error(`未知 provider: ${e.provider}`);
    }
    return { ...base, ok: true, natural: result.natural };
  } catch (err) {
    return { ...base, ok: false, error: String(err) };
  }
}

// 百度
async function callBaidu(c: Record<string, string>, opts: RunOptions) {
  const appid = c.appid,
    secret = c.secret;
  if (!appid || !secret) throw new Error('未填 App ID / 密钥');
  const salt = String(Date.now());
  const from = opts.direction === 'en2zh' ? 'en' : 'zh';
  const to = opts.direction === 'en2zh' ? 'zh' : 'en';
  const sign = md5(appid + opts.text + salt + secret);
  const params = new URLSearchParams({ q: opts.text, from, to, appid, salt, sign });
  const res = await httpProxy({
    method: 'GET',
    url: `https://fanyi-api.baidu.com/api/trans/vip/translate?${params}`,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (json.error_code) throw new Error(`${json.error_code}: ${json.error_msg}`);
  return { natural: (json.trans_result ?? []).map((r: any) => r.dst).join('\n') };
}

// DeepL
async function callDeepL(c: Record<string, string>, opts: RunOptions) {
  const key = c.key;
  if (!key) throw new Error('未填 API Key');
  const isFree = key.endsWith(':fx');
  const url = isFree
    ? 'https://api-free.deepl.com/v2/translate'
    : 'https://api.deepl.com/v2/translate';
  const body = new URLSearchParams({
    text: opts.text,
    source_lang: opts.direction === 'en2zh' ? 'EN' : 'ZH',
    target_lang: opts.direction === 'en2zh' ? 'ZH' : 'EN',
  });
  const res = await httpProxy({
    method: 'POST',
    url,
    headers: {
      Authorization: `DeepL-Auth-Key ${key}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 100)}`);
  const json = await res.json();
  return { natural: (json.translations ?? []).map((t: any) => t.text).join('\n') };
}

// 有道
async function callYoudao(c: Record<string, string>, opts: RunOptions) {
  const appKey = c.appKey,
    appSecret = c.appSecret;
  if (!appKey || !appSecret) throw new Error('未填 App Key / Secret');
  const q = opts.text;
  const curtime = Math.floor(Date.now() / 1000).toString();
  const salt = String(Date.now());
  const truncQ = q.length <= 20 ? q : q.substring(0, 10) + q.length + q.substring(q.length - 10);
  const signStr = appKey + truncQ + salt + curtime + appSecret;
  const sign = await sha256Hex(signStr);
  const params = new URLSearchParams({
    q,
    appKey,
    salt,
    sign,
    signType: 'v3',
    curtime,
    from: opts.direction === 'en2zh' ? 'en' : 'zh-CHS',
    to: opts.direction === 'en2zh' ? 'zh-CHS' : 'en',
  });
  const res = await httpProxy({
    method: 'POST',
    url: 'https://openapi.youdao.com/api',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (json.errorCode !== '0') throw new Error(`有道错误 ${json.errorCode}`);
  return { natural: (json.translation ?? []).join('\n') };
}

// 腾讯云机器翻译 TMT：API 3.0（TC3-HMAC-SHA256 签名）
// 文档：https://cloud.tencent.com/document/api/213/30654
async function callTencent(c: Record<string, string>, opts: RunOptions) {
  const secretId = c.secretId?.trim();
  const secretKey = c.secretKey?.trim();
  if (!secretId || !secretKey) throw new Error('未填 Secret ID / Secret Key');

  const host = 'tmt.tencentcloudapi.com';
  const service = 'tmt';
  const action = 'TextTranslate';
  const version = '2018-03-21';
  const timestamp = Math.floor(Date.now() / 1000);
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const body = JSON.stringify({
    SourceText: opts.text,
    Source: opts.direction === 'en2zh' ? 'en' : 'zh',
    Target: opts.direction === 'en2zh' ? 'zh' : 'en',
    ProjectId: 0,
  });
  const contentType = 'application/json; charset=utf-8';
  const canonicalHeaders = `content-type:${contentType}\nhost:${host}\nx-tc-action:${action.toLowerCase()}\n`;
  const signedHeaders = 'content-type;host;x-tc-action';
  const canonicalRequest = [
    'POST',
    '/',
    '',
    canonicalHeaders,
    signedHeaders,
    await sha256Hex(body),
  ].join('\n');
  const credentialScope = `${date}/${service}/tc3_request`;
  const stringToSign = [
    'TC3-HMAC-SHA256',
    String(timestamp),
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join('\n');
  const secretDate = await hmacSha256(`TC3${secretKey}`, date);
  const secretService = await hmacSha256(secretDate, service);
  const secretSigning = await hmacSha256(secretService, 'tc3_request');
  const signature = bytesToHex(await hmacSha256(secretSigning, stringToSign));
  const authorization = `TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const res = await httpProxy({
    method: 'POST',
    url: `https://${host}`,
    headers: {
      'Content-Type': contentType,
      'X-TC-Action': action,
      'X-TC-Version': version,
      'X-TC-Region': c.region?.trim() || 'ap-guangzhou',
      'X-TC-Timestamp': String(timestamp),
      Authorization: authorization,
    },
    body,
  });
  const json = await res.json().catch(async () => ({ raw: await res.text() }));
  const error = json.Response?.Error;
  if (!res.ok || error) {
    const detail = error ? `${error.Code}: ${error.Message}` : json.raw || `HTTP ${res.status}`;
    throw new Error(`腾讯翻译请求失败：${String(detail).slice(0, 240)}`);
  }
  const translated = json.Response?.TargetText;
  if (typeof translated !== 'string' || !translated.trim()) throw new Error('腾讯翻译未返回译文');
  return { natural: translated.trim() };
}

// 火山引擎机器翻译：Signature V4（HMAC-SHA256）
// 文档：https://docs.volcengine.com/docs/MachineTranslation/TextTranslationAPI
async function callVolc(c: Record<string, string>, opts: RunOptions) {
  const accessKey = c.accessKey?.trim();
  const secretKey = c.secretKey?.trim();
  if (!accessKey || !secretKey) throw new Error('未填 Access Key / Secret Key');

  const host = 'translate.volcengineapi.com';
  const region = c.region?.trim() || 'cn-north-1';
  const service = 'translate';
  const query = 'Action=TranslateText&Version=2020-06-01';
  const now = new Date();
  const xDate = now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
  const shortDate = xDate.slice(0, 8);
  const contentType = 'application/json';
  const body = JSON.stringify({
    SourceLanguage: opts.direction === 'en2zh' ? 'en' : 'zh',
    TargetLanguage: opts.direction === 'en2zh' ? 'zh' : 'en',
    TextList: [opts.text],
  });
  const payloadHash = await sha256Hex(body);
  const signedHeaders = 'content-type;host;x-content-sha256;x-date';
  const canonicalHeaders =
    [
      `content-type:${contentType}`,
      `host:${host}`,
      `x-content-sha256:${payloadHash}`,
      `x-date:${xDate}`,
    ].join('\n') + '\n';
  const canonicalRequest = ['POST', '/', query, canonicalHeaders, signedHeaders, payloadHash].join(
    '\n',
  );
  const credentialScope = `${shortDate}/${region}/${service}/request`;
  const stringToSign = [
    'HMAC-SHA256',
    xDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join('\n');
  const secretDate = await hmacSha256(secretKey, shortDate);
  const secretRegion = await hmacSha256(secretDate, region);
  const secretService = await hmacSha256(secretRegion, service);
  const signingKey = await hmacSha256(secretService, 'request');
  const signature = bytesToHex(await hmacSha256(signingKey, stringToSign));
  const authorization = `HMAC-SHA256 Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const res = await httpProxy({
    method: 'POST',
    url: `https://${host}/?${query}`,
    headers: {
      'Content-Type': contentType,
      'X-Date': xDate,
      'X-Content-Sha256': payloadHash,
      Authorization: authorization,
    },
    body,
  });
  const json = await res.json().catch(async () => ({ raw: await res.text() }));
  const error = json.ResponseMetadata?.Error;
  if (!res.ok || error) {
    const detail = error ? `${error.Code}: ${error.Message}` : json.raw || `HTTP ${res.status}`;
    throw new Error(`火山翻译请求失败：${String(detail).slice(0, 240)}`);
  }
  const translations = Array.isArray(json.TranslationList)
    ? json.TranslationList.map((item: { Translation?: unknown }) => item.Translation).filter(
        (item: unknown): item is string => typeof item === 'string' && Boolean(item.trim()),
      )
    : [];
  if (!translations.length) throw new Error('火山翻译未返回译文');
  return { natural: translations.join('\n') };
}

// Google
async function callGoogle(c: Record<string, string>, opts: RunOptions) {
  const key = c.key;
  if (!key) throw new Error('未填 API Key');
  const res = await httpProxy({
    method: 'POST',
    url: `https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(key)}`,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      q: opts.text,
      source: opts.direction === 'en2zh' ? 'en' : 'zh',
      target: opts.direction === 'en2zh' ? 'zh-CN' : 'en',
      format: 'text',
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 100)}`);
  const json = await res.json();
  return { natural: json.data?.translations?.[0]?.translatedText ?? '' };
}

// Azure
async function callAzure(c: Record<string, string>, opts: RunOptions) {
  const key = c.key,
    region = c.region || 'eastasia';
  if (!key) throw new Error('未填 Subscription Key');
  const params = new URLSearchParams({
    'api-version': '3.0',
    from: opts.direction === 'en2zh' ? 'en' : 'zh-Hans',
    to: opts.direction === 'en2zh' ? 'zh-Hans' : 'en',
  });
  const res = await httpProxy({
    method: 'POST',
    url: `https://api.cognitive.microsofttranslator.com/translate?${params}`,
    headers: {
      'Ocp-Apim-Subscription-Key': key,
      'Ocp-Apim-Subscription-Region': region,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify([{ Text: opts.text }]),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  return { natural: json[0]?.translations?.[0]?.text ?? '' };
}

// -----------------------------------------------------------------------------
// AI 调度（OpenAI 兼容协议 + Anthropic 特殊）
// -----------------------------------------------------------------------------
async function runAIOne(a: AIProvider, opts: RunOptions): Promise<TranslationCard> {
  const base: TranslationCard = {
    category: 'ai',
    instanceId: a.id,
    instanceName: a.display_name,
    provider: a.provider,
    ok: false,
  };
  try {
    if (!a.api_key) throw new Error('未填 API Key');
    if (!a.base_url) throw new Error('未填 Base URL');
    const sys =
      opts.direction === 'en2zh'
        ? '你是专业的英汉翻译，把用户输入的英文翻译成中文，返回严格 JSON。'
        : '你是专业的中英翻译，把用户输入的中文翻译成英文，返回严格 JSON。';
    const user = `请翻译并返回 JSON：{"natural":"自然口语化翻译","formal":"正式书面语翻译（如与 natural 差异明显）","keywords":["关键词/短语 0-6 个"]}\n\n原文：${opts.text}`;

    const url = a.base_url.replace(/\/$/, '') + '/chat/completions';
    const body: any = {
      model: a.model || guessDefaultModel(a.provider),
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: user },
      ],
      temperature: 0.2,
      stream: false,
    };
    // JSON mode（大多数支持）
    if (!['anthropic'].includes(a.provider)) {
      body.response_format = { type: 'json_object' };
    }
    const res = await httpProxy({
      method: 'POST',
      url,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${a.api_key}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json = await res.json();
    const content = json.choices?.[0]?.message?.content ?? '';
    const parsed = parseJSON<{ natural: string; formal?: string; keywords?: string[] }>(content);
    if (!parsed) throw new Error('返回不是 JSON：' + content.slice(0, 100));
    return {
      ...base,
      ok: true,
      natural: parsed.natural,
      formal: parsed.formal || undefined,
      keywords: parsed.keywords,
    };
  } catch (err) {
    return { ...base, ok: false, error: String(err) };
  }
}

function guessDefaultModel(p: string): string {
  const map: Record<string, string> = {
    deepseek: 'deepseek-chat',
    openai: 'gpt-4o-mini',
    anthropic: 'claude-3-5-haiku-latest',
    kimi: 'moonshot-v1-8k',
    qwen: 'qwen-plus',
    glm: 'glm-4.7-flash',
    volcAi: 'doubao-lite-4k',
    siliconflow: 'Qwen/Qwen2.5-7B-Instruct',
    openrouter: 'openai/gpt-4o-mini',
    custom: 'gpt-4o-mini',
  };
  return map[p] ?? 'gpt-4o-mini';
}

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------
function safeParse(s: string | null | undefined): Record<string, string> {
  if (!s) return {};
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

async function sha256Hex(s: string): Promise<string> {
  const enc = new TextEncoder().encode(s);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function hmacSha256(key: string | Uint8Array, value: string): Promise<Uint8Array> {
  const rawKey = typeof key === 'string' ? new TextEncoder().encode(key) : key;
  const keyData = new ArrayBuffer(rawKey.byteLength);
  new Uint8Array(keyData).set(rawKey);
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const rawValue = new TextEncoder().encode(value);
  const valueData = new ArrayBuffer(rawValue.byteLength);
  new Uint8Array(valueData).set(rawValue);
  return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, valueData));
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

// 复用之前 translators.ts 的 md5 —— 直接引入更好，但为避免循环依赖这里再实现一次
function md5(input: string): string {
  const rhex = (n: number) => {
    let s = '';
    for (let j = 0; j <= 3; j++)
      s += ((n >> (j * 8 + 4)) & 0x0f).toString(16) + ((n >> (j * 8)) & 0x0f).toString(16);
    return s;
  };
  const add32 = (a: number, b: number) => (a + b) & 0xffffffff;
  const cmn = (q: number, a: number, b: number, x: number, s: number, t: number) => {
    a = add32(add32(a, q), add32(x, t));
    return add32((a << s) | (a >>> (32 - s)), b);
  };
  const ff = (a: number, b: number, c: number, d: number, x: number, s: number, t: number) =>
    cmn((b & c) | (~b & d), a, b, x, s, t);
  const gg = (a: number, b: number, c: number, d: number, x: number, s: number, t: number) =>
    cmn((b & d) | (c & ~d), a, b, x, s, t);
  const hh = (a: number, b: number, c: number, d: number, x: number, s: number, t: number) =>
    cmn(b ^ c ^ d, a, b, x, s, t);
  const ii = (a: number, b: number, c: number, d: number, x: number, s: number, t: number) =>
    cmn(c ^ (b | ~d), a, b, x, s, t);
  const utf8 = unescape(encodeURIComponent(input));
  const nblk = ((utf8.length + 8) >> 6) + 1;
  const blks = new Array(nblk * 16).fill(0);
  let i;
  for (i = 0; i < utf8.length; i++) blks[i >> 2] |= utf8.charCodeAt(i) << ((i % 4) * 8);
  blks[i >> 2] |= 0x80 << ((i % 4) * 8);
  blks[nblk * 16 - 2] = utf8.length * 8;
  let a = 1732584193,
    b = -271733879,
    c = -1732584194,
    d = 271733878;
  for (i = 0; i < blks.length; i += 16) {
    const oa = a,
      ob = b,
      oc = c,
      od = d;
    a = ff(a, b, c, d, blks[i + 0], 7, -680876936);
    d = ff(d, a, b, c, blks[i + 1], 12, -389564586);
    c = ff(c, d, a, b, blks[i + 2], 17, 606105819);
    b = ff(b, c, d, a, blks[i + 3], 22, -1044525330);
    a = ff(a, b, c, d, blks[i + 4], 7, -176418897);
    d = ff(d, a, b, c, blks[i + 5], 12, 1200080426);
    c = ff(c, d, a, b, blks[i + 6], 17, -1473231341);
    b = ff(b, c, d, a, blks[i + 7], 22, -45705983);
    a = ff(a, b, c, d, blks[i + 8], 7, 1770035416);
    d = ff(d, a, b, c, blks[i + 9], 12, -1958414417);
    c = ff(c, d, a, b, blks[i + 10], 17, -42063);
    b = ff(b, c, d, a, blks[i + 11], 22, -1990404162);
    a = ff(a, b, c, d, blks[i + 12], 7, 1804603682);
    d = ff(d, a, b, c, blks[i + 13], 12, -40341101);
    c = ff(c, d, a, b, blks[i + 14], 17, -1502002290);
    b = ff(b, c, d, a, blks[i + 15], 22, 1236535329);
    a = gg(a, b, c, d, blks[i + 1], 5, -165796510);
    d = gg(d, a, b, c, blks[i + 6], 9, -1069501632);
    c = gg(c, d, a, b, blks[i + 11], 14, 643717713);
    b = gg(b, c, d, a, blks[i + 0], 20, -373897302);
    a = gg(a, b, c, d, blks[i + 5], 5, -701558691);
    d = gg(d, a, b, c, blks[i + 10], 9, 38016083);
    c = gg(c, d, a, b, blks[i + 15], 14, -660478335);
    b = gg(b, c, d, a, blks[i + 4], 20, -405537848);
    a = gg(a, b, c, d, blks[i + 9], 5, 568446438);
    d = gg(d, a, b, c, blks[i + 14], 9, -1019803690);
    c = gg(c, d, a, b, blks[i + 3], 14, -187363961);
    b = gg(b, c, d, a, blks[i + 8], 20, 1163531501);
    a = gg(a, b, c, d, blks[i + 13], 5, -1444681467);
    d = gg(d, a, b, c, blks[i + 2], 9, -51403784);
    c = gg(c, d, a, b, blks[i + 7], 14, 1735328473);
    b = gg(b, c, d, a, blks[i + 12], 20, -1926607734);
    a = hh(a, b, c, d, blks[i + 5], 4, -378558);
    d = hh(d, a, b, c, blks[i + 8], 11, -2022574463);
    c = hh(c, d, a, b, blks[i + 11], 16, 1839030562);
    b = hh(b, c, d, a, blks[i + 14], 23, -35309556);
    a = hh(a, b, c, d, blks[i + 1], 4, -1530992060);
    d = hh(d, a, b, c, blks[i + 4], 11, 1272893353);
    c = hh(c, d, a, b, blks[i + 7], 16, -155497632);
    b = hh(b, c, d, a, blks[i + 10], 23, -1094730640);
    a = hh(a, b, c, d, blks[i + 13], 4, 681279174);
    d = hh(d, a, b, c, blks[i + 0], 11, -358537222);
    c = hh(c, d, a, b, blks[i + 3], 16, -722521979);
    b = hh(b, c, d, a, blks[i + 6], 23, 76029189);
    a = hh(a, b, c, d, blks[i + 9], 4, -640364487);
    d = hh(d, a, b, c, blks[i + 12], 11, -421815835);
    c = hh(c, d, a, b, blks[i + 15], 16, 530742520);
    b = hh(b, c, d, a, blks[i + 2], 23, -995338651);
    a = ii(a, b, c, d, blks[i + 0], 6, -198630844);
    d = ii(d, a, b, c, blks[i + 7], 10, 1126891415);
    c = ii(c, d, a, b, blks[i + 14], 15, -1416354905);
    b = ii(b, c, d, a, blks[i + 5], 21, -57434055);
    a = ii(a, b, c, d, blks[i + 12], 6, 1700485571);
    d = ii(d, a, b, c, blks[i + 3], 10, -1894986606);
    c = ii(c, d, a, b, blks[i + 10], 15, -1051523);
    b = ii(b, c, d, a, blks[i + 1], 21, -2054922799);
    a = ii(a, b, c, d, blks[i + 8], 6, 1873313359);
    d = ii(d, a, b, c, blks[i + 15], 10, -30611744);
    c = ii(c, d, a, b, blks[i + 6], 15, -1560198380);
    b = ii(b, c, d, a, blks[i + 13], 21, 1309151649);
    a = ii(a, b, c, d, blks[i + 4], 6, -145523070);
    d = ii(d, a, b, c, blks[i + 11], 10, -1120210379);
    c = ii(c, d, a, b, blks[i + 2], 15, 718787259);
    b = ii(b, c, d, a, blks[i + 9], 21, -343485551);
    a = add32(a, oa);
    b = add32(b, ob);
    c = add32(c, oc);
    d = add32(d, od);
  }
  return rhex(a) + rhex(b) + rhex(c) + rhex(d);
}
