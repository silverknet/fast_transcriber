Rubber Band CLI binaries live here for packaged builds.

Expected layout:

- `darwin-arm64/rubberband`
- `darwin-x64/rubberband`
- `linux-x64/rubberband`
- `linux-arm64/rubberband`
- `win32-x64/rubberband.exe`

Only add binaries covered by Rubber Band commercial licensing for BarBro.
Do not check in a GPL Rubber Band build for proprietary distribution.

For local development before the licensed bundle is present, set
`BARBRO_RUBBERBAND=/absolute/path/to/rubberband`, or install `rubberband`
on `PATH`. The packaged app does not use the `PATH` fallback.
