// =============================================================================
// lib/translator-templates.ts · 内置翻译引擎 / AI 服务商模板
// =============================================================================

/** 单个凭据字段的元信息 */
export interface CredField {
  key: string; // 存到 credentials JSON 里的 key
  label: string; // UI 上显示的字段名
  placeholder?: string;
  password?: boolean; // 是否密码框显示 * *
  required?: boolean;
}

/** 传统翻译引擎模板 */
export interface EngineTemplate {
  provider: string;
  name: string;
  description: string;
  applyUrl: string; // 申请开发者账号地址
  applyHint: string; // 申请提示（免费额度等）
  fields: CredField[]; // 需要用户填写的字段
}

/** AI 服务商模板 */
export interface AITemplate {
  provider: string;
  name: string;
  description: string;
  baseUrl: string;
  defaultModel: string;
  applyUrl: string;
  applyHint: string;
}

// -----------------------------------------------------------------------------
// 7 家传统翻译引擎
// -----------------------------------------------------------------------------
export const ENGINE_TEMPLATES: EngineTemplate[] = [
  {
    provider: 'baidu',
    name: '百度翻译',
    description: '中英翻译效果好，国内直连',
    applyUrl: 'https://fanyi-api.baidu.com/manage/developer',
    applyHint: '200 万字符/月免费；需要 App ID + 密钥',
    fields: [
      { key: 'appid', label: 'App ID', required: true },
      { key: 'secret', label: '密钥', password: true, required: true },
    ],
  },
  {
    provider: 'deepl',
    name: 'DeepL',
    description: '欧洲语言翻译顶级',
    applyUrl: 'https://www.deepl.com/pro-api',
    applyHint: '50 万字符/月免费；Key 以 :fx 结尾即为免费版',
    fields: [
      {
        key: 'key',
        label: 'API Key',
        password: true,
        required: true,
        placeholder: 'xxxx-xxxx-xxxx:fx',
      },
    ],
  },
  {
    provider: 'youdao',
    name: '有道翻译',
    description: '国内直连，术语库丰富',
    applyUrl: 'https://ai.youdao.com/console/#/',
    applyHint: '100 元免费额度；需要 App Key + App Secret',
    fields: [
      { key: 'appKey', label: 'App Key', required: true },
      { key: 'appSecret', label: 'App Secret', password: true, required: true },
    ],
  },
  {
    provider: 'tencent',
    name: '腾讯翻译君',
    description: '国内直连，免费额度高',
    applyUrl: 'https://cloud.tencent.com/product/tmt',
    applyHint: '需先开通机器翻译服务，并填写云 API 密钥 SecretId + SecretKey',
    fields: [
      { key: 'secretId', label: 'Secret ID', required: true },
      { key: 'secretKey', label: 'Secret Key', password: true, required: true },
      {
        key: 'region',
        label: 'Region（留空默认 ap-guangzhou）',
        placeholder: 'ap-guangzhou',
        required: false,
      },
    ],
  },
  {
    provider: 'volc',
    name: '火山翻译',
    description: '字节跳动，国内直连',
    applyUrl: 'https://www.volcengine.com/product/machine-translation',
    applyHint: '需先开通机器翻译服务，并填写 Access Key + Secret Key',
    fields: [
      { key: 'accessKey', label: 'Access Key', required: true },
      { key: 'secretKey', label: 'Secret Key', password: true, required: true },
      {
        key: 'region',
        label: 'Region（留空默认 cn-north-1）',
        placeholder: 'cn-north-1',
        required: false,
      },
    ],
  },
  {
    provider: 'google',
    name: 'Google Translate',
    description: '通用翻译，需海外网络',
    applyUrl: 'https://cloud.google.com/translate',
    applyHint: '50 万字符/月免费；需要 API Key',
    fields: [{ key: 'key', label: 'API Key', password: true, required: true }],
  },
  {
    provider: 'azure',
    name: 'Microsoft Azure Translator',
    description: '微软翻译，需海外账号',
    applyUrl: 'https://azure.microsoft.com/products/ai-services/ai-translator',
    applyHint: '200 万字符/月免费；需要 Subscription Key + Region',
    fields: [
      { key: 'key', label: 'Subscription Key', password: true, required: true },
      { key: 'region', label: 'Region', placeholder: 'eastasia', required: true },
    ],
  },
  {
    provider: 'custom',
    name: '自定义引擎',
    description: '手动填写 API 端点和请求模板',
    applyUrl: '',
    applyHint: '仅在你需要接入非主流引擎时使用',
    fields: [
      { key: 'endpoint', label: 'Endpoint URL', placeholder: 'https://…', required: true },
      { key: 'appid', label: 'App ID / Key', required: false },
      { key: 'secret', label: 'Secret / Password', password: true, required: false },
    ],
  },
];

