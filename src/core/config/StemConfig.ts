// stem 空间配置 —— 唯一配置面 stem.jsonc（snake_case）。
// 分区铁律：core 段落只谈 core；extension 的一切进 extensions 伞下。
// 密钥只经 key_env 变量名；类/策略/工具目录即真相，点名只决定「装不装」。

export type AccessWord = 'hidden' | 'allow' | 'deny'

export type ProviderConfig = {
  /** OpenAI 兼容基址；POST `{base_url}/chat/completions` */
  readonly base_url: string
  /** 密钥环境变量名；配置永不落明文 */
  readonly key_env?: string
  /** 该提供商可用模型白名单；空/缺省 = 全启用 */
  readonly models?: readonly string[]
}

export type UserClassConfig = {
  readonly name?: string
  readonly description?: string
  readonly systemPrompt?: string
  /** 根收敛清单：键即白名单；未列 = hidden */
  readonly tools?: Readonly<Record<string, AccessWord>>
  readonly contextStrategy?: string
  readonly model?: string
  /** 快递员合并窗口（秒）；实例属性，子实例可继承 */
  readonly sendCountdown?: number
  readonly temperature?: number
  readonly effort?: 'none' | 'low' | 'medium' | 'high'
  /** 0 = 无限（正常默认）；正数 = 受限/成本敏感步数帽 */
  readonly maxSteps?: number
}

export type StampConfigFile = {
  readonly source?: boolean
  readonly timestamp?: boolean
  readonly delay?: boolean
  readonly tokens?: boolean
}

/** core 内置策略 classic 参数 */
export type ClassicConfig = {
  /** 触发上下文压缩的水位（token） */
  readonly window?: number
}

/** 扩展策略 cortex 参数（extensions.strategy.cortex） */
export type CortexConfig = {
  readonly dreamAt?: number
  readonly note?: string
  readonly stmMax?: number
  readonly ltmMax?: number
  readonly recentChars?: number
}

export type BashConfig = {
  readonly path?: string
  readonly defaultTimeoutMs?: number
  readonly maxOutputChars?: number
  readonly cwd?: string
}

export type ExtensionsConfig = {
  /** 点名装载 + 注册声明；未点名 = 不装载 */
  readonly tools?: Readonly<Record<string, AccessWord>>
  readonly agent?: readonly string[]
  /** 扩展策略参数：键 = 策略名 */
  readonly strategy?: Readonly<Record<string, CortexConfig>>
}

export type StemConfig = {
  readonly providers?: Readonly<Record<string, ProviderConfig>>
  readonly user?: UserClassConfig
  readonly stamp?: StampConfigFile
  readonly classic?: ClassicConfig
  readonly bash?: BashConfig
  readonly extensions?: ExtensionsConfig
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
        write: 'allow',
        edit: 'allow',
        grep: 'allow',
        glob: 'allow',
        agent_instantiate: 'allow',
        agent_class_list: 'allow',
        agent_class_create: 'allow',
        agent_inspect: 'allow',
        agent_update: 'allow',
        mail_send: 'allow',
        cortex_add_note: 'allow',
        cortex_del_note: 'allow',
      },
      sendCountdown: 3,
      maxSteps: 0,
    },
    stamp: { source: true },
    classic: { window: 128000 },
    extensions: {
      tools: {
        read: 'allow',
        write: 'allow',
        edit: 'allow',
        grep: 'allow',
        glob: 'allow',
        bash: 'allow',
      },
    },
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
    const providers = normalizeProviders(raw.providers)
    const user = normalizeUser(raw.user)
    if (user && user.model === undefined) {
      return { kind: 'config_parse_error', detail: 'user.model required' }
    }
    const base = defaultStemConfig()
    return {
      providers: providers ?? base.providers,
      user: { ...base.user, ...user },
      stamp: { ...base.stamp, ...(raw.stamp as StampConfigFile | undefined) },
      classic: { ...base.classic, ...(raw.classic as ClassicConfig | undefined) },
      bash: raw.bash as BashConfig | undefined,
      extensions: normalizeExtensions(raw.extensions),
    }
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
    maxSteps: o.maxSteps as number | undefined,
  }
}

function normalizeExtensions(value: unknown): ExtensionsConfig | undefined {
  if (!value || typeof value !== 'object') return undefined
  const o = value as Record<string, unknown>
  const strategyRaw = o.strategy
  const strategy: Record<string, CortexConfig> = {}
  if (strategyRaw && typeof strategyRaw === 'object') {
    for (const [name, cfg] of Object.entries(strategyRaw as Record<string, unknown>)) {
      if (cfg && typeof cfg === 'object') strategy[name] = cfg as CortexConfig
    }
  }
  return {
    tools: o.tools as ExtensionsConfig['tools'],
    agent: o.agent as string[] | undefined,
    strategy: Object.keys(strategy).length ? strategy : undefined,
  }
}

function stripJsonComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}
