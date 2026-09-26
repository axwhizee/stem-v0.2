// 打戳：采集（信封）与投影（LLM 可见）分离。

import type { Envelope, Message, ContentPart } from '../model/index.ts'
import type { StampConfig } from './types.ts'

/** 入库前打戳采集。 */
export function collectStamp(envelope: Envelope, config: StampConfig, at: number): Envelope {
  const stamp = {
    timestamp: config.timestamp ? true : undefined,
    delay: config.delay ? true : undefined,
    tokens: config.tokens ? true : undefined,
  }
  return { ...envelope, at: config.timestamp ? at : envelope.at, stamp }
}

/** 策略投影时可把 stamp 编进文本前缀。 */
export function projectStamp(
  envelope: Envelope,
  config: StampConfig,
  parts: readonly ContentPart[],
): ContentPart[] {
  const bits: string[] = []
  if (config.source && envelope.from !== undefined) bits.push(`from=${String(envelope.from)}`)
  if (config.timestamp && stampValue(envelope, 'timestamp')) bits.push(`at=${envelope.at}`)
  if (config.tokens && envelope.tokens !== undefined) bits.push(`tokens=${envelope.tokens}`)
  if (bits.length === 0) return [...parts]
  return [{ type: 'text', text: `[${bits.join(' ')}] ` }, ...parts]
}

function stampValue(envelope: Envelope, key: 'timestamp' | 'delay' | 'tokens'): boolean {
  return envelope.stamp?.[key] === true
}

/** classic 策略默认投影：valid 信 → Message；相邻 user 合并（合并窗口叠加）。 */
export function projectMessages(
  envelopes: readonly Envelope[],
  config: StampConfig,
): Message[] {
  const out: Message[] = []
  for (const env of envelopes) {
    if (!env.valid) continue
    const parts = projectStamp(env, config, env.message.content)
    const msg: Message = { ...env.message, content: parts }
    const last = out[out.length - 1]
    if (last && last.kind === 'user' && msg.kind === 'user') {
      out[out.length - 1] = {
        ...last,
        content: [...last.content, { type: 'text', text: '\n' }, ...msg.content],
      }
      continue
    }
    out.push(msg)
  }
  return out
}
