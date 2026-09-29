# Eddy — Downriver

Ideas, possibilities, and future directions. Added to as inspiration strikes. No commitment to timeline or order — just the vision.

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
