import { readFileSync, writeFileSync } from 'node:fs'

const p = 'shell/webui/app.js'
let s = readFileSync(p, 'utf8')

// 族谱树不显示 user#0（我们扮演根）；根的子节点提升为顶层展示
const oldLoad = `async function loadAgents(prefetched) {
  const agents = prefetched ?? await fetch('/api/agents').then((r) => r.json())
  agentsCache = agents
  const tree = $('tree')
  tree.innerHTML = ''
  for (const row of computeTreeRows(agents)) {`

const newLoad = `function treeAgentsOf(agents) {
  // 扮演 user#0：树只展示实例化 agent；根的子节点作为顶层
  return (agents || []).filter((a) => a.id !== ROOT_ID && a.id !== '0').map((a) => ({
    ...a,
    parentId: a.parentId === ROOT_ID || a.parentId === '0' ? null : a.parentId,
  }))
}

async function loadAgents(prefetched) {
  const agents = prefetched ?? await fetch('/api/agents').then((r) => r.json())
  agentsCache = agents
  const tree = $('tree')
  tree.innerHTML = ''
  for (const row of computeTreeRows(treeAgentsOf(agents))) {`

if (!s.includes('treeAgentsOf')) {
  s = s.replace(oldLoad, newLoad)
}

// emptyHint / 发送允许：按树中实例数判断
s = s.replace(
  "if (agentsCache.filter((a) => a.parentId !== null).length === 0)",
  "if (treeAgentsOf(agentsCache).length === 0)",
)

writeFileSync(p, s)
console.log('tree filter', s.includes('treeAgentsOf'))
