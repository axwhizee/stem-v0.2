// WebUI —— 浏览器单页（旧库界面考古）：静态三件套 + REST + SSE。
// 写口经 pilot/kernel；只读经 lineage/post。

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import { bootStem, resolveProjectRoot, type BootResult } from '../host/index.ts'
import { makeAgentID, parentIdOf, ROOT_AGENT_ID, textContent } from '../../src/core/model/index.ts'
import type { PilotEvent } from '../../src/core/events/index.ts'
import { parseModelRef } from '../../src/core/gateway/index.ts'

const PORT = Number(process.env.PORT ?? 4321)
const HOST = process.env.STEM_HOST ?? '127.0.0.1'
const PROJECT_ROOT = resolveProjectRoot()
const HERE = dirname(fileURLToPath(import.meta.url))

const MIME: Record<string, string> = {
  'index.html': 'text/html; charset=utf-8',
  'style.css': 'text/css; charset=utf-8',
  'app.js': 'text/javascript; charset=utf-8',
  'view.js': 'text/javascript; charset=utf-8',
}

function sendJson(res: ServerResponse, body: unknown, status = 200): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function sendStatic(res: ServerResponse, file: string): void {
  const p = join(HERE, file)
  if (!existsSync(p)) {
    res.writeHead(404)
    res.end('not found')
    return
  }
  res.writeHead(200, { 'Content-Type': MIME[file] ?? 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' })
  res.end(readFileSync(p))
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let raw = ''
    req.on('data', (d) => {
      raw += d
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(raw || '{}') as Record<string, unknown>)
      } catch {
        resolve({})
      }
    })
  })
}

function listAgents(boot: BootResult): unknown[] {
  const out: unknown[] = []
  const walk = (id: string) => {
    const node = boot.system.lineage.get(makeAgentID(id))
    if (!node) return
    const box = boot.system.post.boxOf(makeAgentID(id))
    const lastUser = [...box].reverse().find((e) => e.message.kind === 'user' && e.valid)
    out.push({
      id: String(node.id),
      name: node.attrs.name,
      classRef: node.attrs.classRef,
      parentId: parentIdOf(node.id) === null ? null : String(parentIdOf(node.id)),
      status: node.runtime.status,
      turnCount: node.runtime.turnCount,
      totalCost: 0,
      totalTokens: node.runtime.totalTokens,
      ctxTokens: node.runtime.ctxTokens,
      lastActive: node.runtime.lastActive,
      model: node.attrs.model,
      lastPrompt: lastUser ? textContent(lastUser.message).slice(0, 200) : '',
    })
    for (const child of boot.system.lineage.children(node.id)) walk(String(child))
  }
  walk(String(ROOT_AGENT_ID))
  return out
}

function contextOf(boot: BootResult, agentId: string, contextWindow = 1000000) {
  const box = boot.system.post.boxOf(makeAgentID(agentId))
  return {
    agentId,
    contextWindow,
    messages: box.map((e) => ({
      id: e.id,
      role: e.message.kind,
      content: e.message.content.map((p) => (p.type === 'text' ? p.text : `[${p.type}]`)).join(''),
      from: e.from,
      tag: e.tag,
      toolCalls: e.message.toolCalls,
      toolCallId: e.message.toolCallId,
      tokens: e.tokens,
      at: e.at,
      turn: e.turn,
      indexInTurn: e.indexInTurn,
      valid: e.valid,
    })),
  }
}

