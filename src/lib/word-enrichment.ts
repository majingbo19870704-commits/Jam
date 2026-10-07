// =============================================================================
// word-enrichment.ts · 已配置 AI 的按需单词扩展（严格 JSON）
// =============================================================================
import { httpProxy } from './http';
import { listAIProviders } from '@/db/translator-providers-dao';

export interface AIWordEnrichment {
  synonyms: string[];
  antonyms: string[];
  rootAnalysis: string;
  examples: string[];
  providerName: string;
}

/** 短语、例句的学习型译文：只在用户主动点击时请求，调用方负责写入 word_card 缓存。 */
export async function enrichExpressionWithAI(
  text: string,
  kind: 'phrase' | 'sentence',
): Promise<{
  content: string;
  providerName: string;
}> {
  const provider = (await listAIProviders()).find((item) => item.is_enabled === 1);
  if (!provider) throw new Error('请先在“英语学习 → 设置 → AI 翻译”中启用一个 AI 服务。');
  if (!provider.base_url || !provider.api_key)
    throw new Error(`AI 服务“${provider.display_name}”缺少 Base URL 或 API Key。`);
  const label = kind === 'phrase' ? '英语短语' : '英语句子';
  const request = {
    model: provider.model || defaultModel(provider.provider),
    temperature: 0.2,
    stream: false,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content:
          '你是英语学习教练。仅输出 JSON，不得输出 Markdown。解释准确、简洁，服务于中文学习者。',
      },
      {
        role: 'user',
        content:
          `请为这条${label}生成可直接保存的学习译文：${JSON.stringify(text)}。` +
          '返回 JSON：{"translation":"完整自然的中文翻译","keyPoints":[{"term":"重点词或搭配","explanation":"简明中文解释"}],"learningTip":"一条有助理解或记忆的提示"}。重点词最多 4 个；没有必要时可为空数组。',
      },
    ],
  };
  const response = await httpProxy({
    method: 'POST',
    url: provider.base_url.replace(/\/$/, '') + '/chat/completions',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${provider.api_key}` },
    body: JSON.stringify(request),
  });
  if (!response.ok)
    throw new Error(
      `AI 请求失败（HTTP ${response.status}）：${(await response.text()).slice(0, 160)}`,
    );
  const content = (await response.json()).choices?.[0]?.message?.content;
  const parsed = parseExpressionJson(content);
  if (!parsed) throw new Error('AI 返回内容不是可识别的 JSON。');
  return { content: parsed, providerName: provider.display_name };
}

export async function enrichWordWithAI(word: string): Promise<AIWordEnrichment> {
  const provider = (await listAIProviders()).find((item) => item.is_enabled === 1);
  if (!provider) throw new Error('请先在“英语学习 → 设置 → AI 翻译”中启用一个 AI 服务。');
  if (!provider.base_url || !provider.api_key)
    throw new Error(`AI 服务“${provider.display_name}”缺少 Base URL 或 API Key。`);

  const request = {
    model: provider.model || defaultModel(provider.provider),
    temperature: 0.2,
    stream: false,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content:
          '你是严谨的英语词汇助手。仅输出 JSON，不得输出 Markdown。不要编造罕见词源；词根分析不确定时要明确说明。',
      },
      {
        role: 'user',
        content:
          `为英语单词 ${JSON.stringify(word)} 生成学习资料。返回：` +
          '{"synonyms":["常用同义词，最多8个"],"antonyms":["常用反义词，最多6个"],"rootAnalysis":"用中文简明说明词根/前后缀或词源，80字以内","examples":["英文例句 1","英文例句 2"]}。例句必须自然且包含该词或其词形。',
      },
    ],
  };
  const url = provider.base_url.replace(/\/$/, '') + '/chat/completions';
  const response = await httpProxy({
    method: 'POST',
    url,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${provider.api_key}` },
    body: JSON.stringify(request),
  });
  if (!response.ok)
    throw new Error(
      `AI 请求失败（HTTP ${response.status}）：${(await response.text()).slice(0, 160)}`,
    );
  const payload = await response.json();
  const content = payload.choices?.[0]?.message?.content;
  const parsed = parseJson(content);
  if (!parsed) throw new Error('AI 返回内容不是可识别的 JSON。');
  return { ...parsed, providerName: provider.display_name };
}

function parseJson(value: unknown): Omit<AIWordEnrichment, 'providerName'> | null {
  if (typeof value !== 'string') return null;
  const cleaned = value
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  try {
    const row = JSON.parse(cleaned);
    return {
      synonyms: list(row.synonyms, 8),
      antonyms: list(row.antonyms, 6),
      rootAnalysis: typeof row.rootAnalysis === 'string' ? row.rootAnalysis.trim() : '',
      examples: list(row.examples, 4),
    };
  } catch {
    return null;
  }
}

function parseExpressionJson(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  try {
    const row = JSON.parse(cleaned);
    const translation = typeof row.translation === 'string' ? row.translation.trim() : '';
    const rawKeyPoints: unknown[] = Array.isArray(row.keyPoints) ? row.keyPoints : [];
    const keyPoints = rawKeyPoints
      .filter(
        (item: unknown): item is { term: string; explanation: string } =>
          typeof (item as { term?: unknown })?.term === 'string' &&
          typeof (item as { explanation?: unknown })?.explanation === 'string',
      )
      .slice(0, 4);
    const tip = typeof row.learningTip === 'string' ? row.learningTip.trim() : '';
    if (!translation) return null;
    const sections = [`译文：${translation}`];
    if (keyPoints.length) {
      sections.push(
        `重点词：\n${keyPoints.map((item) => `• ${item.term.trim()}：${item.explanation.trim()}`).join('\n')}`,
      );
    }
    if (tip) sections.push(`学习提示：${tip}`);
    return sections.join('\n\n');
  } catch {
    return null;
  }
}

function list(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ].slice(0, max);
}

function defaultModel(provider: string) {
  return (
    (
      {
        deepseek: 'deepseek-chat',
        openai: 'gpt-4o-mini',
        kimi: 'moonshot-v1-8k',
        qwen: 'qwen-plus',
        glm: 'glm-4.7-flash',
      } as Record<string, string>
    )[provider] || 'gpt-4o-mini'
  );
}
