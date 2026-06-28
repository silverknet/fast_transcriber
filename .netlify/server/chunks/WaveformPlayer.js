import { r as onDestroy } from "./index-server.js";
import { M as derived$1, a as derived, f as spread_props, i as bind_props } from "./server.js";
import "./index-server2.js";
import "./button.js";
import { t as Icon } from "./Icon.js";
import { V as sortBeatsByTime } from "./commit.js";
import { t as songPlaybackPlan } from "./playbackPlan.js";
import { n as uiAnimations } from "./uiAnimations.js";
//#region node_modules/@lucide/svelte/dist/icons/music.svelte
function Music($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		/**
		* @license @lucide/svelte v1.7.0 - ISC
		*
		* ISC License
		*
		* Copyright (c) 2026 Lucide Icons and Contributors
		*
		* Permission to use, copy, modify, and/or distribute this software for any
		* purpose with or without fee is hereby granted, provided that the above
		* copyright notice and this permission notice appear in all copies.
		*
		* THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
		* WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
		* MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
		* ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
		* WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
		* ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
		* OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
		*
		* ---
		*
		* The following Lucide icons are derived from the Feather project:
		*
		* airplay, alert-circle, alert-octagon, alert-triangle, aperture, arrow-down-circle, arrow-down-left, arrow-down-right, arrow-down, arrow-left-circle, arrow-left, arrow-right-circle, arrow-right, arrow-up-circle, arrow-up-left, arrow-up-right, arrow-up, at-sign, calendar, cast, check, chevron-down, chevron-left, chevron-right, chevron-up, chevrons-down, chevrons-left, chevrons-right, chevrons-up, circle, clipboard, clock, code, columns, command, compass, corner-down-left, corner-down-right, corner-left-down, corner-left-up, corner-right-down, corner-right-up, corner-up-left, corner-up-right, crosshair, database, divide-circle, divide-square, dollar-sign, download, external-link, feather, frown, hash, headphones, help-circle, info, italic, key, layout, life-buoy, link-2, link, loader, lock, log-in, log-out, maximize, meh, minimize, minimize-2, minus-circle, minus-square, minus, monitor, moon, more-horizontal, more-vertical, move, music, navigation-2, navigation, octagon, pause-circle, percent, plus-circle, plus-square, plus, power, radio, rss, search, server, share, shopping-bag, sidebar, smartphone, smile, square, table-2, tablet, target, terminal, trash-2, trash, triangle, tv, type, upload, x-circle, x-octagon, x-square, x, zoom-in, zoom-out
		*
		* The MIT License (MIT) (for the icons listed above)
		*
		* Copyright (c) 2013-present Cole Bemis
		*
		* Permission is hereby granted, free of charge, to any person obtaining a copy
		* of this software and associated documentation files (the "Software"), to deal
		* in the Software without restriction, including without limitation the rights
		* to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
		* copies of the Software, and to permit persons to whom the Software is
		* furnished to do so, subject to the following conditions:
		*
		* The above copyright notice and this permission notice shall be included in all
		* copies or substantial portions of the Software.
		*
		* THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
		* IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
		* FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
		* AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
		* LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
		* OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
		* SOFTWARE.
		*
		*/
		let { $$slots, $$events, ...props } = $$props;
		Icon($$renderer, spread_props([
			{ name: "music" },
			props,
			{
				iconNode: [
					["path", { "d": "M9 18V5l12-2v13" }],
					["circle", {
						"cx": "6",
						"cy": "18",
						"r": "3"
					}],
					["circle", {
						"cx": "18",
						"cy": "16",
						"r": "3"
					}]
				],
				children: ($$renderer) => {
					props.children?.($$renderer);
					$$renderer.push(`<!---->`);
				},
				$$slots: { default: true }
			}
		]));
	});
}
//#endregion
//#region src/lib/audio/debugClickTrack.ts
/**
* One-shot metronome click for the PlaybackController and any future
* Web-Audio-scheduled cue paths. Accent = downbeat (bar 1), softer =
* other beats.
*/
function playMetronomeClick(ctx, destination, startTime, downbeat) {
	const osc = ctx.createOscillator();
	const g = ctx.createGain();
	osc.type = "sine";
	const freq = downbeat ? 1040 : 720;
	const dur = downbeat ? .055 : .042;
	const peak = downbeat ? .62 : .34;
	osc.frequency.setValueAtTime(freq, startTime);
	g.gain.setValueAtTime(0, startTime);
	g.gain.linearRampToValueAtTime(peak, startTime + .0025);
	g.gain.exponentialRampToValueAtTime(8e-4, startTime + dur);
	osc.connect(g);
	g.connect(destination);
	osc.start(startTime);
	osc.stop(startTime + dur + .012);
}
//#endregion
//#region src/lib/audio/playbackController.svelte.ts
var END_EPS = .028;
var CLICK_LOOKAHEAD_SEC = .025;
var CLICK_SCHEDULE_LEAD_SEC = .002;
var CLICK_PAST_GRACE_SEC = .018;
var PLAY_START_LOOKAHEAD_SEC = .04;
var PlaybackController = class {
	songMap = null;
	/**
	* Decoded audio (PCM). REQUIRED for playback. Hosts already decode
	* this for waveform peaks; they pass it via `setAudioBuffer()`.
	*/
	audioBuffer = null;
	/**
	* Back-compat binding only. The controller does NOT use the audio
	* element for playback in the buffer-based model — playback flows
	* through `audioBuffer` + Web Audio. Hosts may still bind it for
	* blob-URL lifetime or other UI concerns.
	*/
	audioEl = null;
	/** Playback selection (auto-stop when currentTime >= rangeEnd). */
	rangeStart = 0;
	rangeEnd = 0;
	/**
	* Per-surface time-base offset that translates
	*
	*   `planTime = position − mediaTimeOffsetSec`
	*
	* where `position` is in audio-buffer time (i.e. seconds into the
	* decoded buffer; 0 = start of file). `plan.clickPoints[].timeSec`
	* is trim-shifted song-time (0 = `audio.trim.startSec`), so the
	* grid editor uses `offset = plan.trimStartSec` and the buffer's
	* `0` corresponds to original-time 0.
	*/
	mediaTimeOffsetSec = 0;
	playWithClick = false;
	clickVolume = 1.5;
	songVolume = 1;
	/**
	* Per-system fine-tune. Positive = clicks fire LATER; negative =
	* earlier. With buffer-based playback both audio and clicks share
	* ONE output latency, so 0 should be perfect on any hardware. The
	* slider stays as an escape hatch for unusual chains (BT, USB).
	*/
	clickOffsetSec = 0;
	debugClickTiming = false;
	#debugLogBudget = 0;
	isPlaying = false;
	currentTime = 0;
	#mediaReady = derived(() => this.audioBuffer !== null && this.audioBuffer.duration > 0);
	get mediaReady() {
		return this.#mediaReady();
	}
	set mediaReady($$value) {
		return this.#mediaReady($$value);
	}
	#plan = derived(() => this.songMap ? songPlaybackPlan(this.songMap) : null);
	get plan() {
		return this.#plan();
	}
	set plan($$value) {
		return this.#plan($$value);
	}
	#clampedSongVolume = derived(() => Math.max(0, Math.min(1, this.songVolume)));
	get clampedSongVolume() {
		return this.#clampedSongVolume();
	}
	set clampedSongVolume($$value) {
		return this.#clampedSongVolume($$value);
	}
	#clampedClickVolume = derived(() => Math.max(0, this.clickVolume));
	get clampedClickVolume() {
		return this.#clampedClickVolume();
	}
	set clampedClickVolume($$value) {
		return this.#clampedClickVolume($$value);
	}
	#ctx = null;
	#clickMaster = null;
	#songGain = null;
	#activeSource = null;
	#playStartCtxTime = 0;
	#playStartPositionSec = 0;
	#playEndPositionSec = 0;
	#playPreRollSec = 0;
	#autoStopTimeoutId = null;
	#transportRaf = 0;
	#clickRaf = 0;
	#nextClickIdx = 0;
	#effectCleanup = null;
	constructor() {
		this.#effectCleanup = () => {};
	}
	setSongMap(sm) {
		this.songMap = sm;
	}
	/**
	* Provide the decoded `AudioBuffer` for the current song. REQUIRED
	* before `play()` — without it `play()` no-ops. Hosts already decode
	* this for waveform peaks; pass that same buffer here.
	*
	* If a new buffer arrives mid-play, the currently-playing source is
	* stopped imperatively here (NOT via a `$effect` — that path tracked
	* `isPlaying` too and would kill the source `play()` had just
	* started in the same microtask).
	*/
	setAudioBuffer(buf) {
		if (this.isPlaying && this.audioBuffer !== null && this.audioBuffer !== buf) {
			this.#stopSourceOnly();
			this.#cancelAutoStop();
			this.isPlaying = false;
			this.#stopTransport();
		}
		this.audioBuffer = buf;
	}
	/** Back-compat. Hosts may still bind the `<audio>` element. The controller does not use it for playback. */
	setAudioElement(el) {
		this.audioEl = el;
	}
	play() {
		if (this.isPlaying) return;
		const buf = this.audioBuffer;
		if (!buf) return;
		const plan = this.plan;
		if (this.debugClickTiming) this.#debugLogBudget = 16;
		this.#ensureGraph();
		const ctx = this.#ctx;
		ctx.resume();
		const dur = buf.duration;
		let startPos = this.currentTime;
		if (this.rangeEnd > this.rangeStart) {
			if (startPos < this.rangeStart || startPos >= this.rangeEnd - .02) startPos = this.rangeStart;
		}
		startPos = Math.max(0, Math.min(startPos, dur));
		const endPos = this.rangeEnd > this.rangeStart ? Math.min(this.rangeEnd, dur) : dur;
		if (endPos - startPos < .005) return;
		const songStartBufferPos = plan ? plan.firstDownbeatOriginalSec - this.mediaTimeOffsetSec : Number.POSITIVE_INFINITY;
		const atSongStart = startPos <= songStartBufferPos + .05;
		const wantsCountIn = this.playWithClick && plan !== null && plan.countInBeats > 0 && plan.prependSec > 1e-6 && atSongStart;
		const preroll = wantsCountIn ? plan.prependSec : 0;
		const ctxStart = ctx.currentTime + PLAY_START_LOOKAHEAD_SEC + preroll;
		const src = ctx.createBufferSource();
		src.buffer = buf;
		src.connect(this.#songGain);
		src.start(ctxStart, startPos);
		src.stop(ctxStart + (endPos - startPos) + .05);
		this.#activeSource = src;
		this.#playStartCtxTime = ctxStart;
		this.#playStartPositionSec = startPos;
		this.#playEndPositionSec = endPos;
		this.#playPreRollSec = preroll;
		if (wantsCountIn) {
			const calOffset = this.clickOffsetSec;
			for (const c of plan.clickPoints) {
				if (!c.isCountIn) continue;
				const fireAt = ctxStart + c.timeSec + calOffset;
				if (fireAt < ctx.currentTime + CLICK_SCHEDULE_LEAD_SEC) continue;
				playMetronomeClick(ctx, this.#clickMaster, fireAt, c.downbeat);
			}
		}
		if (this.#autoStopTimeoutId !== null) clearTimeout(this.#autoStopTimeoutId);
		this.#autoStopTimeoutId = setTimeout(() => {
			this.#autoStopTimeoutId = null;
			if (!this.isPlaying) return;
			this.#stopSourceOnly();
			this.isPlaying = false;
			this.currentTime = this.rangeStart;
			this.#stopTransport();
		}, Math.max(0, (preroll + (endPos - startPos)) * 1e3 + 30));
		this.isPlaying = true;
		this.#startTransport();
	}
	pause() {
		if (!this.isPlaying) {
			this.#cancelAutoStop();
			return;
		}
		const pos = this.#computeCurrentPosition();
		this.#stopSourceOnly();
		this.#cancelAutoStop();
		this.currentTime = pos;
		this.isPlaying = false;
		this.#stopTransport();
	}
	/** Pause and seek to `rangeStart`. */
	stop() {
		this.#stopSourceOnly();
		this.#cancelAutoStop();
		this.isPlaying = false;
		this.currentTime = this.rangeStart;
		this.#stopTransport();
	}
	/** Seek to a buffer position (seconds into the decoded buffer). */
	seek(sec) {
		const dur = this.audioBuffer?.duration ?? 0;
		const t = Math.max(0, dur > 0 ? Math.min(sec, dur) : sec);
		const wasPlaying = this.isPlaying;
		if (wasPlaying) {
			this.#stopSourceOnly();
			this.#cancelAutoStop();
			this.isPlaying = false;
			this.#stopTransport();
		}
		this.currentTime = t;
		if (wasPlaying) this.play();
	}
	destroy() {
		this.#cancelAutoStop();
		this.#stopClickLoop();
		this.#stopTransport();
		this.#stopSourceOnly();
		if (this.#ctx) this.#ctx.close().catch(() => {});
		this.#ctx = null;
		this.#clickMaster = null;
		this.#songGain = null;
		this.#effectCleanup?.();
		this.#effectCleanup = null;
		this.audioEl = null;
		this.audioBuffer = null;
	}
	#ensureGraph() {
		if (this.#ctx && this.#clickMaster && this.#songGain) return;
		const ctx = this.#ctx ?? new AudioContext();
		if (!this.#clickMaster) {
			const click = ctx.createGain();
			click.gain.value = Math.max(0, this.clickVolume);
			click.connect(ctx.destination);
			this.#clickMaster = click;
		}
		if (!this.#songGain) {
			const song = ctx.createGain();
			song.gain.value = Math.max(0, Math.min(1, this.songVolume));
			song.connect(ctx.destination);
			this.#songGain = song;
		}
		this.#ctx = ctx;
	}
	#stopSourceOnly() {
		if (!this.#activeSource) return;
		try {
			this.#activeSource.stop();
		} catch {}
		try {
			this.#activeSource.disconnect();
		} catch {}
		this.#activeSource = null;
	}
	#cancelAutoStop() {
		if (this.#autoStopTimeoutId !== null) {
			clearTimeout(this.#autoStopTimeoutId);
			this.#autoStopTimeoutId = null;
		}
	}
	/**
	* Buffer position right now, derived purely from the ctx clock.
	* `playStartPositionSec` was the buffer offset at `playStartCtxTime`,
	* and the buffer advances 1:1 with `ctx.currentTime` after `ctxStart`.
	* Before `ctxStart` (during count-in pre-roll), position stays at
	* `playStartPositionSec` so the playhead doesn't jump backward.
	*/
	#computeCurrentPosition() {
		if (!this.#ctx) return this.currentTime;
		const elapsed = this.#ctx.currentTime - this.#playStartCtxTime;
		if (elapsed <= 0) return this.#playStartPositionSec;
		const pos = this.#playStartPositionSec + elapsed;
		return Math.min(pos, this.#playEndPositionSec);
	}
	#startTransport() {
		if (this.#transportRaf) return;
		this.#transportRaf = requestAnimationFrame(this.#tickTransport);
	}
	#stopTransport() {
		if (this.#transportRaf) cancelAnimationFrame(this.#transportRaf);
		this.#transportRaf = 0;
	}
	#tickTransport = () => {
		if (!this.isPlaying || !this.#ctx) {
			this.#stopTransport();
			return;
		}
		const pos = this.#computeCurrentPosition();
		this.currentTime = pos;
		if (this.rangeEnd > this.rangeStart && pos >= this.rangeEnd - END_EPS) {
			this.#stopSourceOnly();
			this.#cancelAutoStop();
			this.isPlaying = false;
			this.currentTime = this.rangeStart;
			this.#stopTransport();
			return;
		}
		this.#transportRaf = requestAnimationFrame(this.#tickTransport);
	};
	#startClickLoop() {
		if (this.#clickRaf) return;
		this.#ensureGraph();
		this.#ctx?.resume();
		const plan = this.plan;
		if (!plan) return;
		const planTime = this.#computeCurrentPosition() - this.mediaTimeOffsetSec;
		let i = plan.clickPoints.findIndex((c) => !c.isCountIn || c.timeSec >= -1e-9);
		if (i < 0) i = plan.clickPoints.length;
		while (i < plan.clickPoints.length && plan.clickPoints[i].timeSec < planTime - CLICK_PAST_GRACE_SEC) i++;
		this.#nextClickIdx = i;
		this.#clickRaf = requestAnimationFrame(this.#runClickLoop);
	}
	#stopClickLoop() {
		if (this.#clickRaf) cancelAnimationFrame(this.#clickRaf);
		this.#clickRaf = 0;
	}
	#runClickLoop = () => {
		const ctx = this.#ctx;
		const master = this.#clickMaster;
		if (!ctx || !master || !this.playWithClick || !this.isPlaying) {
			this.#stopClickLoop();
			return;
		}
		const plan = this.plan;
		if (!plan) {
			this.#stopClickLoop();
			return;
		}
		const position = this.#computeCurrentPosition();
		const planTime = position - this.mediaTimeOffsetSec;
		const ctxNow = ctx.currentTime;
		while (this.#nextClickIdx < plan.clickPoints.length && plan.clickPoints[this.#nextClickIdx].timeSec < planTime - CLICK_PAST_GRACE_SEC) this.#nextClickIdx++;
		while (this.#nextClickIdx < plan.clickPoints.length && plan.clickPoints[this.#nextClickIdx].timeSec <= planTime + CLICK_LOOKAHEAD_SEC) {
			const c = plan.clickPoints[this.#nextClickIdx];
			if (c.timeSec >= -1e-9) {
				const delta = c.timeSec - planTime;
				const offset = this.clickOffsetSec;
				const scheduleAt = ctxNow + Math.max(CLICK_SCHEDULE_LEAD_SEC, delta + offset);
				playMetronomeClick(ctx, master, scheduleAt, c.downbeat);
				if (this.debugClickTiming && this.#debugLogBudget > 0) {
					this.#debugLogBudget--;
					console.log("[click]", {
						beat: this.#nextClickIdx,
						downbeat: c.downbeat,
						position: position.toFixed(4),
						planTime: planTime.toFixed(4),
						ctxNow: ctxNow.toFixed(4),
						delta: delta.toFixed(4),
						offsetApplied: offset.toFixed(4),
						scheduleAt: scheduleAt.toFixed(4)
					});
				}
			}
			this.#nextClickIdx++;
		}
		if (this.#nextClickIdx >= plan.clickPoints.length) {
			this.#stopClickLoop();
			return;
		}
		this.#clickRaf = requestAnimationFrame(this.#runClickLoop);
	};
};
//#endregion
//#region src/lib/audio/formatTime.ts
function formatTime(sec) {
	if (!Number.isFinite(sec) || sec < 0) return "0:00";
	return `${Math.floor(sec / 60)}:${Math.floor(sec % 60).toString().padStart(2, "0")}`;
}
//#endregion
//#region src/lib/audio/timeGeometry.ts
function timeToPxInView(t, viewStart, viewEnd, waveWidthPx) {
	const span = viewEnd - viewStart;
	if (!(span > 0) || !(waveWidthPx > 0) || !Number.isFinite(t)) return 0;
	return (Math.max(viewStart, Math.min(t, viewEnd)) - viewStart) / span * waveWidthPx;
}
derived$1(uiAnimations, ($u) => $u.beatPulse);
//#endregion
//#region src/lib/components/WaveformPlayer.svelte
function WaveformPlayer($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		/** Waveform timeline editor orchestration (viewport-driven model). */
		/** `trim` = home flow (region selection). `editor` = full-timeline editing (same controls, copy tuned). */
		let { file = null, rangeStart = 0, rangeEnd = 0, ready = false, variant = "trim", beatGrid = null, beatGridEditable = false, timelineStripMode = "grid", mapSections = [], onBarGridAction = void 0, onApplySectionTag = void 0, suggestionPreview = null, onAcceptSuggestion = void 0, onDismissSuggestion = void 0, onResizeSection = void 0, onResizeBoundary = void 0, audioBorderTicks = [], audioBordersStatus = "idle", audioBordersError = null, showAudioBorders = true, onReanalyzeBorders = void 0, sectionsInstallProgress = 0, sectionsSelectionBarIds = [], chordsSelectionBeatIds = [], selectedBeatId = null, chordLabelByBeatId = {}, chordSuggestionByBeatId = {}, onChordBeatInteract = void 0, audioElement = null, controller: passedController = null, countInTicks = [], songStartBarIndex = null, onSetStartBar = void 0 } = $$props;
		/**
		* Local fallback controller so callers that don't pass one (the
		* trim variant on the home page) keep working without forcing every
		* caller to know the controller exists. With no songMap, the
		* fallback's click loop and count-in pre-roll never fire, so
		* behavior matches the pre-controller days for that surface.
		*/
		const fallbackController = new PlaybackController();
		const controller = derived(() => passedController ?? fallbackController);
		onDestroy(() => fallbackController.destroy());
		let isEditorVariant = derived(() => variant === "editor");
		derived(() => Boolean(isEditorVariant() && beatGridEditable && beatGrid && (timelineStripMode === "sections" || timelineStripMode === "chords" || onBarGridAction)));
		/** Authoritative editor duration consumed by selection / viewport / transport / geometry. */
		let timelineSec = 0;
		/** Mirrored from the controller's rAF-driven `currentTime` (or 0 before mount). */
		let currentTime = derived(() => controller().currentTime);
		derived(() => controller().isPlaying);
		/** Detail canvas width in CSS px — fits available viewport width. */
		let waveWidth = 0;
		/** Visible time window [viewStart, viewEnd] (sec). Sub-range = zoomed detail; full file = [0, duration]. */
		let viewStart = 0;
		let viewEnd = 0;
		/** @type {'idle' | 'maybe-seek' | 'create-selection' | 'move-selection' | 'resize-selection-left' | 'resize-selection-right'} */
		let detailMode = "idle";
		/** @type {'idle' | 'drag-viewport' | 'resize-viewport-left' | 'resize-viewport-right'} */
		let minimapMode = "idle";
		/** Safe [start,end] for mapping when view state is mid-reset. */
		let layoutViewStart = derived(() => viewEnd > viewStart ? viewStart : 0);
		let layoutViewEnd = derived(() => viewEnd > viewStart ? viewEnd : timelineSec > 0 ? timelineSec : 1);
		derived(() => viewEnd > viewStart && timelineSec > 0 ? `${formatTime(viewStart)} – ${formatTime(viewEnd)}` : "");
		/** Hover / scrub preview time (seconds) — visual only until pointerup seek. */
		let hoverTime = null;
		let scrubPreviewTime = null;
		let phantomTime = derived(() => scrubPreviewTime != null ? scrubPreviewTime : hoverTime);
		derived(() => phantomTime() != null && timelineSec > 0 && waveWidth > 0 ? timeToPxInView(phantomTime(), layoutViewStart(), layoutViewEnd(), waveWidth) : null);
		let detailHoverTarget = "outside";
		let minimapHoverTarget = "outside";
		let selLeft = derived(() => timeToPxInView(rangeStart, layoutViewStart(), layoutViewEnd(), waveWidth));
		let selW = derived(() => timelineSec > 0 ? timeToPxInView(rangeEnd, layoutViewStart(), layoutViewEnd(), waveWidth) - timeToPxInView(rangeStart, layoutViewStart(), layoutViewEnd(), waveWidth) : 0);
		derived(() => timeToPxInView(currentTime(), layoutViewStart(), layoutViewEnd(), waveWidth));
		derived(() => selLeft() + selW());
		derived(() => rangeStart >= layoutViewStart() && rangeStart <= layoutViewEnd());
		derived(() => rangeEnd >= layoutViewStart() && rangeEnd <= layoutViewEnd());
		derived(() => detailMode === "move-selection" ? "cursor-grabbing" : detailMode === "resize-selection-left" || detailMode === "resize-selection-right" ? "cursor-ew-resize" : detailMode === "idle" && detailHoverTarget === "left-handle" ? "cursor-ew-resize" : detailMode === "idle" && detailHoverTarget === "right-handle" ? "cursor-ew-resize" : detailMode === "idle" && detailHoverTarget === "body" ? "cursor-grab" : "cursor-crosshair");
		derived(() => minimapMode === "drag-viewport" ? "cursor-grabbing" : minimapMode === "resize-viewport-left" || minimapMode === "resize-viewport-right" ? "cursor-ew-resize" : minimapMode === "idle" && minimapHoverTarget === "left-handle" ? "cursor-ew-resize" : minimapMode === "idle" && minimapHoverTarget === "right-handle" ? "cursor-ew-resize" : minimapMode === "idle" && minimapHoverTarget === "body" ? "cursor-grab" : "cursor-crosshair");
		derived(() => timelineSec > 0 && viewEnd > viewStart ? viewStart / timelineSec * 100 : 0);
		derived(() => timelineSec > 0 && viewEnd > viewStart ? (viewEnd - viewStart) / timelineSec * 100 : 100);
		derived(() => timelineSec > 0 ? rangeStart / timelineSec * 100 : 0);
		derived(() => timelineSec > 0 ? (rangeEnd - rangeStart) / timelineSec * 100 : 0);
		derived(() => timelineSec > 0 ? Math.max(0, Math.min(currentTime(), timelineSec)) / timelineSec * 100 : 0);
		/** Time range [startSec, endSec) of the current edit-mode selection (sections or chords). */
		let editSelectionTimeSec = derived(() => {
			if (!beatGrid || timelineStripMode === "grid") return null;
			if (timelineStripMode === "sections" && sectionsSelectionBarIds.length > 0) {
				const byId = new Map(beatGrid.bars.map((b) => [b.id, b]));
				let t0 = Number.POSITIVE_INFINITY;
				let t1 = Number.NEGATIVE_INFINITY;
				for (const id of sectionsSelectionBarIds) {
					const b = byId.get(id);
					if (!b) continue;
					if (b.startSec < t0) t0 = b.startSec;
					if (b.endSec > t1) t1 = b.endSec;
				}
				return isFinite(t0) && t1 > t0 ? {
					startSec: t0,
					endSec: t1
				} : null;
			}
			if (timelineStripMode === "chords" && chordsSelectionBeatIds.length > 0) {
				const sorted = sortBeatsByTime(beatGrid.beats);
				const selSet = new Set(chordsSelectionBeatIds);
				const barsById = new Map(beatGrid.bars.map((b) => [b.id, b]));
				let t0 = Number.POSITIVE_INFINITY;
				let t1 = Number.NEGATIVE_INFINITY;
				for (let i = 0; i < sorted.length; i++) {
					const b = sorted[i];
					if (!selSet.has(b.id)) continue;
					const barEnd = barsById.get(b.barId)?.endSec ?? b.timeSec + .1;
					const next = sorted[i + 1];
					const beatEnd = next ? Math.min(next.timeSec, barEnd) : barEnd;
					if (b.timeSec < t0) t0 = b.timeSec;
					if (beatEnd > t1) t1 = beatEnd;
				}
				return isFinite(t0) && t1 > t0 ? {
					startSec: t0,
					endSec: t1
				} : null;
			}
			return null;
		});
		let editSelLeft = derived(() => editSelectionTimeSec() && waveWidth > 0 ? timeToPxInView(editSelectionTimeSec().startSec, layoutViewStart(), layoutViewEnd(), waveWidth) : 0);
		derived(() => editSelectionTimeSec() && waveWidth > 0 ? timeToPxInView(editSelectionTimeSec().endSec, layoutViewStart(), layoutViewEnd(), waveWidth) - editSelLeft() : 0);
		derived(() => editSelectionTimeSec() && timelineSec > 0 ? editSelectionTimeSec().startSec / timelineSec * 100 : 0);
		derived(() => editSelectionTimeSec() && timelineSec > 0 ? (editSelectionTimeSec().endSec - editSelectionTimeSec().startSec) / timelineSec * 100 : 0);
		derived(() => {
			if (!beatGrid || timelineStripMode !== "sections" || mapSections.length === 0 || !(timelineSec > 0)) return [];
			const byIndex = new Map(beatGrid.bars.map((b) => [b.index, b]));
			const out = [];
			for (const sec of mapSections) {
				const inRange = [];
				for (let i = sec.barRange.startBarIndex; i <= sec.barRange.endBarIndex; i++) {
					const b = byIndex.get(i);
					if (b) inRange.push(b);
				}
				if (inRange.length === 0) continue;
				const t0 = Math.min(...inRange.map((b) => b.startSec));
				const t1 = Math.max(...inRange.map((b) => b.endSec));
				if (!(t1 > t0)) continue;
				const x0Pct = t0 / timelineSec * 100;
				const wPct = (t1 - t0) / timelineSec * 100;
				const xPx = waveWidth > 0 ? timeToPxInView(Math.max(t0, layoutViewStart()), layoutViewStart(), layoutViewEnd(), waveWidth) : 0;
				const wPx = waveWidth > 0 ? timeToPxInView(Math.min(t1, layoutViewEnd()), layoutViewStart(), layoutViewEnd(), waveWidth) - xPx : 0;
				out.push({
					key: sec.id,
					kind: sec.kind,
					x0Pct,
					wPct,
					xPx,
					wPx
				});
			}
			return out;
		});
		function onMinimapPointerMove(e) {}
		function onMinimapPointerUp() {
			minimapMode = "idle";
			minimapHoverTarget = "outside";
			window.removeEventListener("pointermove", onMinimapPointerMove);
			window.removeEventListener("pointerup", onMinimapPointerUp);
			window.removeEventListener("pointercancel", onMinimapPointerUp);
		}
		/** Defer past this effect flush — sync `loadFile()` re-enters the runtime and can hit `effect_update_depth_exceeded`. */
		/** Main waveform: resize recomputes width + peaks for the current view. */
		/** Include so we re-apply after <canvas bind:this> — otherwise first redraw can run before canvas exists. */
		/** Skip expensive peak recompute only while dragging — once `waveWidth` is still 0 we must compute. */
		/** Double rAF: flex layout often reports `clientWidth === 0` until after layout/paint. */
		/** Minimap: full-file overview waveform (fixed vertical size). */
		/** Must match minimap inner width: a hard cap (previously 800px) left empty space on wide layouts so the viewport box did not align with the overview waveform. */
		/** Ctrl/Cmd + wheel = zoom; horizontal trackpad / Shift+scroll = pan (detail maps pixels ↔ visible span). */
		/** @param {WheelEvent} e */
		/** Minimap: horizontal wheel pans the detail viewport across the full timeline. */
		/** @param {WheelEvent} e */
		/** If `canplay` already happened before we subscribed. */
		/** Grid / editor: pulse page background on each beat while playing. */
		onDestroy(() => {});
		let $$settled = true;
		let $$inner_renderer;
		function $$render_inner($$renderer) {
			$$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]-->`);
		}
		do {
			$$settled = true;
			$$inner_renderer = $$renderer.copy();
			$$render_inner($$inner_renderer);
		} while (!$$settled);
		$$renderer.subsume($$inner_renderer);
		bind_props($$props, {
			rangeStart,
			rangeEnd,
			ready,
			showAudioBorders,
			sectionsSelectionBarIds,
			chordsSelectionBeatIds,
			selectedBeatId,
			audioElement
		});
	});
}
//#endregion
export { PlaybackController as n, Music as r, WaveformPlayer as t };
