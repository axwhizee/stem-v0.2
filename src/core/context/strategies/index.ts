import type { ContextStrategy, StrategyRegistry } from '../types.ts'

export function createStrategyRegistry(
  strategies: readonly ContextStrategy[],
): StrategyRegistry {
  const map = new Map(strategies.map((s) => [s.name, s]))
  return {
    get: (name) => map.get(name),
    names: () => [...map.keys()],
  }
}

export * from './classic.ts'
export * from './none.ts'
