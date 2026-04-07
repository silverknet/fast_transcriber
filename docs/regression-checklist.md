# Migration Regression Checklist

Run this checklist after each migration phase.

## Home / Upload
- Upload MP3/WAV file.
- Waveform renders and no decode error is shown.

## Playback
- Play starts from current cursor.
- Pause resumes from same time.
- Stop returns to selection start.
- Top and minimap playheads move consistently.

## Selection
- Click seeks.
- Drag outside selection creates selection.
- Drag selection body moves selection.
- Drag left/right handles resizes selection.

## Minimap / Viewport
- Drag viewport body moves window.
- Drag viewport left/right handles resizes window.
- Click outside viewport recenters.
- Selection remains unchanged while viewport changes.

## Use Song
- Use song trims selected range.
- Edit screen opens with trimmed file metadata.