// -----------------------------------------------------------------------------
// 9 家 AI 服务商
// -----------------------------------------------------------------------------
export const AI_TEMPLATES: AITemplate[] = [
  {
    provider: 'deepseek',
    name: 'DeepSeek',
    description: '国内直连，中文能力强，价格低',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    applyUrl: 'https://platform.deepseek.com/api_keys',
    applyHint: '约 1 元/百万 Token；国内直连',
  },
  {
    provider: 'openai',
    name: 'OpenAI',
    description: '通用能力最强',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    applyUrl: 'https://platform.openai.com/api-keys',
    applyHint: '国内需代理访问',
  },
  {
    provider: 'anthropic',
    name: 'Anthropic Claude',
    description: '翻译质量顶级',
    baseUrl: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-3-5-haiku-latest',
    applyUrl: 'https://console.anthropic.com/settings/keys',
    applyHint: '国内需代理访问',
  },
  {
    provider: 'kimi',
    name: 'Kimi（月之暗面）',
    description: '国内直连，长文本强',
    baseUrl: 'https://api.moonshot.cn/v1',
    defaultModel: 'moonshot-v1-8k',
    applyUrl: 'https://platform.moonshot.cn/console/api-keys',
    applyHint: '国内直连；有免费试用额度',
  },
  {
    provider: 'qwen',
    name: '通义千问',
    description: '阿里云，国内直连',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-plus',
    applyUrl: 'https://bailian.console.aliyun.com/?apiKey=1',
    applyHint: '国内直连；有免费额度',
  },
  {
    provider: 'glm',
    name: '智谱 GLM',
    description: 'GLM-4 系列，国内直连',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-4.7-flash',
    applyUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
    applyHint: '国内直连；GLM-4-Flash 免费',
  },
  {
    provider: 'volcAi',
    name: '火山方舟',
    description: '字节跳动，Doubao 等',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    defaultModel: 'doubao-lite-4k',
    applyUrl: 'https://console.volcengine.com/ark',
    applyHint: '国内直连；有免费额度',
  },
  {
    provider: 'siliconflow',
    name: '硅基流动',
    description: '多家开源模型聚合，性价比高',
    baseUrl: 'https://api.siliconflow.cn/v1',
    defaultModel: 'Qwen/Qwen2.5-7B-Instruct',
    applyUrl: 'https://cloud.siliconflow.cn/account/ak',
    applyHint: '国内直连；有免费模型',
  },
  {
    provider: 'openrouter',
    name: 'OpenRouter',
    description: '多家 AI 聚合，一个 Key 用所有',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'openai/gpt-4o-mini',
    applyUrl: 'https://openrouter.ai/keys',
    applyHint: '海外账号，需绑定信用卡',
  },
  {
    provider: 'custom',
    name: '自定义（OpenAI 兼容）',
    description: '任意 OpenAI 兼容的服务',
    baseUrl: '',
    defaultModel: '',
    applyUrl: '',
    applyHint: '填写完整 Base URL 即可',
  },
];

/** 通过 provider 找模板 */
export function findEngine(provider: string): EngineTemplate | undefined {
  return ENGINE_TEMPLATES.find((t) => t.provider === provider);
}
export function findAI(provider: string): AITemplate | undefined {
  return AI_TEMPLATES.find((t) => t.provider === provider);
}
