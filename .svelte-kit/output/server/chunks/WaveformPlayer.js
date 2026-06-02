import { r as onDestroy } from "./index-server.js";
import { M as derived, a as derived$1, i as bind_props } from "./server.js";
import "./index-server2.js";
import { K as sortBeatsByTime } from "./commit.js";
import "./desktopBridge.js";
import { n as uiAnimations } from "./uiAnimations.js";
//#region src/lib/audio/audioTransport.ts
var END_EPS = .028;
function createAudioTransport() {
	let rafId = 0;
	function stopRaf() {
		if (rafId) {
			cancelAnimationFrame(rafId);
			rafId = 0;
		}
	}
	function playbackLoop(b) {
		const el = b.getAudio();
		if (!el || !b.getIsPlaying()) return;
		const d = b.getDuration();
		let clock = el.currentTime;
		if (Number.isFinite(d) && d > 0) clock = Math.min(Math.max(0, clock), d);
		b.setCurrentTime(clock);
		const { start, end } = b.getRange();
		if (clock >= end - END_EPS) {
			el.pause();
			el.currentTime = start;
			b.setCurrentTime(start);
			b.setIsPlaying(false);
			stopRaf();
			return;
		}
		rafId = requestAnimationFrame(() => playbackLoop(b));
	}
	return {
		seek(b, time) {
			const el = b.getAudio();
			const d = b.getDuration();
			if (!el || !(d > 0)) return;
			const t = Math.max(0, Math.min(time, d));
			el.currentTime = t;
			b.setCurrentTime(t);
		},
		play(b) {
			b.getAudio()?.play().catch((err) => {});
		},
		pause(b) {
			b.getAudio()?.pause();
		},
		onPlay(b) {
			stopRaf();
			b.setIsPlaying(true);
			rafId = requestAnimationFrame(() => playbackLoop(b));
		},
		onPause(b) {
			b.setIsPlaying(false);
			stopRaf();
			const el = b.getAudio();
			if (!el) return;
			const d = b.getDuration();
			let t = el.currentTime;
			if (Number.isFinite(d) && d > 0) t = Math.min(Math.max(0, t), d);
			b.setCurrentTime(t);
		},
		syncPausedFromElement(b) {
			if (b.getIsPlaying()) return;
			const el = b.getAudio();
			if (!el) return;
			const d = b.getDuration();
			let t = el.currentTime;
			if (Number.isFinite(d) && d > 0) t = Math.min(Math.max(0, t), d);
			b.setCurrentTime(t);
		},
		ensurePlayheadInRange(b) {
			const el = b.getAudio();
			if (!el) return;
			const { start, end } = b.getRange();
			let t = el.currentTime;
			if (t < start || t >= end - .02) {
				t = start;
				el.currentTime = t;
				b.setCurrentTime(t);
			}
		},
		stopRaf,
		destroy() {
			stopRaf();
		}
	};
}
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
derived(uiAnimations, ($u) => $u.beatPulse);
//#endregion
//#region src/lib/components/WaveformPlayer.svelte
function WaveformPlayer($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		/** Waveform timeline editor orchestration (viewport-driven model). */
		/** `trim` = home flow (region selection). `editor` = full-timeline editing (same controls, copy tuned). */
		let { file = null, rangeStart = 0, rangeEnd = 0, ready = false, variant = "trim", beatGrid = null, beatGridEditable = false, timelineStripMode = "grid", mapSections = [], onBarGridAction = void 0, onApplySectionTag = void 0, suggestionPreview = null, onAcceptSuggestion = void 0, onDismissSuggestion = void 0, onResizeSection = void 0, onResizeBoundary = void 0, audioBorderTicks = [], audioBordersStatus = "idle", audioBordersError = null, showAudioBorders = true, onReanalyzeBorders = void 0, sectionsInstallProgress = 0, sectionsSelectionBarIds = [], chordsSelectionBeatIds = [], selectedBeatId = null, chordLabelByBeatId = {}, chordSuggestionByBeatId = {}, onChordBeatInteract = void 0 } = $$props;
		let isEditorVariant = derived$1(() => variant === "editor");
		derived$1(() => Boolean(isEditorVariant() && beatGridEditable && beatGrid && (timelineStripMode === "sections" || timelineStripMode === "chords" || onBarGridAction)));
		/** Authoritative editor duration consumed by selection / viewport / transport / geometry. */
		let timelineSec = 0;
		/** Seconds; ONLY updated from `HTMLAudioElement.currentTime` (rAF while playing, sync when paused). */
		let currentTime = 0;
		/** Detail canvas width in CSS px — fits available viewport width. */
		let waveWidth = 0;
		/** Visible time window [viewStart, viewEnd] (sec). Sub-range = zoomed detail; full file = [0, duration]. */
		let viewStart = 0;
		let viewEnd = 0;
		const transport = createAudioTransport();
		/** @type {'idle' | 'maybe-seek' | 'create-selection' | 'move-selection' | 'resize-selection-left' | 'resize-selection-right'} */
		let detailMode = "idle";
		/** @type {'idle' | 'drag-viewport' | 'resize-viewport-left' | 'resize-viewport-right'} */
		let minimapMode = "idle";
		/** Safe [start,end] for mapping when view state is mid-reset. */
		let layoutViewStart = derived$1(() => viewEnd > viewStart ? viewStart : 0);
		let layoutViewEnd = derived$1(() => viewEnd > viewStart ? viewEnd : timelineSec > 0 ? timelineSec : 1);
		derived$1(() => viewEnd > viewStart && timelineSec > 0 ? `${formatTime(viewStart)} – ${formatTime(viewEnd)}` : "");
		/** Hover / scrub preview time (seconds) — visual only until pointerup seek. */
		let hoverTime = null;
		let scrubPreviewTime = null;
		let phantomTime = derived$1(() => scrubPreviewTime != null ? scrubPreviewTime : hoverTime);
		derived$1(() => phantomTime() != null && timelineSec > 0 && waveWidth > 0 ? timeToPxInView(phantomTime(), layoutViewStart(), layoutViewEnd(), waveWidth) : null);
		let detailHoverTarget = "outside";
		let minimapHoverTarget = "outside";
		let selLeft = derived$1(() => timeToPxInView(rangeStart, layoutViewStart(), layoutViewEnd(), waveWidth));
		let selW = derived$1(() => timelineSec > 0 ? timeToPxInView(rangeEnd, layoutViewStart(), layoutViewEnd(), waveWidth) - timeToPxInView(rangeStart, layoutViewStart(), layoutViewEnd(), waveWidth) : 0);
		derived$1(() => timeToPxInView(currentTime, layoutViewStart(), layoutViewEnd(), waveWidth));
		derived$1(() => selLeft() + selW());
		derived$1(() => rangeStart >= layoutViewStart() && rangeStart <= layoutViewEnd());
		derived$1(() => rangeEnd >= layoutViewStart() && rangeEnd <= layoutViewEnd());
		derived$1(() => detailMode === "move-selection" ? "cursor-grabbing" : detailMode === "resize-selection-left" || detailMode === "resize-selection-right" ? "cursor-ew-resize" : detailMode === "idle" && detailHoverTarget === "left-handle" ? "cursor-ew-resize" : detailMode === "idle" && detailHoverTarget === "right-handle" ? "cursor-ew-resize" : detailMode === "idle" && detailHoverTarget === "body" ? "cursor-grab" : "cursor-crosshair");
		derived$1(() => minimapMode === "drag-viewport" ? "cursor-grabbing" : minimapMode === "resize-viewport-left" || minimapMode === "resize-viewport-right" ? "cursor-ew-resize" : minimapMode === "idle" && minimapHoverTarget === "left-handle" ? "cursor-ew-resize" : minimapMode === "idle" && minimapHoverTarget === "right-handle" ? "cursor-ew-resize" : minimapMode === "idle" && minimapHoverTarget === "body" ? "cursor-grab" : "cursor-crosshair");
		derived$1(() => timelineSec > 0 && viewEnd > viewStart ? viewStart / timelineSec * 100 : 0);
		derived$1(() => timelineSec > 0 && viewEnd > viewStart ? (viewEnd - viewStart) / timelineSec * 100 : 100);
		derived$1(() => timelineSec > 0 ? rangeStart / timelineSec * 100 : 0);
		derived$1(() => timelineSec > 0 ? (rangeEnd - rangeStart) / timelineSec * 100 : 0);
		derived$1(() => timelineSec > 0 ? Math.max(0, Math.min(currentTime, timelineSec)) / timelineSec * 100 : 0);
		/** Time range [startSec, endSec) of the current edit-mode selection (sections or chords). */
		let editSelectionTimeSec = derived$1(() => {
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
		let editSelLeft = derived$1(() => editSelectionTimeSec() && waveWidth > 0 ? timeToPxInView(editSelectionTimeSec().startSec, layoutViewStart(), layoutViewEnd(), waveWidth) : 0);
		derived$1(() => editSelectionTimeSec() && waveWidth > 0 ? timeToPxInView(editSelectionTimeSec().endSec, layoutViewStart(), layoutViewEnd(), waveWidth) - editSelLeft() : 0);
		derived$1(() => editSelectionTimeSec() && timelineSec > 0 ? editSelectionTimeSec().startSec / timelineSec * 100 : 0);
		derived$1(() => editSelectionTimeSec() && timelineSec > 0 ? (editSelectionTimeSec().endSec - editSelectionTimeSec().startSec) / timelineSec * 100 : 0);
		derived$1(() => {
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
		onDestroy(() => {
			transport.destroy();
		});
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
			selectedBeatId
		});
	});
}
//#endregion
export { WaveformPlayer as t };
