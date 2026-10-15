import { ref } from 'vue'
import { STRATEGIES, KEY_LEAVING_STRATEGY_IDS, Strategy } from '../data/strategies'

export function useStrategyDeck(keyLockActive: () => boolean) {
  const currentStrategy = ref<Strategy | null>(null)
  const drawHistory = ref<Strategy[]>([])

  // Eligible strategies given current key lock state. The key-leaving ones are never
  // eligible: locked means locked, and they only made sense with a lock on anyway.
  function eligibleStrategies(): Strategy[] {
    return STRATEGIES.filter(
      s => !KEY_LEAVING_STRATEGY_IDS.has(s.id) && (!s.requiresKeyLock || keyLockActive())
    )
  }

  // Draw a new strategy, avoiding the last drawn if possible
  function draw(): Strategy {
    const eligible = eligibleStrategies()
    const lastId = currentStrategy.value?.id

    const pool = eligible.length > 1
      ? eligible.filter(s => s.id !== lastId)
      : eligible

    const strategy = pool[Math.floor(Math.random() * pool.length)]
    currentStrategy.value = strategy
    drawHistory.value.push(strategy)
    return strategy
  }

  function reset() {
    currentStrategy.value = null
    drawHistory.value = []
  }

  return { currentStrategy, drawHistory, draw, reset }
}
