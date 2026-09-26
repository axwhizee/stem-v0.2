// WebUI —— 浏览器单页：HTTP + SSE；写口经 pilot。

import { createServer } from 'node:http'
import { bootStem, resolveProjectRoot } from '../host/index.ts'
import type { PilotEvent } from '../../src/core/events/index.ts'

const html = `<!doctype html>
<meta charset="utf-8">
<title>stem</title>
<style>
body{font:14px/1.5 system-ui,sans-serif;max-width:720px;margin:2rem auto;padding:0 1rem}
#log{border:1px solid #ccc;border-radius:8px;padding:1rem;min-height:240px;white-space:pre-wrap}
input,button{font:inherit;padding:.4rem .6rem}
</style>
<h1>stem web</h1>
<div id="log"></div>
<p><input id="in" style="width:70%" placeholder="说点什么"> <button id="send">发送</button></p>
<script>
const log=document.getElementById('log')
const es=new EventSource('/api/events')
es.onmessage=(e)=>{const d=JSON.parse(e.data);log.textContent+=JSON.stringify(d)+'\\n'}
document.getElementById('send').onclick=async()=>{
  const t=document.getElementById('in').value
  if(!t)return
  await fetch('/api/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:t})})
  document.getElementById('in').value=''
}
</script>
`

export async function startWebui(projectRoot = resolveProjectRoot(), port = 4321): Promise<void> {
  const boot = await bootStem({
    projectRoot,
    stateStore: true,
    timer: {
      set(ms, fn) {
        const t = setTimeout(fn, Math.max(ms, 20))
        return () => clearTimeout(t)
      },
    },
  })

  const clients = new Set<(data: string) => void>()
  boot.system.events.on((e: PilotEvent) => {
    const payload = `data: ${JSON.stringify(e)}\n\n`
    for (const c of clients) c(payload)
  })

  createServer((req, res) => {
    if (req.url === '/' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(html)
      return
    }
    if (req.url === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
      return
    }
    if (req.url === '/api/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      })
      const send = (chunk: string) => res.write(chunk)
      clients.add(send)
      req.on('close', () => clients.delete(send))
      return
    }
    if (req.url === '/api/send' && req.method === 'POST') {
      let body = ''
      req.on('data', (d) => {
        body += d
      })
      req.on('end', async () => {
        try {
          const { text } = JSON.parse(body || '{}') as { text?: string }
          if (text) await boot.pilot.send(text)
          res.writeHead(204)
          res.end()
        } catch {
          res.writeHead(400)
          res.end()
        }
      })
      return
    }
    res.writeHead(404)
    res.end()
  }).listen(port, '127.0.0.1', () => {
    console.log(`stem webui http://127.0.0.1:${port}`)
  })
}

if (process.argv[1] && process.argv[1].endsWith('webui/server.ts')) {
  startWebui().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
