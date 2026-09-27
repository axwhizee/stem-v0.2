import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

function walk(d) {
  for (const f of readdirSync(d)) {
    const p = join(d, f)
    if (statSync(p).isDirectory()) walk(p)
    else if (p.endsWith('.ts')) {
      let s = readFileSync(p, 'utf8')
      const n = s
        .replaceAll("makeAgentID('0.0')", "makeAgentID('1')")
        .replaceAll("'0.0'", "'1'")
        .replaceAll('"0.0"', '"1"')
      if (n !== s) {
        writeFileSync(p, n)
        console.log('patched', p)
      }
    }
  }
}
walk('src')
walk('extension')
walk('test')
