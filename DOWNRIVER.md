# Eddy — Downriver

Ideas, possibilities, and future directions. Added to as inspiration strikes. No commitment to timeline or order — just the vision.

---

## Playback dropout diagnosis — real fix shipped (2026-10-05), awaiting on-device confirmation

Paul's explicit priority call: understand and fix the real-device playback dropout issues
before any other feature work. Build 1.0(11) shipped `src/utils/diagLog.ts` (on-device
diagnostic log, exportable via AboutModal.vue's "export diagnostics" button); Paul sent
the first real exported log the same day, from a genuine repro (loop playing, screen
locked, came back to total silence — "nothing sounds when I tap a stream or click the
play button").

**Root cause found from that log, not guessed**: a hard stop landed while the audio
context was still mid-recovery from the backgrounding interruption (confirmed not yet
`running` at that moment). `stopLoop(true)`'s mute-restore step was a *second*
audio-clock-scheduled event 15ms after the mute — if the clock itself is unstable right
when that gets scheduled, the restore can silently never fire, leaving the instrument's
volume parameter permanently at `-Infinity` while everything else in the engine (UI,
buttons, the rAF loop) keeps working normally. That matches the symptom exactly.

**Fixed**: the restore now runs on a plain JS `setTimeout`, independent of the audio
clock, via a new `resetInstrumentVolume()` safety net also wired into both resume-success
paths (`App.addListener('resume', ...)`, `tick()`'s own recovery). Also fixed in the same
pass: the restore was targeting a hardcoded `0` instead of the instrument's actual
`INSTRUMENT_VOLUME` trim (a separate bug — any hard stop, not just during an
interruption, was quietly flattening e.g. `holdsworthian-pad`'s +12dB to unity gain), and
`tick()`'s recovery no longer gives up permanently after one failed `Tone.start()` — the
log showed it failing once (`InvalidStateError`, still backgrounded) and never trying
again even after the real resume succeeded moments later. It now retries every ~500ms
until it succeeds or playback is explicitly stopped.

**Round 2 (same day, build 1.0(12))**: Paul sent a second export. First ~8 lines were
byte-identical to the first report — stale, not a recurrence (the log persists across app
restarts by design and had no "clear" affordance, so it was silently accumulating across
test sessions; added a "clear log" button in AboutModal.vue to fix that going forward).
The genuinely new data revealed a worse problem than the one just fixed: **three resume
events in a row never produced a success or failure log at all** before the next pause —
`Tone.start()` (really `AudioContext.resume()`) can apparently hang indefinitely after
repeated background/foreground cycling, neither resolving nor rejecting. Every recovery
path (app resume handler, `playCluster`/`playSequence`/`tick`'s guards) was gated on that
promise settling, so a hang silently defeated all of them — including the retry logic
from round 1, which only runs from a `.catch()` that a hung promise never reaches.

**Fixed**: `startToneWithTimeout()` races every `Tone.start()` call against a 2s timeout,
so a hang is now treated as a failure and retried the same as an explicit rejection,
wired into all four call sites. The section of the same log from *after* this class of
fix would apply (`tick` failing once with `InvalidStateError` then succeeding on its own
~500ms retry, fully automatic, no user action needed) confirms round 1's retry-loop fix
works correctly when `Tone.start()` does settle — the timeout fix specifically targets the
case where it doesn't.

**Still not confirmed on a real device** — same caveat as round 1, diagnosed from logs,
not reproduced locally. The `startToneWithTimeout()` fix shipped as build 1.0(12), but
Paul had already independently archived/installed a build 13 outside this chat's
visibility (App Store Connect requires strictly increasing build numbers regardless), so
the actual one carrying this fix to his phone is **build 1.0(14)** — bumped twice in a row
near end of session purely to dodge that conflict, not for any code reason. Next session:
did 1.0(14)'s fixes hold? Clear the log before a fresh test session now that there's a
button for it, so the next export is unambiguous. Picking up a *new* exported log is a
clean place for a fresh chat to start — this file plus CLAUDE.md should be enough context,
no need to replay this whole thread.

**A lead worth checking, not yet investigated**: Paul's own recollection (2026-10-06) is
that dropouts have gotten noticeably *more frequent* recently — not something he remembers
happening this often before — which points at the last 3-4 builds specifically rather than
treating this as a constant, platform-level iOS quirk Eddy has always been equally exposed
to. Worth correlating against what actually shipped in that window rather than assuming:
roughly builds 1.0(9)-1.0(12) added loop-range select (a second `playSequence()` call
shape via `playbackSequence`), live tempo ramping (`setTempoLive()` manipulating
`Transport.bpm` directly, new territory — nothing else in the engine touches Transport
state live like that), the synth-pad/retro-pad instrument churn, and the diagnostic
logging itself. None of these obviously touch the AudioContext/interruption-recovery path
this session's fixes targeted, but "worth checking" isn't "ruled out" — a real
correlation (e.g. `git log` timestamps on these commits vs. when Paul started noticing it
more) would be a stronger basis than either of us guessing. Could also be a pure usage-
frequency confound (more active testing this week = more chances to notice it, not
necessarily a higher underlying rate) — worth keeping both hypotheses live rather than
anchoring on the code-regression one just because it's the more actionable-feeling story.

**Round 3 (2026-10-06): two real bugs found directly in round 1/2's own recovery code,
from a fresh on-device log plus Paul's own clue** — "when I wake the phone, the loop has
stopped but the play button is still toggled on." That's `isPlaying` stuck `true` with
nothing audible, which `tick()`'s self-healing retry loop (added in round 1) can cause
directly: it only gates on the shared `isPlaying` boolean and never gives up, so if
`Tone.start()` keeps failing it just retries every ~500ms forever. Real-world cause
confirmed from the log: the context lands in WebKit's `'interrupted'` state (distinct from
`'suspended'`, iOS's name for an OS-level audio-session interruption), and `resume()` calls
made from non-gesture code (a `setTimeout`/`rAF` callback, which every recovery path here
is) can apparently never clear that state — only a real user tap can. So the retry loop
wasn't broken, it was doing exactly what it was told, forever, against a lock it could
never pick. **Fixed**: a 20s wall-clock cap on continuous recovery failure — past it, give
up explicitly (`stopLoop()`, logged as `tick.recovery.gaveUp`) so `isPlaying` honestly
flips to `false` and the play button stops lying. The user's next tap is a real gesture,
which is what can actually unstick WebKit.

Second bug, same session, found by code review rather than the log directly: no
session/generation token existed anywhere in this retry machinery — only the single shared
`isPlaying` ref. If playback stopped and restarted (any structural-setting change, or the
user manually recovering) while an old retry chain from a *previous* `tick()` closure was
still mid-backoff, that stale closure could later win a race for the shared `rafId`
variable against the new, legitimate loop — `stopLoop()` only ever cancels whichever
`rafId` is currently assigned, orphaning the other. This is a plausible second contributor
to "continuous loop sometimes drops out" independent of any sleep/wake event. **Fixed**: a
`playbackGeneration` counter, bumped by every `stopLoop()` and minted fresh by every
`playSequence()` call; every retry closure checks it before touching `rafId` again, so a
stale chain is structurally inert instead of relying on `isPlaying` as the only guard.

Both fixes shipped as build 1.0(15). **Confirmed not sufficient** — Paul's build 1.0(15)
log (same day) still showed the stuck-button symptom, with a real anomaly: zero `tick.*`
log lines anywhere in that session despite a loop reportedly dying mid-playback, and every
single `app.pause` entry showed `isPlaying:false` (never `true`) — meaning playback had
already stopped by the time the phone actually locked, not as a sleep/wake recovery
failure. Not yet root-caused; see the Simulator and architecture discussion below for what
got investigated instead while that anomaly sat unresolved.

**Confirmed real-device-only**: Paul reproduced the exact repro steps (lock during loop
playback) in the iOS Simulator and got clean recovery — audio paused, resumed seamlessly on
wake, button never stuck. Root cause: the Simulator runs on the Mac's own CoreAudio stack
and only fakes the `pause`/`resume` *lifecycle* events; it never generates a genuine
AVAudioSession interruption, so the WebAudio context likely never actually lands in
WebKit's `'interrupted'` state at all (the one state present in every real-device log).
This bug class cannot be validated in the Simulator — real-device testing is the only
option, no shortcut available.

**Architecture question raised (2026-10-06)**: would a fully-native (AVAudioEngine, no
Capacitor/WKWebView) rewrite avoid this entirely? Likely yes in kind — native
`AVAudioSession.interruptionNotification` is a mature, synchronous, officially-documented
recovery path, versus WebAudio-in-WKWebView's `resume()` hanging/failing indefinitely from
non-gesture code, which is the specific quirk every round of this bug has been fighting.
But checked `Info.plist` directly first: Eddy declares **no background audio capability**
(`UIBackgroundModes` → `audio`) at all, which means the entire WKWebView process — not just
audio, the whole JS engine, including anything that would recover it — gets frozen by iOS
the instant the screen locks. That's arguably the real root mechanism behind every dropout
in this whole investigation: every fix so far has been about recovering gracefully *after*
the freeze; none has tried preventing the freeze. Adding that capability is a cheap,
one-line `Info.plist` change + Xcode toggle — **queued as a to-do, not yet done** — versus
a full native rewrite, which would be the same scope of effort as the already-parked AU/VST
plugin idea (re-implementing Transport/Part/scheduling from scratch). Try the background
capability first; treat the full rewrite as the fallback if that doesn't hold up on-device.

**Loop-range / live-tempo-ramping hypothesis (2026-10-06)**: Paul suspected the loop-range
feature (shipped build 1.0(9), commit `5b3e898`, 2026-10-01) introduced this bug class.
Checked the actual diff directly: loop-range itself added **zero** code to
`useAudioEngine.ts` — it's pure UI-layer slicing (`SequenceHistory.vue`/`SessionView.vue`)
that hands a shorter array to the exact same `playSequence()`/`tick()` every full-flow loop
has always used. The one genuinely new thing that commit *did* add to the engine is
`setTempoLive()` — live `Transport.bpm` ramping mid-playback, the first and only code that
touches live Transport state outside a full stop/restart. Build 1.0(16) ships a diagnostic
toggle (`DISABLE_LIVE_TEMPO_RAMP` in `SessionView.vue`, default `true` for this test)
routing tempo changes through the normal stop/restart path instead of the live ramp, to
test whether live tempo ramping specifically is implicated. Caveat: `diagLog.ts` didn't
ship until build 1.0(11), four days after loop-range/live-tempo landed at 1.0(9) — there's
no instrumented before/after for this question, only Paul's recollection, which could also
just be a usage-frequency confound (noted two rounds ago, still live). **Flip
`DISABLE_LIVE_TEMPO_RAMP` back to `false` once this build's test concludes.**

---

## Open Discussion — Handoff (2026-10-01, round 2)

The previous four-topic handoff below is fully resolved and shipped (loop-range select,
live tempo ramping, two-column streams, simplified drift card — see commits `5b3e898` /
`6e624e7`, build 1.0(9)). Paul listed four new items before stepping away for a session
break — **not started, just queued**. Pick up here.

### 1. Scheduling fix for real-time structural updates — tried, reverted (2026-10-05)
Tempo is still solved — `setTempoLive()` in `useAudioEngine.ts` ramps `Transport.bpm` live,
no restart, unaffected by this entry. Direction/subdivision/latch/time-signature are back
to the plain pre-existing `stopLoop(true)` + restart-from-cluster-0, same as before any of
this round's work — **deliberately reverted**, not an oversight.

**What was tried**: a bar-boundary continuation — wait for the current bar to finish, then
continue into the *next* cluster under the new setting (no restart, no jump back to
cluster 0; the loop re-anchors to wherever playback was, via a `startIndex`/rotation param
added to `playSequence()`). Paul explicitly chose this position-preserving design over the
narrower "just delay the existing restart" option when scoped. Built, and a real bug was
found and fixed along the way (the boundary handoff was missing the hard-mute step the
original restart always had, causing audible overlap with old ringing notes).

**Why it was reverted anyway**: diagnosed with a throwaway Playwright script (driving the
real app in headless Chromium, capturing `console.log` traces of the actual
`Tone.Transport`/scheduling timing — not guessed) rather than guessing blind. The trace
proved the mechanism was working *exactly* as designed — correct boundary timing, correct
rotation math, correct mute-then-rebuild sequencing. The problem was the design itself, not
a bug: waiting for the current bar to finish before a change becomes audible means up to a
full bar's delay (in the traced repro, ~2 seconds) between tapping a direction button and
hearing anything change. That reads as "did this even work?" / "the old direction is stuck"
rather than "waiting for a natural pause" — a genuinely worse experience than the original
abrupt-but-immediate restart, not a better one. Confirmed by Paul's own real-device testing
after the mute fix landed — still "clunky," for this latency reason, not an audio-quality one.

**If revisited later**: the actual hard problem isn't audio-splice quality (that part works)
— it's that *any* scheduling fix which waits for a bar boundary trades an audio glitch for
input latency, and the latency may just be the worse tradeoff for how Eddy is actually used
(tweaking live, expecting to hear the result immediately). A genuinely different approach —
applying a change close to instantly while still avoiding a glitch, e.g. by crossfading
between old and new schedules rather than stop/mute/rebuild — would be a bigger rethink, not
a tweak. Also still true from the original analysis: the same content-changes-while-playing
problem exists for sequence edits, not just settings — `editCluster()`, `confirmSelection()`,
`deleteCluster()`, `reorderClusters()`, and loop-range marker taps all hard-stop outright
rather than live-patch — that's an intentional, separate, already-settled choice (Paul's own
call for the loop-range case), not something this entry's revert touches.

### 2. Synthesized pad instrument — resolved, superseded by a sampled one (2026-10-05)
A from-scratch Tone.js synth pad (`PolySynth` + effects chain) was built and went through
two full reworks chasing "lush/calming" — never fully landed by ear even after the second
rework. In parallel, Paul recorded his own Logic RetroSynth patch note-by-note (MIDI-
triggered, fixed velocity, 12 roots every major third E2–C6) and had it wired up as a
sample-based alternative (`retro-pad`) for an A/B listen. It won decisively ("sounds so
much better than the ambient synth") — the live-synthesis attempt was removed entirely
(not kept as a second option) and `retro-pad` is now the shipped second pad, alongside
the original `holdsworthian-pad`, not a replacement of it. Still pending before a real
release: the raw 8s WAV bounces need the same trim/fade/gain-match production pass every
other instrument in this project went through (currently just a +3dB `INSTRUMENT_VOLUME`
bump, per Paul's "a tad louder" — not yet RMS-measured or converted to MP3 like the rest).

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

### 4. Latch mode on by default? — resolved, shipped (2026-10-05)
Flipped `settingsStore.ts`'s `latchMode` default to `true` — a cluster playing once and
resting through most of the bar read as sparse before a new user finds the playback tray.
Only affects users without a saved default of their own (`saveAsDefault()` already means a
saved preference always wins). Confirmed `buildClusterEvents()` reshuffles `'random'`
direction fresh on every repeat rather than looping the same pattern, so latch doesn't
undercut that direction's character either.

### 5. Should exports respect an active loop range? — resolved, shipped (2026-10-05)
Resolved without picking a fixed default either way: `requestExport()` in `SessionView.vue`
now prompts ("this loop" / "whole flow") whenever a loop range is active at export time —
MIDI, WAV, and copy-text all go through it. No range active, no prompt — export proceeds
exactly as before, zero extra taps. The three export functions take the sequence to export
as a parameter instead of reading `sequenceStore.sequence` directly, so there's one place
deciding scope rather than three call sites each guessing.

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

### Native iOS rewrite (SwiftUI, AVFoundation) — discussed, not planned
Paul asked out of curiosity (2026-10-04), not as a direction he's pursuing. Core take: the
voice-leading engine (`useVoiceLeading.ts`/`strategies.ts`/`scales.ts`/`noteUtils.ts`/
`arpeggioEngine.ts`) is already Tone.js/DOM-free and would port nearly 1:1 — the UI layer
and the audio engine would both be full rebuilds, the audio engine being the harder half
(Tone.js's Transport/Part scheduling model has no AVFoundation equivalent; every
bar-quantized/live-tempo/humanization behavior tuned this session would need
re-architecting on `AVAudioEngine`). Real upside beyond "feels more native": eliminates
the whole class of Capacitor/WKWebView-specific bugs this project has accumulated, and is
the same prerequisite the AUv3-plugin-in-Logic idea already needs (see the session
2026-09-27 memory note / earlier DOWNRIVER discussion). Recommendation: not worth it now
or even at real scale unless a specific trigger shows up (provable WebView-audio-stack
latency ceiling, the AUv3 plugin becoming a real priority, or native "feel" becoming a
genuine competitive edge) — the current architecture's clean logic/UI separation is
already quietly paying rent toward this being a safe *later* option, so it's worth
protecting that boundary as the app grows rather than acting on this now.
