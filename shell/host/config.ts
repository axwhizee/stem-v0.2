// shell 宿主：配置与空间定位。

import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  defaultStemConfig,
  parseStemConfig,
  type StemConfig,
  type ConfigIssue,
} from '../../src/core/config/index.ts'

export type { StemConfig }

export function resolveProjectRoot(argv: readonly string[] = process.argv.slice(2)): string {
  const positional = argv.find((a) => !a.startsWith('-'))
  return resolve(positional ?? process.env.STEM_PROJECT_ROOT ?? process.cwd())
}

export function stemDir(projectRoot: string): string {
  return join(projectRoot, '.stem')
}

export function defaultDbFile(projectRoot: string): string {
  return process.env.STEM_DB_PATH ?? join(stemDir(projectRoot), 'stem.db')
}

export function loadStemConfig(projectRoot: string): StemConfig | ConfigIssue {
  const file = join(stemDir(projectRoot), 'stem.jsonc')
  if (!existsSync(file)) return defaultStemConfig()
  return parseStemConfig(readFileSync(file, 'utf8'))
}

/** 首启落盘模板，保证空间可发现。 */
export function ensureSpace(projectRoot: string): void {
  const dir = stemDir(projectRoot)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  for (const sub of ['agent', 'strategy', 'tools', 'assets', 'home']) {
    const p = join(dir, sub)
    if (!existsSync(p)) mkdirSync(p, { recursive: true })
  }
  const file = join(dir, 'stem.jsonc')
  if (!existsSync(file)) {
    writeFileSync(file, JSON.stringify(defaultStemConfig(), null, 2), 'utf8')
  }
}
