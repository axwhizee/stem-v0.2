// WebUI —— 浏览器单页：HTTP + SSE；写口经 pilot。

import { createServer } from 'node:http'
import { bootStem, resolveProjectRoot } from '../host/index.ts'
import type { PilotEvent } from '../../src/core/events/index.ts'

const html = `<!doctype html>
<meta charset="utf-8">
<title>stem web</title>
<style>
  body{font:14px/1.6 system-ui,sans-serif;max-width:860px;margin:1.5rem auto;padding:0 1rem;color:#1a1a1a}
  h1{font-size:1.25rem;font-weight:600}
  #log{border:1px solid #d0d0d0;border-radius:10px;padding:1rem;min-height:280px;background:#fafafa}
  .msg{margin:.5rem 0;padding:.6rem .8rem;border-radius:8px;white-space:pre-wrap}
  .user{background:#e8f0fe}
  .assistant{background:#e6f4ea}
  .tool{background:#fff4e5;font-size:12px}
  .sys{color:#666;font-size:12px}
  input,button{font:inherit;padding:.45rem .7rem;border-radius:6px;border:1px solid #ccc}
  button{background:#1a73e8;color:#fff;border-color:#1a73e8;cursor:pointer}
  #bar{margin-top:.75rem;display:flex;gap:.5rem}
  #in{flex:1}
  #tools{margin-top:.75rem;color:#666;font-size:12px}
</style>
<h1>stem web</h1>
<div id="log"><div class="sys">等待输入…（工具与事件会显示在这里）</div></div>
<div id="bar">
  <input id="in" placeholder="对 user#0 说话，例如：列出工具并 ping 一次">
  <button id="send">发送</button>
</div>
<div id="tools"></div>
<script>
const log=document.getElementById('log')
function add(cls,text){
  const d=document.createElement('div')
  d.className='msg '+cls
  d.textContent=text
  log.appendChild(d)
  d.scrollIntoView({block:'end'})
}
let streamBuf=null
const es=new EventSource('/api/events')
es.onmessage=(e)=>{
  const d=JSON.parse(e.data)
  if(d.type==='stream'){
    if(!streamBuf){streamBuf=add('assistant','')}
    streamBuf.textContent+=d.text
    streamBuf.scrollIntoView({block:'end'})
  }else if(d.type==='letter'){
    streamBuf=null
  }else if(d.type==='tool'){
    add('tool', d.phase+' · '+d.name)
  }else if(d.type==='status'){
    add('sys','['+d.agentId+'] '+d.status)
  }else if(d.type==='error'){
    add('sys','error: '+d.message)
  }
}
document.getElementById('send').onclick=async()=>{
  const t=document.getElementById('in').value.trim()
  if(!t)return
  add('user',t)
  document.getElementById('in').value=''
  streamBuf=null
  await fetch('/api/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:t})})
}
document.getElementById('in').addEventListener('keydown',e=>{if(e.key==='Enter')document.getElementById('send').click()})
fetch('/api/tools').then(r=>r.json()).then(t=>{
  document.getElementById('tools').textContent='已注册工具: '+(t.tools||[]).join(', ')
})
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
      res.end(JSON.stringify({ ok: true, issues: boot.system.init.issues }))
      return
    }
    if (req.url === '/api/tools') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ tools: boot.system.tools.names() }))
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

if (process.argv[1] && (process.argv[1].endsWith('webui/server.ts') || process.argv[1].endsWith('webui\\server.ts'))) {
  startWebui().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
