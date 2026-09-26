// stem 空间配置 —— 唯一配置面 stem.jsonc。密钥只经 env 名。

export type ProviderConfig = {
  readonly baseUrl: string
  readonly apiKeyEnv?: string
  readonly models?: readonly string[]
}

export type StemConfig = {
  readonly user: {
    readonly model: string
    readonly sysPrompt?: string
  }
  readonly providers?: Readonly<Record<string, ProviderConfig>>
  readonly sendCountdown?: number
  readonly context?: {
    readonly window?: number
    readonly compact?: number
    readonly stamp?: {
      readonly source?: boolean
      readonly timestamp?: boolean
      readonly delay?: boolean
      readonly tokens?: boolean
    }
  }
  readonly bash?: {
    readonly enabled?: boolean
    readonly cwd?: string
  }
  readonly tools?: Readonly<Record<string, 'hidden' | 'allow' | 'deny'>>
  readonly extensions?: {
    readonly tools?: readonly string[]
  }
}

export function defaultStemConfig(): StemConfig {
  return {
    user: { model: 'openai/gpt-4o-mini', sysPrompt: 'You are a helpful assistant.' },
    sendCountdown: 0,
    context: { stamp: { source: true } },
    bash: { enabled: true },
  }
}

export type ConfigIssue = { readonly kind: 'config_parse_error'; readonly detail: string }

export function parseStemConfig(text: string): StemConfig | ConfigIssue {
  try {
    // 运行时用 jsonc-parser；此处先 JSON 兜底
    const raw = JSON.parse(stripJsonComments(text)) as Partial<StemConfig>
    if (!raw || typeof raw !== 'object' || !raw.user?.model) {
      return { kind: 'config_parse_error', detail: 'user.model required' }
    }
    return { ...defaultStemConfig(), ...raw, user: { ...defaultStemConfig().user, ...raw.user } }
  } catch (error) {
    return {
      kind: 'config_parse_error',
      detail: error instanceof Error ? error.message : 'invalid json',
    }
  }
}

function stripJsonComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}
