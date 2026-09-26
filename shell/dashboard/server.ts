// dashboard —— 只读法医/运维：语料、实例、工具清单。无扮演写口。

import { createServer } from 'node:http'
import { bootStem, resolveProjectRoot } from '../host/index.ts'

export async function startDashboard(projectRoot = resolveProjectRoot(), port = 4421): Promise<void> {
  const boot = await bootStem({ projectRoot, stateStore: true })

  createServer((req, res) => {
    const json = (body: unknown, status = 200) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify(body, null, 2))
    }
    if (req.url === '/' ) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(`<!doctype html><meta charset="utf-8"><title>stem dashboard</title>
<body style="font:14px system-ui;max-width:800px;margin:2rem auto">
<h1>stem dashboard</h1>
<ul>
<li><a href="/api/health">health</a></li>
<li><a href="/api/instances">instances</a></li>
<li><a href="/api/tools">tools</a></li>
<li><a href="/api/messages/0">messages of 0</a></li>
</ul></body>`)
      return
    }
    if (req.url === '/api/health') {
      return json({
        ok: true,
        root: boot.pilot.actAs,
        issues: boot.system.init.issues,
      })
    }
    if (req.url === '/api/instances') {
      const rows = []
      for (const id of [boot.pilot.actAs]) {
        const n = boot.system.lineage.get(id)
        rows.push(n)
      }
      return json(rows)
    }
    if (req.url === '/api/tools') {
      return json(boot.system.tools.names())
    }
    if (req.url?.startsWith('/api/messages/')) {
      const id = req.url.slice('/api/messages/'.length)
      return json(
        boot.system.post
          .boxOf(id as never)
          .filter((e) => e.valid)
          .map((e) => ({
            id: e.id,
            from: e.from,
            at: e.at,
            kind: e.message.kind,
            preview: e.message.content
              .map((p) => (p.type === 'text' ? p.text : `[${p.type}]`))
              .join('')
              .slice(0, 120),
          })),
      )
    }
    res.writeHead(404)
    res.end()
  }).listen(port, '127.0.0.1', () => {
    console.log(`stem dashboard http://127.0.0.1:${port}`)
  })
}

if (process.argv[1]?.endsWith('dashboard/server.ts')) {
  startDashboard().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
