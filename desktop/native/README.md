# Reserved for native helpers

Future home for Rust binaries, `tauri`-style crates, or vendored analysis binaries — **keep separate** from `electron/` unless you deliberately integrate.

`bin/rubberband/` is reserved for Rubber Band CLI binaries used by high-quality
tempo-preserving audio transposition. Only commercially licensed Rubber Band
binaries should be bundled for BarBro distribution; development may use
`BARBRO_RUBBERBAND` or a local `rubberband` on `PATH`.
