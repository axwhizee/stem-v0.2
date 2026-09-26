// shell 宿主：providers 路由 + 厂商头适配（core 零感知）。

import {
  createOpenAiCompatibleGateway,
  GatewayError,
  type ModelGateway,
  type LLMRequest,
  type LLMEvent,
} from '../../src/core/gateway/index.ts'
import type { StemConfig } from '../../src/core/config/index.ts'

export type BuiltGateway = {
  readonly gateway: ModelGateway
  readonly warnings: readonly string[]
}

export function buildGateway(config: StemConfig, env: NodeJS.ProcessEnv): BuiltGateway {
  const warnings: string[] = []
  const providers = config.providers ?? {}
  const map = new Map<string, ModelGateway>()

  for (const [name, p] of Object.entries(providers)) {
    const key = p.apiKeyEnv ? env[p.apiKeyEnv] : undefined
    if (p.apiKeyEnv && !key) {
      warnings.push(`provider ${name}: key_env ${p.apiKeyEnv} 未命中，用到时才会硬错`)
    }
    map.set(
      name,
      createOpenAiCompatibleGateway({
        baseUrl: p.baseUrl,
        apiKey: key,
        models: p.models,
      }),
    )
  }

  const gateway: ModelGateway = {
    async *chat(request: LLMRequest, options) {
      const impl = map.get(request.model.provider)
      if (!impl) {
        throw new GatewayError({
          kind: 'provider_unwired',
          message: `provider ${request.model.provider} 未配置`,
        })
      }
      yield* impl.chat(request, options) as AsyncIterable<LLMEvent>
    },
  }

  return { gateway, warnings }
}
