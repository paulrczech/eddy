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

        <div class="about-credits">
          <p class="credits-label">sounds</p>
          <p>
            Acoustic guitar: notes rendered from Evolution Songwriter by Orange Tree
            Samples, used with permission (orangetreesamples.com).
          </p>
          <p>
            Piano: Upright Piano from Versilian Studios' VSCO 2 Community Edition,
            sampled by Simon Dalzell (Ivy Audio).
          </p>
          <p>Felt piano: Mikor Piano Felt by Mikor Studio, via Pianobook.co.uk, used with permission.</p>
          <p>Analog synth: Moog Minitaur "Simple Saw" by modularsamples (CC0).</p>
          <p>Synth strings: original to Eddy.</p>
        </div>

        <div class="diag-row">
          <button class="btn-outline diag-btn" @click="exportDiagnostics">
            {{ diagExported ? 'sent' : 'export diagnostics' }}
          </button>
          <button class="icon-btn diag-clear-btn" title="clear diagnostic log" @click="clearDiagnostics">
            {{ diagCleared ? 'cleared' : 'clear log' }}
          </button>
        </div>

        <button class="btn-outline close-btn" @click="$emit('close')">close</button>
      </div>
    </ion-content>
  </ion-modal>
</template>

<script setup lang="ts">
  import { ref } from 'vue'
  import { IonModal, IonContent } from '@ionic/vue'
  import { getDiagLogText, clearDiagLog } from '../../utils/diagLog'
  import { saveAndShareBytes } from '../../utils/fileExport'

  defineProps<{ isOpen: boolean }>()
  defineEmits<{ close: [] }>()

  // For sending to Claude after noticing a dropout (audio stopping after the screen
  // locks, during a long loop, etc.) — not a user-facing feature, just a plain-text dump
  // of diagLog.ts's recorded entries via the same native share sheet MIDI/WAV export
  // already use, so there's no viewer UI to build here.
  const diagExported = ref(false)
  const diagCleared = ref(false)

  async function exportDiagnostics() {
    const text = getDiagLogText()
    const bytes = new TextEncoder().encode(text)
    await saveAndShareBytes(bytes, 'eddy-diagnostics.txt', 'text/plain', 'export diagnostics')
    diagExported.value = true
    setTimeout(() => { diagExported.value = false }, 1500)
  }

  // The log persists across app restarts by design (so it survives whatever crashed) —
  // but that means it silently accumulates across unrelated test sessions too, with no
  // way to tell old entries from new ones in an export. This starts fresh after sending
  // a report, so the next export only reflects what happens from here.
  function clearDiagnostics() {
    clearDiagLog()
    diagCleared.value = true
    setTimeout(() => { diagCleared.value = false }, 1500)
  }
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
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  .about-credits p {
    margin: 0;
  }
  .about-credits .credits-label {
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--color-text-dim);
    margin-bottom: 0.2rem;
  }

  .diag-row {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.6rem;
  }

  /* .btn-outline (box model, touch target) comes from theme/buttons.css */
  .diag-btn {
    font-size: var(--text-label);
    color: var(--color-text-dim);
    letter-spacing: 0.08em;
  }

  /* .icon-btn (box model, touch target) comes from theme/buttons.css — plain text here,
     not an icon, but it's a minor/secondary action next to diag-btn so the borderless
     treatment reads as lower-emphasis */
  .diag-clear-btn {
    font-size: var(--text-label);
    letter-spacing: 0.06em;
  }

  .close-btn {
    align-self: center;
    letter-spacing: 0.12em;
  }
</style>
