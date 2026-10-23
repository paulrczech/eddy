# Sound credits

Eddy's instrument samples are self-hosted in `public/samples/` rather than fetched from
their original third-party hosts, so playback doesn't depend on someone else's uptime.
Most instruments below are sourced from their own sample pack via Pianobook.co.uk
(royalty-free per Pianobook's standard license); exceptions are noted individually below.

## Piano

Two piano voices, kept permanently as of 2026-09-30 (gain-matched to each other):

**Felt piano** — **Mikor Piano Felt** by Mikor, a Burger&Jacobi piano, felt pedal
engaged, close-miced with a pair of 414s from the nineties through ISA preamps. Soft
dynamic layer. Sourced from [Pianobook.co.uk](https://www.pianobook.co.uk).

**Piano** — **Upright Piano**, from the [Versilian Studios Chamber Orchestra: Community
Edition (VSCO2 CE)](https://versilstudios.com/vsco-community/), sampled by Simon Dalzell
of Ivy Audio. Per the pack's own license: "Bearer is granted right to redistribute this
sample set by Versilian Studios LLC. Credit to both original author and Versilian
Studios is encouraged." Sourced via Alex Bainter's generative-music course material.

Eddy's original piano in this slot was Salamander Grand Piano V2 (Alexander Holm,
CC-BY 3.0) — briefly replaced by Mikor Piano Felt, brought back as a second voice
alongside it, then replaced again by the VSCO2 upright piano above after Paul compared
the two directly and preferred it.

## Guitar (acoustic)

**Orange Tree Samples — Evolution Songwriter.** Sixteen notes (E2-C6, a root every minor third)
rendered by Paul from his own copy of the library and used inside the app with Orange Tree's
written permission (email from Orange Tree Samples support, 2026-10-22): the notes may be used in
the app, a credit mentioning that the samples are used with permission is appreciated, and no
licensing fee is needed while the app is free — if Eddy ever becomes a paid app, revisit it with
Orange Tree. Credited in the About screen. **Conditions to keep:** free app only; the notes are used
for playback inside the app, never offered as standalone files — so
`public/samples/guitar-acoustic-ots/` is **git-excluded** (the GitHub repo is public) and must stay
out of commits. (The email itself is kept privately, not in this repo.)

Previously: **Yindad Acoustic** (Paul's own recording) replaced **Soft Nylon Guitar Lite** by
Mike Georgiades ([Pianobook.co.uk](https://www.pianobook.co.uk)) 2026-10-07, which had replaced
the original steel-string samples (Nicholaus P. Brosowsky's tonejs-instruments, CC-BY 3.0,
University of Iowa Electronic Music Studios sample library). Yindad Acoustic was then replaced
by the Orange Tree notes above after a direct A/B (2026-10-22).

## Electric guitar (removed)

**Afterglow (Demo)** by Frédéric Poirier, via [Pianobook.co.uk](https://www.pianobook.co.uk), was
dropped 2026-10-23: Pianobook's terms don't allow shipping its samples inside an app. A saved flow
that names it plays the acoustic guitar. Candidates tried and rejected as replacements: a CC0
synth "straight guitar" (Yamaha CS-30L, modularsamples) and the tonejs-instruments electric guitar
(Karoryfer, CC-BY 3.0) — too synthy / too plucky.

## synth strings

Paul's own — a synthesizer patch of his own design, rendered note by note (not a third-party
sample pack, no external attribution needed). Added 2026-10-22, replacing the choir pad
(Sonatina Symphonic Orchestra chorus samples, CC Sampling Plus 1.0), which was removed to
clear any licence doubt about shipping it in the app.

## analog synth (temp)

**Moog Minitaur - Simple Saw** by modularsamples, sourced from
[freesound.org](https://freesound.org/people/modularsamples/packs/17167/). Licensed
[Creative Commons 0](http://creativecommons.org/publicdomain/zero/1.0/) (public domain).
Added 2026-10-09 as a temp A/B candidate (see `SHOW_ANALOG_SYNTH_TEMP` in
settingsStore.ts) — not yet decided whether it becomes a permanent slot.
