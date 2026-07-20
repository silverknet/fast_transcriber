# Sample provenance — Acoustic kit

All five one-shots are from the **Versilian Community Sample Library
(VCSL)**, dedicated to the public domain under **CC0 1.0 Universal**.

- Source repository: https://github.com/sgossner/VCSL (curated by Sam
  Gossner / Versilian Studios; see its `LICENSE` for the CC0 text)
- Retrieved: 2026-07-12, from the `master` branch via
  `raw.githubusercontent.com`
- Processing (same for all): downmix to mono, DC removal, trim to ~5 ms
  before the hit with a 2 ms fade-in, cosine fade-out, peak normalized to
  −6 dBFS, 44.1 kHz 16-bit PCM.

| File | VCSL source file | Extra processing |
|------|------------------|------------------|
| `kick.wav` | `Membranophones/Struck Membranophones/Bass Drum 2/bassdrum_hit_ff.wav` | gated: exponential decay (τ 90 ms) from 60 ms, cut at 0.42 s — tightens the concert bass drum into a kit kick |
| `snare.wav` | `Membranophones/Struck Membranophones/Snare Drum, Modern 1/Snare2_HitSN_v9_rr1_Mid.wav` | cut at 0.60 s |
| `hihat.wav` | `Idiophones/Struck Idiophones/Hi-Hat Cymbal/HiHat_HitC_v3_rr1_Mid.wav` | cut at 0.45 s |
| `tom.wav` | `Membranophones/Struck Membranophones/Tom 1/Stick/TomH_HitS_v4_rr1_Mid.wav` | cut at 1.00 s |
| `cymbal.wav` | `Idiophones/Struck Idiophones/Suspended Cymbal 1/susCymb1_hit_stick_f1.wav` | cut at 2.20 s with a 0.4 s fade |
