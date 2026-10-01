# Eddy — Downriver

Ideas, possibilities, and future directions. Added to as inspiration strikes. No commitment to timeline or order — just the vision.

---

## Open Discussion — Handoff (2026-10-01, round 2)

The previous four-topic handoff below is fully resolved and shipped (loop-range select,
live tempo ramping, two-column streams, simplified drift card — see commits `5b3e898` /
`6e624e7`, build 1.0(9)). Paul listed four new items before stepping away for a session
break — **not started, just queued**. Pick up here.

### 1. Scheduling fix for real-time structural updates
The deferred half of the mid-playback "jarble" work (see the old #2 below for the full
original analysis). Tempo is solved — `setTempoLive()` in `useAudioEngine.ts` ramps
`Transport.bpm` live, no restart. Direction/subdivision/latch/time-signature still do a
full `stopLoop(true)` + restart, which briefly hard-mutes (`HARD_STOP_MUTE_TIME`, 15ms).
The reverb-tail duck (ramping `outputReverb`/`outputChorus` wet to 0 and back over the
decay time) was tried and **reverted** — it traded the overlap glitch for a different,
also-noticeable problem: audibly quieter playback for the ~2s the wet was ducked. Current
state is the plain pre-existing mute/restart, unchanged.

The real fix is still the one scoped out originally: queue a structural change to land on
the next bar boundary instead of applying it instantly, so there's no restart-while-
sounding moment at all. Also now in scope: the same content-changes-while-playing problem
exists for sequence edits, not just settings — `editCluster()`, `confirmSelection()`,
`deleteCluster()`, `reorderClusters()`, and a new loop-range marker tap (`range-tap`) all
currently just hard-stop playback outright (Paul's explicit call for the loop-range case,
extended to match for the others) rather than live-patch the already-scheduled `Tone.Part`.
Worth deciding whether the bar-boundary mechanism, once built, should also absorb some of
these (e.g. a note edit landing on the next bar) or whether "stop and let the user replay"
stays the permanent answer for content changes even after structural settings go live.

### 2. Synthesized pad instrument
Paul has a Tone.js synth already built in a separate file, to replace the sampled
`holdsworthian-pad` (currently "Ultra Ambient Pad," Paul's own sample pack — see CREDITS.md
and the V2/deferred section above). Architecture note for whoever picks this up: every
instrument in `useAudioEngine.ts` today assumes a sample-backed `Tone.Sampler` —
`createSampler()`/`buildEffectsChain()` are shared between live `init()` and offline
`renderSequenceToBuffer()`, and per-instrument config (`INSTRUMENT_NOTE_RANGE`,
`NOTE_DURATIONS`, `REVERB_SETTINGS`, `CHORUS_SETTINGS`) is all keyed off that assumption. A
synth-based instrument needs a parallel construction path (a `Tone.PolySynth` or similar
isn't loaded from `public/samples/`, has no `loadBuffers()` step, and may want its own
note-range/duration defaults rather than inheriting a sampler's). Scope the integration
before diving in — this touches the one piece of the engine that's never had a second kind
of instrument before.

### 3. Default starter session in "Past Flows"
Paul's idea: ship a pre-made flow new users can load without having generated one
themselves — proposed a voice-led reduction of Chopin's Prelude in E minor (op. 28 no. 4),
which he notes fits Eddy's voice-leading style well. Two separate pieces of work: (a)
someone transcribes the piece into a `Cluster[]` sequence respecting Eddy's constraints
(E2–C6 range, 3 or 4 voices, no crossing, ≤40-semitone spread per cluster), and (b) the app
needs a *mechanism* for a bundled default that isn't just another row in
`sessionStorage.ts`'s user-generated list — "Past Flows" today is purely
localStorage-backed with no concept of an app-shipped template. Needs design: does it
always appear (even once the user has their own saved flows), is it distinguishable from
user sessions in the list, can it be dismissed/deleted like a normal one once seen, etc.

### 4. Latch mode on by default?
Paul's observation: latch (repeat-to-fill-the-bar, see `buildClusterEvents()` in
`arpeggioEngine.ts`) sounds noticeably nicer than the current default-off behavior, enough
that he's considering flipping `settingsStore.ts`'s `latchMode` default to `true`. Explicitly
flagged as "we can discuss" — not decided. Worth weighing against chord-direction's
existing latch-disable (latch has no effect there already) and whether a fuller-sounding
default changes first-impression expectations for new users versus what random/seed starts
already sound like today.

---

## Resolved — Handoff (2026-10-01, round 1)

