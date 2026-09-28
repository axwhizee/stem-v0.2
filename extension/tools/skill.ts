// extension 扩展：skill 工具（渐进披露）。
// 机制在 extension，内容住 .stem/skills/<名>/SKILL.md。

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { toolOk, toolError, type ToolCapability } from '../../src/core/tools/index.ts'

export type SkillToolOptions = {
  /** 技能根目录（.stem/skills） */
  readonly skillsRoot: string
}

type SkillEntry = {
  name: string
  description: string
  body: string
}

function loadSkill(skillsRoot: string, name: string): SkillEntry | undefined {
  const dir = join(skillsRoot, name)
  const file = join(dir, 'SKILL.md')
  if (!existsSync(file) || !statSync(file).isFile()) return undefined
  const text = readFileSync(file, 'utf8')
  const parsed = parseFrontmatter(text)
  return {
    name: parsed.name ?? name,
    description: parsed.description ?? '',
    body: parsed.body,
  }
}

function parseFrontmatter(text: string): { name?: string; description?: string; body: string } {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!m) return { body: text }
  const header = m[1] ?? ''
  const body = m[2] ?? ''
  const name = unquote(/^name:\s*(.+)$/m.exec(header)?.[1]?.trim())
  const description = unquote(/^description:\s*(.+)$/m.exec(header)?.[1]?.trim())
  return { name, description, body }
}

function unquote(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const s = value.trim()
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1)
  }
  return s
}

function listSkills(skillsRoot: string): SkillEntry[] {
  if (!existsSync(skillsRoot)) return []
  return readdirSync(skillsRoot)
    .filter((n) => {
      try {
        return statSync(join(skillsRoot, n)).isDirectory()
      } catch {
        return false
      }
    })
    .map((n) => loadSkill(skillsRoot, n))
    .filter((s): s is SkillEntry => s !== undefined)
}

export function createSkillTool(options: SkillToolOptions): ToolCapability {
  return {
    name: 'skill',
    description: 'Load a skill document (progressive disclosure). Call without name to list skills.',
    kind: 'extension',
    registerAccess: 'hidden',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'skill name; omit to list available skills' },
      },
    },
    execute: (input: unknown) => {
      const name = String((input as { name?: string })?.name ?? '')
      if (!name) {
        const skills = listSkills(options.skillsRoot)
        if (skills.length === 0) return toolOk('(no skills)')
        return toolOk(skills.map((s) => `- ${s.name}: ${s.description}`).join('\n'))
      }
      if (name.includes('/') || name.includes('\\') || name.includes('..')) {
        return toolError('invalid skill name', 'invalid_args')
      }
      const skill = loadSkill(options.skillsRoot, name)
      if (!skill) return toolError(`skill not found: ${name}`, 'not_found')
      return toolOk(`# ${skill.name}\n${skill.description}\n\n${skill.body}`)
    },
  }
}
