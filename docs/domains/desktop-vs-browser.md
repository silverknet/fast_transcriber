# Desktop vs Browser — the capability split

BarBro runs in **two modes**, decided at runtime by whether the desktop sidecar
is reachable (`desktopCompanionStatus.reachable`, surfaced as
[`appMode`](../../src/lib/stores/appMode.ts) = `'studio' | 'collab'`):

- **Studio mode** (`studio`) — the Electron sidecar is running. Full features +
  the **local HD audio master**. This is the creator's environment.
- **Collab mode** (`collab`) — no sidecar (a collaborator on a shared link, or
  Safari / any HTTPS deployment, which can't reach the loopback sidecar at all).
  A **consumer/collaborator** environment: play + edit + collaborate on
  **compressed cloud audio**, no local files, no heavy compute.

(User-facing labels live in `MODE_LABEL` / `MODE_TAGLINE` in `appMode.ts` —
rename in that one place.)

Both coexist. A creator analyses on desktop; a bandmate opens the same shared
project in a browser. It is NOT a migration.

## The split (what works where)

| Capability | Desktop | Browser |
|---|:---:|:---:|
| Open / join a shared cloud project | ✅ (local folder) | ✅ (in-memory + IndexedDB) |
| Play the mix (grid) | ✅ HD master | ✅ cloud AAC |
| Multi-track mixer (stems) | ✅ HD stems | ✅ cloud AAC stems |
| Edit + live-collab: chords, sections, drafts, lyric text | ✅ | ✅ |
| Transpose, count-in, cue text, playback | ✅ | ✅ |
| **Analyze** (beat grid) | ✅ | ❌ needs desktop |
| **Separate stems** (Demucs) | ✅ | ❌ needs desktop |
| **Transcribe / Fit lyrics** (Whisper) | ✅ | ❌ needs desktop |
| **TTS cue speech** (Piper) | ✅ | ❌ needs desktop |
| **YouTube import** | ✅ | ❌ needs desktop |
| Open a local project **folder** | ✅ | ❌ (cloud projects only) |
| Produce/upload the compressed cloud audio | ✅ (sidecar ffmpeg) | — |
| `.als` / setlist export | ✅ to disk | ⏳ later (browser download) |

Everything a **consumer** needs — data sync, playback, mixer, chord/section
editing, live collab — runs with **zero sidecar**. Everything gated to desktop is
heavy native/Python compute or local-filesystem access.

## Exactly two modes — the guarantee + every transition

There are **only two modes**, and **one signal** chooses between them:
`desktopCompanionStatus.reachable` → `appMode` (`'studio' | 'collab'`). Nothing
else. Everything below is a consequence:

| | **Studio** (`reachable`) | **Collab** (`!reachable`) |
|---|---|---|
| Project source | local folder on disk (via sidecar) | cloud project in memory + IndexedDB (no folder) |
| Audio | local HD master | compressed cloud AAC |
| Sidecar features | on | gated ("needs Studio mode") |
| `.smap` sync | yes | yes |
| Open a local folder | yes | **no** (needs the sidecar) |

**The load-bearing invariant: a local folder is usable ONLY in Studio.** You can
only *open* one with the sidecar up, so "local folder + no sidecar" is never a
starting state — it can only arise if the sidecar *drops mid-session*, which is
a **degraded Studio**, handled explicitly (below), not a third mode.

### Transitions (all defined)
- **Fresh load, sidecar down** → Collab. Restoring the last local folder needs
  the sidecar and fails gracefully (`tryRestoreLastProject` returns null), so you
  land on the Collab landing (cloud project list). Open a project with **"Open."**
- **Fresh load, sidecar up** → Studio. Restores/opens the local folder as before.
- **Sidecar drops mid-Studio-session** (local project open) → the badge flips to
  **Collab** and a **"Studio disconnected"** banner appears. Audio already decoded
  into memory keeps playing; anything needing the sidecar (switch song, reload
  stems, analyze, disk autosave) is unavailable. The banner offers **Reconnect**
  and, if the project is cloud-linked, **Open the cloud copy** (→ true Collab).
  This is the ONLY way to reach "local folder + no sidecar", and it is never a
  silent break.
- **Sidecar comes up mid-Collab-session** (cloud project open) → stays Collab for
  that project (it has no local files to analyse); offers **"Add to this
  computer"** to get a local copy and full Studio features.

So: two modes, chosen by the sidecar; the only in-between (local folder without a
sidecar) is a clearly-signposted degraded Studio, never a usable third mode.

## Non-negotiable rule 1 — audio fidelity failsafe

The local HD master must **always** win when the desktop client is connected; the
lossy cloud copy must be **unreachable** in that state. One authority makes the
decision — [`resolveAudioSource`](../../src/lib/audio/resolveAudioSource.ts) — and
it is the ONLY place "which audio" is decided:

1. **Desktop reachable + local master resolves** → the **local WAV**. The cloud
   fetch throws (`assertCloudAudioAccessAllowed`) and the IndexedDB AAC cache is
   not even read.
2. **Desktop reachable + local file missing** → the relink banner. **Never** a
   silent downgrade to the cloud copy.
3. **Browser mode only** → the compressed cloud AAC (+ IndexedDB cache).

Enforcement: cloud-audio download/decode entry points call
`assertCloudAudioAccessAllowed(reachable)` (throws on desktop); a test invariant
(`resolveAudioSource.test.ts`) asserts desktop mode never yields `cloud`; the AAC
carries the source WAV's sha so a mismatch is detectable.

## Non-negotiable rule 2 — the mode is always visible

The navbar's desktop symbol (the Monitor icon in
[`AppMenuBar.svelte`](../../src/lib/components/AppMenuBar.svelte)) is a labelled
**mode badge**: **"Desktop · HD"** (emerald) vs **"Browser · cloud"** (amber),
with a tooltip naming the audio in use and what each mode can/can't do. It is the
at-a-glance answer to "which mode am I in and what am I hearing".

## Audio format

Cloud audio is **AAC/m4a ~128 kbps** — decodes natively in every browser
including Safari; ~4–6 MB per 4-min song (mix) vs ~40 MB WAV; stems add ~5×,
lazy-loaded on mixer open and cached in IndexedDB by sha. Creators keep the WAV
master locally; the cloud copy is a **playback proxy, not the master**.

## How it's wired (pointers)

- Mode signal: `desktopCompanionStatus.reachable` → `appMode`.
- Audio decision: `resolveAudioSource` (+ `assertCloudAudioAccessAllowed`).
- Cloud audio I/O: `src/lib/client/cloudAudio.ts` (upload/download/IndexedDB).
- Storage abstraction: `ProjectStore` → `SidecarProjectStore` (existing
  `desktopProjectFs`) vs `CloudProjectStore` (cloud + IndexedDB).
- Gating: sidecar-only actions check `reachable` and degrade to a "needs the
  desktop app" affordance rather than a broken button.

See [desktop-sidecar.md](desktop-sidecar.md) for the sidecar endpoints and
[cloud-auth-sync.md](cloud-auth-sync.md) for the sync layer.