Four UX topics Paul raised in one sitting; all four are now shipped (see round 2's intro
above). Kept here for the reasoning trail, not as an open list.

### 1. Rename "the current" (HomeView settings sheet)?
Resolved: kept the label as-is (poetic vocabulary consistency argument held), not revisited.

### 2. Mid-playback restart "jarble"
Partially resolved: tempo now live-ramps with no restart (see round 2 #1 above for what's
still open — the structural-settings case and the reverb-duck revert).

### 3. Play/loop from a selected stream in "the flow"
Resolved and shipped as full start+end range selection (went beyond the originally
recommended start-only v1 scope, per Paul's request) — loop-range toggle in
`SequenceHistory.vue`, unified bar+tint highlight across the whole selected block,
auto-stop on any marker tap or content change mid-playback.

### 4. Two-column streams layout
Resolved and shipped — `.candidates-grid` is a 2-column grid in `SessionView.vue`, pill
content wraps/tightens to fit 4-voice sharp-heavy clusters, single-candidate pills span
full width.

---

## Near-Term (V2–V3)

### Per-Voice Instrument Routing
Each voice gets its own instrument. V1 = cello, V2/V3 = violin, V4 = harp. Turns Eddy into a genuine chamber ensemble sketch tool. Engine is already built for single-sampler — needs multi-sampler routing layer.

### Gravity / Tendency Fields
Voices have subtle "pull" toward certain notes — tonal gravity without naming chords. A C-center makes C, E, G feel like rest points. Voices don't have to land there, but they're drawn. Users feel it, never see a theory label.

### Session Branching
Fork the flow at any point. Two branches from the same moment, diverging. Compare them side by side. Something no DAW does elegantly.

### Probabilistic Strategy Weights
Let users nudge how often certain strategies appear — sliders, not labels. "More contrary motion. Less parallel." Musical character shifts without exposing music theory.

### 5-Voice Support
Already flagged in V2 constraints. Natural extension once the core is stable.

### Voice Identity & Crossing (V2)
Currently voices are positional — lowest note is always V1, colors are positional. True voice identity would track each line across moves so colors follow the voice, not the position. This enables voice crossing (V2 dipping below V1, etc.) which is musically legitimate and happens constantly in real composition.

**Scope:** Crossing should only be allowed in Stream Edit mode inside the flow — not on the home screen starting note picker, where sorted ascending remains correct.

**Visual payoff:** Voice lines in the "River" view would visibly weave and cross, which is the musically true picture. Requires refactoring `Cluster` from a sorted array to an identity-tracked structure — meaningful but beautiful.

**It's one coherent feature, not four separate ones:**
- `Cluster` gets voice identity (not just sorted position)
- `generateCandidates` respects and propagates identity through each move
- Stream edit allows crossing
- Candidates generated from a crossed state reflect that state — the river flows from where it actually is
- The River view shows it all as truthfully weaving lines

Currently `generateCandidates` calls `sortCluster` on every output, which silently "fixes" any crossing. A user who deliberately crosses voices in edit mode would find the next candidates pretending it didn't happen — the river corrected against its will. This is the core thing to fix.

### Instrument Selector in Session View
Currently set only on home screen. Allow changing mid-session without losing the flow.

### Portable Session File (Import/Export)
A shareable `.eddy.json` file — same shape as a saved session (`sequence`, `voiceCount`, `instrument`, `name`) — exportable and re-importable to restore a full flow, not just a single cluster. Most of the mechanism already exists: `HomeView.vue`'s `loadSession()` already reconstructs an entire flow from a `SavedSession` via `start()` + a `confirm()` loop, so this is mostly export/import plumbing (same download-on-web / share-sheet-on-native pattern as MIDI export) plus validating the parsed JSON with the existing `isValidCluster()`. Restores "the flow" and "now"; a new drift strategy is drawn fresh on resume, same as loading a saved session today — the drift card was never part of the saved record.

Worth building sooner than "someday": once the iOS app ships, it has its own storage, entirely separate from the web app's `localStorage`. A flow saved on the web won't appear in "Past Flows" on the phone, and vice versa. A portable file doubles as the migration/backup path between them, not just a nice-to-have.

**Explicitly a separate, harder idea — don't bundle with the above:** reimporting a previously-*exported* `.mid` file to reconstruct a flow. `@tonejs/midi` already parses MIDI, so that part's free, but a MIDI file never carried voice count, instrument, or strategy history — only pitches and timing — and grouping notes back into bars gets fragile if the file was re-tempo'd or edited elsewhere first. This is really "seed a flow from an arbitrary chord progression," a distinct feature from session restore, and deserves its own design pass rather than riding along with the JSON file idea.

**A real `.eddy` file extension, not just `.json`:** the extension is decoupled from the content format, so this costs nothing beyond the export/import plumbing above — `a.download = 'flow.eddy'` on web, the same Filesystem+Share pattern as MIDI export on native. The real payoff is registering it as an actual iOS document type (`CFBundleDocumentTypes`/`UTExportedTypeDeclarations` in Info.plist, plus a small AppDelegate hook — Capacitor's `App` plugin already surfaces opened-file events to JS), so a `.eddy` file received via AirDrop/Mail/Messages offers "Open in Eddy" with its own icon in the Files app, rather than being an inert blob. Modest lift, distinctive payoff.

### Ambient/Generative Music — a second, additive use case
Paul's own experience using the app: looping playback, left running, is often enjoyable as a real piece of ambient music in its own right, not just compositional sketch material — closer to Endel or Eno's own ambient work than to a "meditation app" specifically (meditation apps carry expectations — guided narration, breathing cues, session timers — Eddy has none of that and isn't building toward it; positioning as one risks a real expectation mismatch). This doesn't require new features to be true — it's a second honest reading of what's already built.

Recommended treatment: keep "voice-leading tool for songwriters/composers" as the primary framing everywhere it currently lives (App Store name, subtitle, the opening of the description) — it's Eddy's deepest, most differentiated identity. Add the ambient-listening use case additively rather than replacing anything: a closing line in the App Store description, a keyword or two, maybe one line in the About modal's closing paragraph. Enrich the story, don't dilute the primary pitch by trying to be three things at once in a 30-character subtitle. Audio (WAV) export, the concrete feature this use case wanted, shipped 2026-09-29 — see CLAUDE.md's Architecture section (`src/utils/audioExport.ts`).

### "Humanize" Dial — Note Velocity Randomization
Requested (Paul, 2026-09-29), deliberately deferred past the current round — Paul's own words: "This one I'm less decided on." A second slider under Ambience, 0-100%, controlling how much random variation is applied to note velocity: 0% = a single flat velocity every note, 100% = wider random jitter than today's default.

The mechanism mostly already exists: `humanVelocity()` in `useAudioEngine.ts` already applies a *fixed* ±12% random jitter plus a small deterministic per-position taper (arpeggios trail off slightly, a musical shape, not randomness) to a base velocity of 0.72. The dial would just make that 12% a variable instead of a constant — cheap to build, low risk. Recommendation when this gets picked up: the dial should scale only the random jitter component, not the taper — 0% should mean "no randomness," not "flat and robotic," since the taper is a deliberate shape independent of humanization. Confirm this reading with Paul before building, since his own description ("0% = a single default note velocity") could also be read as wanting the taper gone too.

Real caveat, raised when this was discussed: unlike tempo/direction/grid/time-signature/ambience, this is more of a mixing-desk parameter than a musical-structure one — it doesn't change what notes play or when, only how consistently loud they are. Worth weighing against the app's instinct to keep the footer drawer from turning into a mixing console before committing to it for a given version.

### A Second, Plain Pad
Requested (Paul, 2026-09-27): a true/plain pad sample library alongside holdsworthian-pad, which is deliberately colored (overtones that don't strictly track the notes played — an intentional Allan Holdsworth-esque ambient character) rather than a neutral pad sound. Worth knowing before re-opening this search: a second pad candidate already went through the same real-sample-pack evaluation as holdsworthian-pad during the original instrument sourcing and didn't make the cut — see CLAUDE.md's V2/deferred section. Not a reason to skip revisiting it, since "a plain, neutral pad option" is a different design goal than what that earlier search was optimizing for, but worth knowing this isn't starting from zero, and worth checking whether a specific library is already in mind before repeating that search from scratch.

### YouTube Tutorial Video
A short (60–90 second) screen-recorded walkthrough — how to start a flow, hear a stream, add it, save it — linked (not embedded) from the About modal. Link-out costs nothing to add; embedding a video player in-app is real ongoing complexity for little extra benefit. Keep it exactly where the About modal already lives: opt-in, for people who go looking for help, not forced on first launch. Distinct from an App Store "preview video" (15–30 sec, must read fine muted, auto-loops) — a separate, optional asset with its own constraints, not a substitute for this.

---

## Medium-Term — The Big Leaps

### Eddy as a Live Performance Instrument
MIDI out. Every confirmed cluster fires a MIDI chord in real time into Ableton, Logic, any synth. The voice leading engine becomes a live harmonizer controller. Genuinely novel — no tool does this.

### Multi-User / Collaborative Sessions
Two people, same flow, different voices. V1/V2 are yours, V3/V4 are mine. The harmony is negotiated in real time, not composed. Musical conversation with no theory required.

### Eddy as Accompaniment / Harmonizer
You sing or play a melody. Eddy detects the pitch, assigns your note to a voice, generates the others via voice leading. Your melody becomes the top voice. Eddy harmonizes beneath you in real time.

### The "River" View
A full visual of the flow as a flowing stream — each voice a colored line weaving through time, intervals between them visible as the space between lines. Not a score, not a piano roll — something new. Exportable as video art alongside the audio.

### Emotional Arc Mapping
Each cluster gets a tension score (dissonanceRank already exists). The flow becomes a tension curve over time. User draws an arc — tense peak, then release — and Eddy steers voice movement toward it. Narrative shape without naming a single chord.

---

## Lateral / Outside the Box

### Eddy as Compositional Memory
Every session ever created, indexed. Over time Eddy recognizes tendencies — which strategies you keep, which you skip, which clusters you favor. Personalized drift suggestions from your own musical fingerprint. Pattern recognition, not AI hype.

### Scored Output / Generative Sheet Music
Not a MIDI file — rendered notation. Each voice on its own staff, formatted as string quartet or SATB. Export as PDF. Composers use Eddy as a sketch tool that produces readable scores.

### Eddy for Film / Game Scoring
"Mood lock" mode — constrain the flow within a tension band. Tense scene: keep dissonance high. Resolution: drift toward consonance. Composer sets emotional boundaries, Eddy navigates within them. Procedural underscore without a theory degree.

### Physical / Hardware Version
Four physical knobs or sliders, one per voice. Strategy card on a small screen. Eddy as a hardware instrument on a desk next to a synth. Very Teenage Engineering territory.

### Tuning System Exploration
Voices move in just intonation, quarter-tones, 19-TET instead of equal temperament. Eddy becomes a microtonal harmony tool using the same drift mechanic — no theory required, just ear and movement.

### Eddy as a Teaching Tool
"Why did that work?" mode — after confirming a cluster, Eddy shows what interval relationship changed and why it sounds the way it does. Theory revealed as a consequence of playing, not a prerequisite.

---

---

## Native Mobile Build (Capacitor / iOS)

### Status
Capacitor is already installed (`@capacitor/core`, `@capacitor/app`, `@capacitor/haptics`, `@capacitor/keyboard`, `@capacitor/status-bar`). Not yet activated — no iOS platform added yet. Xcode build required on iMac.

### Requirements
- Apple Developer Account ($99/year) — needed for device install and eventual App Store release
- Xcode on iMac — Capacitor iOS builds require Xcode on macOS

### Build Steps (when ready)
1. `npx cap add ios` — adds the iOS platform
2. `npm run build` — builds the web app
3. `npx cap sync` — copies web build into Xcode project
4. Open in Xcode: `npx cap open ios`
5. Select device, build and run

### Share / Export (native)
Add `@capacitor/share` plugin. Wire up MIDI and text export buttons to the native iOS share sheet (AirDrop, Messages, Mail, Files, Notes, etc.). This replaces the current browser `navigator.clipboard` and file download approach.

### UI Pass for Mobile
- Safe area insets (notch, home indicator, status bar)
- Touch target audit — some buttons may be tight for thumbs
- IonPicker for note selection (drum-roll style) — revisit when doing native build
- Platform-adaptive UI: Ionic handles most of this, targeted pass needed

### Sample Bundling (before App Store release)
Currently all samples (piano, harp, guitars) load from external CDNs. For App Store submission, bundle samples locally inside the app for reliability and offline use. Larger binary but fully self-contained — required for a robust public release.

### Privacy
Eddy stores nothing remotely, no accounts, no tracking. Privacy policy is a one-pager. Clean App Store story.

### Scope
iOS only for personal use first. Android is `npx cap add android` when ready — same codebase, targeted UI pass for Android patterns.

---

## The Largest Vision

Eddy as the **pencil sketch tool of harmonic composition** — the thing you reach for before opening a DAW. Fast, intuitive, no theory gatekeeping. The way GarageBand democratized recording, Eddy could democratize harmony.

The tagline already says it: *"let the music move itself."* That's not just a feature — it's a worldview about how music gets made.
