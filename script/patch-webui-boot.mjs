import { readFileSync, writeFileSync } from 'node:fs'

const p = 'shell/webui/app.js'
let s = readFileSync(p, 'utf8')

s = s.replace(
  /;\s*\(async \(\) => \{[\s\S]*?\}\)\(\)\s*$/,
  `;(async () => {
  await loadModels()
  await loadTemplates()
  await loadAgents()
  await selectAgent(ROOT_ID)
  openStream()
})()
`,
)

// letter 事件始终刷新树
s = s.replace(
  /if \(ev\.agentId === currentAgentId\) \{\s*\n\s*\/\/[^\n]*\n\s*void loadContext\(currentAgentId\)/,
  `void loadAgents()
      if (ev.agentId === currentAgentId) {
        void loadContext(currentAgentId)`,
)

writeFileSync(p, s)
console.log('boot', s.includes('selectAgent(ROOT_ID)'))
console.log('letter', /void loadAgents\(\)\s*\n\s*if \(ev\.agentId === currentAgentId\)/.test(s))