async function main(): Promise<void> {
  const boot = await bootStem({
    projectRoot: PROJECT_ROOT,
    stateStore: true,
    fakeGateway: process.env.STEM_FAKE_GATEWAY === '1',
    timer: {
      set(ms, fn) {
        const t = setTimeout(fn, Math.max(ms, 20))
        return () => clearTimeout(t)
      },
    },
    onEvent: broadcast,
  })

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
      const path = url.pathname

      if (req.method === 'GET' && (path === '/' || path === '/index.html')) return sendStatic(res, 'index.html')
      if (req.method === 'GET' && path === '/style.css') return sendStatic(res, 'style.css')
      if (req.method === 'GET' && path === '/app.js') return sendStatic(res, 'app.js')
      if (req.method === 'GET' && path === '/view.js') return sendStatic(res, 'view.js')

      if (req.method === 'GET' && path === '/api/health') {
        return sendJson(res, {
          ok: true,
          gateway: process.env.STEM_FAKE_GATEWAY === '1' ? 'fake' : 'providers',
          agents: listAgents(boot).length,
          uptimeSec: Math.round(process.uptime()),
          issues: boot.system.init.issues,
        })
      }
      if (req.method === 'GET' && path === '/api/events') return openSse(res)
      if (req.method === 'GET' && path === '/api/agents') return sendJson(res, listAgents(boot))
      if (req.method === 'GET' && path === '/api/templates') {
        return sendJson(
          res,
          boot.system.kernel.classNames().map((name) => ({ name, ...boot.system.kernel.classOf(name)?.genes })),
        )
      }
      if (req.method === 'GET' && path === '/api/models') return sendJson(res, { refs: [], openEnded: [] })
      if (req.method === 'GET' && path.startsWith('/api/agents/') && path.endsWith('/context')) {
        const agentId = decodeURIComponent(path.slice('/api/agents/'.length, -'/context'.length))
        return sendJson(res, contextOf(boot, agentId))
      }

      if (req.method === 'POST') {
        const body = await readBody(req)
        if (path === '/api/send') {
          await boot.pilot.send(String(body.text ?? ''))
          return sendJson(res, { ok: true })
        }
        if (path === '/api/instantiate') {
          const result = await boot.system.kernel.instantiate({
            className: String(body.className),
            userPrompt: String(body.userPrompt ?? ''),
            parentId: body.parentId ? makeAgentID(String(body.parentId)) : ROOT_AGENT_ID,
            name: typeof body.name === 'string' && body.name ? body.name : undefined,
            incoming: {
              model: typeof body.model === 'string' && body.model ? body.model : undefined,
            },
          })
          if (!('id' in result)) return sendJson(res, { error: result.kind }, 400)
          return sendJson(res, { ok: true, agentId: String(result.id) })
        }
        if (path === '/api/terminate') {
          const err = boot.system.kernel.terminate(makeAgentID(String(body.agentId)))
          return sendJson(res, err ? { error: err.kind } : { ok: true }, err ? 400 : 200)
        }
        if (path === '/api/interrupt') {
          const err = boot.system.kernel.interrupt(makeAgentID(String(body.agentId)))
          boot.runtime.interrupt(makeAgentID(String(body.agentId)))
          return sendJson(res, err ? { error: err.kind } : { ok: true }, err ? 400 : 200)
        }
        if (path === '/api/set_model' || path === '/api/update') {
          const patch: Record<string, unknown> = {}
          if (body.name) patch.name = body.name
          if (body.model) {
            const ref = parseModelRef(String(body.model))
            patch.model = ref ? `${ref.provider}/${ref.id}` : body.model
          }
          if (body.temperature !== undefined) patch.temperature = body.temperature
          if (body.effort !== undefined) patch.effort = body.effort
          const err = boot.system.kernel.updateAgent(makeAgentID(String(body.agentId ?? ROOT_AGENT_ID)), patch)
          return sendJson(res, err ? { error: err.kind } : { ok: true }, err ? 400 : 200)
        }
        if (path === '/api/class_update') {
          const name = String(body.name)
          const existing = boot.system.kernel.classOf(name)
          if (!existing) return sendJson(res, { error: 'class_not_found' }, 400)
          const err = boot.system.kernel.updateClassGenes(name, {
            ...existing.genes,
            ...(body.sysPrompt !== undefined ? { sysPrompt: String(body.sysPrompt) } : {}),
            ...(body.model !== undefined ? { model: String(body.model) } : {}),
          })
          return sendJson(res, err ? { error: err.kind } : { ok: true }, err ? 400 : 200)
        }
        if (path === '/api/context_action') {
          // compact 等：暂只回 ok，策略 process 由水位自动触发
          return sendJson(res, { ok: true })
        }
      }
      res.writeHead(404)
      res.end()
    } catch (error) {
      console.error(error)
      sendJson(res, { error: String(error) }, 500)
    }
  })

  server.listen(PORT, HOST, () => {
    console.log(`stem webui http://${HOST}:${PORT}`)
  })
}

const clients = new Set<ServerResponse>()
function broadcast(event: PilotEvent): void {
  const payload = `data: ${JSON.stringify(event)}\n\n`
  for (const res of clients) res.write(payload)
}
function openSse(res: ServerResponse): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })
  clients.add(res)
  res.write(`data: ${JSON.stringify({ type: 'status', agentId: '0', from: '', to: 'connected', at: Date.now() })}\n\n`)
  res.on('close', () => clients.delete(res))
}

if (process.argv[1] && /webui[\\/]server\.ts$/.test(process.argv[1])) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
