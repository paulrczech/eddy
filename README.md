# eddy

*let the music move itself*

A minimal voice-leading tool for songwriters and composers, inspired by Brian Eno's
*Oblique Strategies*. Instead of picking chords, you move individual voices by small
intervals, guided by a strategy drawn from a deck of twenty — the chord that results is a
byproduct, not the point.

## How it works

- Start from a random cluster of notes, or choose your own starting voices.
- A strategy from the deck ("the drift") constrains how the voices are allowed to
  move — *hold the bass, release everything above*; *stay, but change everything*;
  *strip it to bones*.
- A handful of candidate moves ("streams") are generated within those constraints. Tap
  one to preview it, then add it to your sequence ("the flow").
- Repeat. Undo, redo, edit or reorder any move along the way. When you're happy with
  where it's gone, export the sequence as MIDI or save it to come back to later.

No chord names are ever shown. The point is the movement, not the label for where it
lands.

## Stack

- [Vue 3](https://vuejs.org/) (`<script setup>`) + [Ionic](https://ionicframework.com/)
  for the UI
- [Pinia](https://pinia.vuejs.org/) for state
- [Tone.js](https://tonejs.github.io/) for audio, with self-hosted instrument samples
  (see [CREDITS.md](./CREDITS.md))
- [@tonejs/midi](https://github.com/Tonejs/Midi) for MIDI export
- No backend — everything runs client-side, saved sessions live in `localStorage`
- [Capacitor](https://capacitorjs.com/) for the native mobile build (in progress)

## Getting started

```bash
npm install
npm run dev
```

Other scripts:

```bash
npm run build      # typecheck + production build
npm run preview    # preview the production build locally
npm run test:unit  # vitest
npm run test:e2e   # cypress
npm run lint       # eslint
```

## Project layout

- `src/data/` — MIDI constants, the strategy deck, scale/mode definitions
- `src/utils/` — voice-leading helpers, MIDI export, saved-session storage
- `src/composables/` — the voice-leading engine, the strategy deck, the audio engine
- `src/stores/` — Pinia stores for settings and the active sequence
- `src/views/` / `src/components/` — the app itself

## Status

Actively developed, pre-v1. Core flow (start → drift → confirm → export/save) is in
place; native iOS/Android builds via Capacitor are next up.

## Credits

Instrument samples are self-hosted rather than pulled from third-party CDNs, so playback
doesn't depend on someone else's uptime. Full attribution in [CREDITS.md](./CREDITS.md).
