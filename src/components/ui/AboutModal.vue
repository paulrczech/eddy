<template>
  <ion-modal
    :is-open="isOpen"
    @did-dismiss="$emit('close')"
    :initial-breakpoint="0.6"
    :breakpoints="[0, 0.6, 1]">
    <ion-content class="ion-padding">
      <div class="about-layout">
        <div class="about-header">
          <h2 class="about-title">eddy</h2>
          <p class="about-sub">let the music move itself</p>
        </div>

        <div class="about-body">
          <p>
            Tap "let it flow" for a random start, or choose your own notes first.
            Everything else happens on the next screen.
          </p>

          <p>
            There, tap a stream to hear it, then "add to the flow" to make it your
            next move. The drift card tells you what to try — sometimes one voice
            moves, sometimes all of them do.
          </p>

          <p>
            Never mind the names of chords. Here harmony results from small,
            organic movements - feeling inevitable without being predictable.
          </p>
          <p>
            No bad answers. A natural course to follow. Find your flow and then
            export the discovery.
          </p>
        </div>

        <p class="about-credits">
          Piano samples: Salamander Grand Piano by Alexander Holm. Guitar samples via
          nbrosowsky/tonejs-instruments (CC-BY 3.0). Electric piano and electric guitar
          via Pianobook.co.uk. Holdsworthian pad: Blackhole Guitars by JWB. See CREDITS.md.
        </p>

        <button class="btn-outline close-btn" @click="$emit('close')">close</button>
      </div>
    </ion-content>
  </ion-modal>
</template>

<script setup lang="ts">
  import { IonModal, IonContent } from '@ionic/vue'

  defineProps<{ isOpen: boolean }>()
  defineEmits<{ close: [] }>()
</script>

<style scoped>
  .about-layout {
    display: flex;
    flex-direction: column;
    gap: 1.4rem;
    padding: 1rem 0 2rem;
    max-width: 480px;
    margin: 0 auto;
  }

  .about-header {
    text-align: center;
  }

  .about-title {
    font-family: var(--font-serif);
    font-size: var(--text-xl);
    font-weight: 300;
    letter-spacing: 0.08em;
    color: var(--color-text);
    margin: 0 0 0.3rem;
  }

  .about-sub {
    font-family: var(--font-serif);
    font-size: var(--text-base);
    font-weight: 300;
    letter-spacing: 0.06em;
    color: var(--color-text-dim);
    font-style: italic;
    margin: 0;
  }

  .about-body {
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
  }

  .about-body p {
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    line-height: 1.7;
    color: var(--color-text);
    margin: 0;
  }

  .about-body em {
    font-style: italic;
    color: var(--color-accent);
  }

  .about-credits {
    font-family: var(--font-sans);
    font-size: var(--text-label);
    line-height: 1.5;
    color: var(--color-text-muted);
    text-align: center;
    margin: 0;
  }

  /* .btn-outline (box model, touch target) comes from theme/buttons.css */
  .close-btn {
    align-self: center;
    letter-spacing: 0.12em;
  }
</style>
