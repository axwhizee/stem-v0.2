// shell 宿主：providers 路由 + 厂商头适配（core 零感知）。

import {
  createOpenAiCompatibleGateway,
  GatewayError,
  type ModelGateway,
  type LLMRequest,
  type LLMEvent,
} from '../../src/core/gateway/index.ts'
import type { StemConfig } from '../../src/core/config/index.ts'
import { randomUUID } from 'node:crypto'

export type BuiltGateway = {
  readonly gateway: ModelGateway
  readonly warnings: readonly string[]
}

/** 每进程一个会话 id（opencode.ai 要求；进程即会话，零持久化）。 */
const OPENSESSION = randomUUID()

export function providerFetch(baseUrl: string): typeof fetch {
  const isOpencode = /(^|\.)opencode\.ai$/i.test(new URL(baseUrl).hostname)
  return async (input, init) => {
    const headers = new Headers(init?.headers)
    headers.set('User-Agent', 'stem/0.1')
    if (isOpencode) headers.set('x-opencode-session', OPENSESSION)
    return fetch(input, { ...init, headers })
  }
}

export function buildGateway(config: StemConfig, env: NodeJS.ProcessEnv): BuiltGateway {
  const warnings: string[] = []
  const providers = config.providers ?? {}
  const map = new Map<string, ModelGateway>()

  for (const [name, p] of Object.entries(providers)) {
    const key = p.key_env ? env[p.key_env] : undefined
    if (p.key_env && !key) {
      warnings.push(`provider ${name}: key_env ${p.key_env} 未命中，用到时才会硬错`)
    }
    map.set(
      name,
      createOpenAiCompatibleGateway({
        baseUrl: p.base_url,
        apiKey: key,
        models: p.models && p.models.length ? p.models : undefined,
        fetch: providerFetch(p.base_url),
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
