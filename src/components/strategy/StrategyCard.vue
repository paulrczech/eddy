<template>
  <div class="strategy-wrapper">
    <p class="section-label">the drift</p>
    <div class="strategy-card">
      <p class="strategy-text">{{ strategy.text }}</p>
      <button class="icon-btn hint-btn" aria-label="What does this mean?" @click="hintOpen = true">
        <IonIcon :icon="informationCircleOutline" />
      </button>
    </div>

    <IonModal
      :is-open="hintOpen"
      :breakpoints="[0, 0.22]"
      :initial-breakpoint="0.22"
      :handle="true"
      @did-dismiss="hintOpen = false">
      <div class="hint-sheet">
        <p class="hint-title">{{ strategy.text }}</p>
        <p class="hint-text">{{ strategy.hint }}</p>
        <p v-if="strategy.requiresKeyLock" class="hint-lock">
          Requires Key Lock to be active.
        </p>
      </div>
    </IonModal>
  </div>
</template>

<script setup lang="ts">
  import { ref } from 'vue'
  import { IonModal, IonIcon } from '@ionic/vue'
  import { informationCircleOutline } from 'ionicons/icons'
  import type { Strategy } from '../../data/strategies'

  defineProps<{ strategy: Strategy }>()

  const hintOpen = ref(false)
</script>

<style scoped>

  .strategy-card {
    background: linear-gradient(
      145deg,
      rgba(30, 38, 50, 0.4),
      rgba(14, 18, 24, 0.2)
    );
    border: 1px solid var(--color-border-subtle);
    border-radius: 12px;
    padding: 0.35rem 1rem;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  /* .icon-btn's 44px min-height (theme/buttons.css) is a touch-target minimum that
     otherwise dominates this row's height regardless of padding — override it down to
     icon size to match the card's compact fixed height. */
  .hint-btn {
    min-width: 1.75rem;
    min-height: 1.75rem;
  }

  .strategy-text {
    font-family: var(--font-serif);
    font-size: var(--text-sm);
    font-weight: 300;
    font-style: italic;
    color: var(--color-text-dim);
    margin: 0;
    flex: 1;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* .icon-btn (box model, touch target) comes from theme/buttons.css — this
     modifier only sets the compact in-content glyph size and hover tint */
  .hint-btn {
    font-size: var(--icon-sm);
    flex-shrink: 0;
  }
  .hint-btn:hover {
    color: var(--color-accent);
  }

  .hint-sheet {
    padding: 1.5rem 1.5rem 2.5rem;
  }

  .hint-title {
    font-family: var(--font-serif);
    font-size: var(--text-lg);
    font-weight: 300;
    font-style: italic;
    color: var(--color-text);
    margin: 0 0 0.8rem;
    line-height: 1.4;
  }

  .hint-text {
    font-size: var(--text-sm);
    line-height: 1.6;
    color: var(--color-text-dim);
    margin: 0 0 0.6rem;
  }

  .hint-lock {
    font-size: var(--text-xs);
    color: var(--color-accent);
    margin: 0;
    font-style: italic;
  }
</style>
