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

**Yindad Acoustic** — Paul's own recording (not a third-party sample pack, no external
attribution needed). Replaced **Soft Nylon Guitar Lite** by Mike Georgiades (sourced from
[Pianobook.co.uk](https://www.pianobook.co.uk)) outright 2026-10-07 after a direct A/B in
the simulator. Soft Nylon Guitar Lite had itself replaced the original steel-string
samples (Nicholaus P. Brosowsky's tonejs-instruments, CC-BY 3.0, University of Iowa
Electronic Music Studios sample library), which read as too bright/harsh under Eddy's
sustained, looping playback — same reasoning as the piano swap.

**Acoustic guitar (temp)** — "ClassicalGuitar-multisampled" by quartertone, a Yamaha
Eterna classical guitar, sourced from
[freesound.org](https://freesound.org/people/quartertone/packs/11573/). Licensed
[Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/) —
attribution required, given here. Added 2026-10-09 as a temp A/B candidate for the
acoustic guitar slot (see `SHOW_GUITAR_QUARTERTONE_TEMP` in settingsStore.ts) — not yet
decided whether it becomes a permanent slot.

## Electric guitar

**Afterglow (Demo)**, v1.0, by Frédéric Poirier
([pianobook.co.uk/profile/fred-poirier](https://www.pianobook.co.uk/profile/fred-poirier)).
Sourced from [Pianobook.co.uk](https://www.pianobook.co.uk).

## ambient pad

**Ultra Ambient Pad** by Julian Morgan. Sourced from
[Pianobook.co.uk](https://www.pianobook.co.uk). Replaced the original "Blackhole
Guitars" pad (by JWB) entirely 2026-09-30 — Paul felt the original wasn't musically
accurate.

## retro pad (hidden)

Paul's own recording — a Logic RetroSynth patch of his own design, printed to audio note
by note (not a third-party sample pack, no external attribution needed). Added
2026-10-05, replacing an earlier from-scratch Tone.js live-synthesis attempt at a second
pad voice that never quite landed by ear. Superseded as the default/shown pad by choir
pad below 2026-10-09 (see `SHOW_RETRO_PAD` in settingsStore.ts) — kept for saved-session
backward compatibility, not selectable as a new choice going forward.

## choir pad

Male and female chorus voices from **Sonatina Symphonic Orchestra** (originally created
by Mattias Westlund; ongoing development at [github.com/peastman/sso](https://github.com/peastman/sso)),
merged into a single instrument — male covers the lower register, female the upper,
spliced together chromatically with no gap or overlap. Licensed under [Creative Commons
Sampling Plus 1.0](https://creativecommons.org/licenses/sampling+/1.0/). Added
2026-10-09, replacing retro pad as the default/shown pad after Paul compared them
directly and preferred it.
