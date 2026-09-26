// JSON Schema 子集参数校验（模型与运行时共用一份）。

import type { ToolParametersSchema, ToolPropertySchema } from './types.ts'

export function validateArgs(
  schema: ToolParametersSchema,
  input: unknown,
): string | undefined {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return 'arguments 必须是对象'
  }
  const obj = input as Record<string, unknown>
  for (const key of schema.required ?? []) {
    if (obj[key] === undefined) return `缺少必填参数 ${key}`
  }
  for (const [key, value] of Object.entries(obj)) {
    const prop = schema.properties[key]
    if (!prop) continue
    const err = checkProp(prop, value, key)
    if (err) return err
  }
  return undefined
}

function checkProp(prop: ToolPropertySchema, value: unknown, path: string): string | undefined {
  if (value === null || value === undefined) return undefined
  switch (prop.type) {
    case 'string':
      if (typeof value !== 'string') return `${path} 应为 string`
      break
    case 'number':
      if (typeof value !== 'number') return `${path} 应为 number`
      break
    case 'boolean':
      if (typeof value !== 'boolean') return `${path} 应为 boolean`
      break
    case 'array':
      if (!Array.isArray(value)) return `${path} 应为 array`
      if (prop.items) {
        for (let i = 0; i < value.length; i++) {
          const err = checkProp(prop.items, value[i], `${path}[${i}]`)
          if (err) return err
        }
      }
      break
    case 'object':
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return `${path} 应为 object`
      }
      break
    case 'null':
      break
  }
  if (prop.enum && !prop.enum.some((e) => e === value)) {
    return `${path} 应为 ${prop.enum.join(' | ')}`
  }
  return undefined
}
