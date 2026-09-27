// stem 空间配置 —— 唯一配置面 stem.jsonc（对齐旧库契约：snake_case）。
// 密钥只经 key_env 变量名；类/策略/工具目录即真相。

export type AccessWord = 'hidden' | 'allow' | 'deny'

export type ProviderConfig = {
  /** OpenAI 兼容基址；POST `{base_url}/chat/completions` */
  readonly base_url: string
  /** 密钥环境变量名；配置永不落明文 */
  readonly key_env?: string
  /** 启用模型白名单；空/缺省 = 全启用 */
  readonly models?: readonly string[]
}

export type UserClassConfig = {
  readonly name?: string
  readonly description?: string
  readonly systemPrompt?: string
  /** 根收敛清单：键即白名单；未列 = deny（对子孙仅显式判定） */
  readonly tools?: Readonly<Record<string, AccessWord>>
  readonly contextStrategy?: string
  readonly model?: string
  readonly sendCountdown?: number
  readonly temperature?: number
  readonly effort?: 'none' | 'low' | 'medium' | 'high'
}

export type ContextConfig = {
  readonly window?: number
  /** 上下文水位（token）：classic compact / cortex dream 触发线 */
  readonly watermark?: number
  readonly stamp?: {
    readonly source?: boolean
    readonly timestamp?: boolean
    readonly delay?: boolean
    readonly tokens?: boolean
  }
  readonly compact?: {
    readonly enabled?: boolean
    readonly threshold?: number
    readonly keepRecentTurns?: number
    /** 绝对 token 水位（优先于 threshold 比例） */
    readonly at?: number
  }
}

export type BashConfig = {
  readonly path?: string
  readonly defaultTimeoutMs?: number
  readonly maxOutputChars?: number
  readonly cwd?: string
}

export type ExtensionsConfig = {
  /** 点名装载 + 注册声明；未点名 = 不存在 */
  readonly tools?: Readonly<Record<string, AccessWord>>
  readonly agent?: readonly string[]
  readonly strategy?: readonly string[]
}

export type StemConfig = {
  readonly providers?: Readonly<Record<string, ProviderConfig>>
  readonly user?: UserClassConfig
  readonly context?: ContextConfig
  readonly bash?: BashConfig
  readonly tools?: { readonly outputLimit?: number }
  readonly sendCountdown?: number
  readonly extensions?: ExtensionsConfig
  readonly custom?: Readonly<Record<string, unknown>>
}

export function defaultStemConfig(): StemConfig {
  return {
    providers: {
      'opencode-go': {
        base_url: 'https://opencode.ai/zen/go/v1',
        key_env: 'OPENCODE_API_KEY',
      },
    },
    user: {
      model: 'opencode-go/deepseek-v4.1-flash',
      tools: {
        bash: 'allow',
        read: 'allow',
        agent_instantiate: 'allow',
        agent_class_list: 'allow',
        agent_class_create: 'allow',
        agent_inspect: 'allow',
        agent_update: 'allow',
        mail_send: 'allow',
        mail_list: 'allow',
        cortex_add_note: 'allow',
        cortex_del_note: 'allow',
      },
    },
    context: {
      window: 1000000,
      stamp: { source: true },
      compact: { enabled: true, threshold: 0.8, keepRecentTurns: 3 },
    },
    sendCountdown: 1000,
  }
}

export type ConfigIssue = {
  readonly kind: 'config_parse_error'
  readonly detail: string
}

export function parseStemConfig(text: string): StemConfig | ConfigIssue {
  try {
    const raw = JSON.parse(stripJsonComments(text)) as Record<string, unknown>
    if (!raw || typeof raw !== 'object') {
      return { kind: 'config_parse_error', detail: 'not an object' }
    }
    // 兼容 camelCase 旧草稿字段
    const providers = normalizeProviders(raw.providers)
    const user = normalizeUser(raw.user)
    if (user && user.model === undefined) {
      return { kind: 'config_parse_error', detail: 'user.model required' }
    }
    const base = defaultStemConfig()
    return {
      ...base,
      ...raw,
      providers,
      user: { ...base.user, ...user },
      context: { ...base.context, ...(raw.context as ContextConfig | undefined) },
    } as StemConfig
  } catch (error) {
    return {
      kind: 'config_parse_error',
      detail: error instanceof Error ? error.message : 'invalid json',
    }
  }
}

function normalizeProviders(value: unknown): Record<string, ProviderConfig> | undefined {
  if (!value || typeof value !== 'object') return undefined
  const out: Record<string, ProviderConfig> = {}
  for (const [name, p] of Object.entries(value as Record<string, unknown>)) {
    const o = p as Record<string, unknown>
    const base = (o.base_url ?? o.baseUrl) as string | undefined
    if (!base) continue
    out[name] = {
      base_url: base,
      key_env: (o.key_env ?? o.apiKeyEnv) as string | undefined,
      models: o.models as string[] | undefined,
    }
  }
  return out
}

function normalizeUser(value: unknown): UserClassConfig | undefined {
  if (!value || typeof value !== 'object') return undefined
  const o = value as Record<string, unknown>
  return {
    name: o.name as string | undefined,
    description: o.description as string | undefined,
    systemPrompt: (o.systemPrompt ?? o.sysPrompt) as string | undefined,
    tools: o.tools as UserClassConfig['tools'],
    contextStrategy: o.contextStrategy as string | undefined,
    model: o.model as string | undefined,
    sendCountdown: o.sendCountdown as number | undefined,
    temperature: o.temperature as number | undefined,
    effort: o.effort as UserClassConfig['effort'],
  }
}

function stripJsonComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}
