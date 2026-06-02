import { f as spread_props } from "./server.js";
import { $ as computeCountIn, G as songStartBeat, H as buildCueSpeechEvents, K as titleCuePreludeSec, Q as effectiveCountInBeats, U as clickWavSongStartSec, W as countInSpeechOutputTimes, q as sortBeatsByTime } from "./commit.js";
import { s as fetchDesktopTtsSynthesizeWav } from "./desktopBridge.js";
import { t as Icon } from "./Icon.js";
import { t as audioBufferToWavBlob } from "./trimAudio.js";
//#region node_modules/@lucide/svelte/dist/icons/pencil.svelte
function Pencil($$renderer, $$props) {
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
			{ name: "pencil" },
			props,
			{
				iconNode: [["path", { "d": "M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" }], ["path", { "d": "m15 5 4 4" }]],
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
//#region src/lib/audio/renderCueTrack.ts
/**
* Offline metronome cue WAV aligned to SongMap trim + count-in prepend.
* Optional spoken cues (title + count-in numbers + section callouts) via desktop Piper when reachable.
*/
var END_EPS = .028;
var CUE_SAMPLE_RATE = 44100;
/** How loud spoken clips are mixed vs clicks (still peak-limited at end). */
var SPEECH_MIX_GAIN = 1.04;
/** Count-in number clips: slightly shorter than Piper default so the grid feels tighter. */
var COUNT_TTS_SPEEDUP = 1.11;
function resampleMonoSpeedup(src, speed) {
	if (!(speed > 1) || src.length < 2) return src;
	const outLen = Math.max(1, Math.floor(src.length / speed));
	const out = new Float32Array(outLen);
	for (let j = 0; j < outLen; j++) {
		const pos = j * speed;
		const i = Math.floor(pos);
		const frac = pos - i;
		const i1 = Math.min(i + 1, src.length - 1);
		out[j] = (1 - frac) * (src[i] ?? 0) + frac * (src[i1] ?? 0);
	}
	return out;
}
function mixClickKernel(samples, sampleRate, tSec, downbeat) {
	const start = Math.floor(tSec * sampleRate);
	const freq = downbeat ? 1040 : 720;
	const durSec = downbeat ? .058 : .044;
	const peak = downbeat ? .86 : .5;
	const len = Math.ceil(durSec * sampleRate);
	for (let i = 0; i < len; i++) {
		const idx = start + i;
		if (idx < 0 || idx >= samples.length) continue;
		const t = i / sampleRate;
		const envLin = Math.min(1, i / (.0025 * sampleRate));
		const envExp = Math.exp(-t * (downbeat ? 36 : 46));
		const env = Math.min(1, envLin) * envExp * peak;
		samples[idx] += Math.sin(2 * Math.PI * freq * t) * env;
	}
}
function linearResampleMono(src, srcRate, destLen, destRate) {
	const out = new Float32Array(destLen);
	if (destLen === 0 || src.length === 0) return out;
	for (let j = 0; j < destLen; j++) {
		const srcPos = j / destRate * srcRate;
		const i = Math.floor(srcPos);
		const frac = srcPos - i;
		const i1 = Math.min(i + 1, src.length - 1);
		const s0 = src[i] ?? 0;
		const s1 = src[i1] ?? 0;
		out[j] = (1 - frac) * s0 + frac * s1;
	}
	return out;
}
/** Sum resampled mono clip into `dst` starting at `offsetSec` on `dstRate` timeline. */
function addClipAtOffset(dst, dstRate, clipMono, clipRate, offsetSec, gain) {
	if (clipMono.length === 0) return 0;
	const offsetSamples = Math.floor(offsetSec * dstRate);
	const resampled = linearResampleMono(clipMono, clipRate, Math.max(1, Math.ceil(clipMono.length * (dstRate / clipRate))), dstRate);
	const durSec = resampled.length / dstRate;
	for (let j = 0; j < resampled.length; j++) {
		const idx = offsetSamples + j;
		if (idx < 0 || idx >= dst.length) continue;
		dst[idx] += resampled[j] * gain;
	}
	return durSec;
}
/**
* Render a mono 44.1 kHz WAV: silence for prepend, sine clicks on beats, optional Piper speech
* (desktop sidecar). Both layers are independently controllable so callers
* can build the four useful variants:
*
*   - `{ includeClicks: true, includeSpeech: true }`  — legacy "cue track"
*   - `{ includeClicks: true, includeSpeech: false }` — pure click track
*   - `{ includeClicks: false, includeSpeech: true }` — pure speech ("cue v2")
*   - `{ includeClicks: false, includeSpeech: false }` — silence (rare; debug)
*
* Same prelude/prepend math regardless of layers, so all variants are
* sample-aligned with each other.
*/
async function renderCueTrackWavBlob(sm, opts = {}) {
	const includeSpeech = opts.includeSpeech !== false;
	const includeClicks = opts.includeClicks !== false;
	const trim = sm.audio?.trim;
	if (!trim || !(trim.endSec > trim.startSec)) throw new Error("Cue track needs audio.trim with end > start");
	const sorted = sortBeatsByTime(sm.timeline.beats);
	if (sorted.length === 0) throw new Error("Cue track needs at least one beat");
	let prependSec = 0;
	const countInBeats = effectiveCountInBeats(sm);
	if (countInBeats > 0) {
		const ci = computeCountIn(sm, countInBeats);
		if (ci) prependSec = ci.prependSec;
	}
	const preludeSec = titleCuePreludeSec(sm);
	const trimLen = trim.endSec - trim.startSec;
	const totalSec = preludeSec + prependSec + trimLen;
	if (!(totalSec > 0)) throw new Error("Cue track duration is zero");
	const sampleRate = CUE_SAMPLE_RATE;
	const frames = Math.max(1, Math.ceil(totalSec * sampleRate));
	const data = new Float32Array(frames);
	const trimStart = trim.startSec;
	const trimEnd = trim.endSec;
	const fd = songStartBeat(sm);
	const songStartSec = clickWavSongStartSec(sm, {
		preludeSec,
		prependSec
	});
	const countInActive = countInBeats > 0 && Boolean(fd) && songStartSec !== null;
	if (includeClicks && countInActive) {
		const grid = countInSpeechOutputTimes(sm, trim, prependSec, countInBeats);
		for (const t of grid) mixClickKernel(data, sampleRate, preludeSec + t, false);
	}
	if (includeClicks) for (const b of sorted) {
		if (b.timeSec < trimStart - 1e-9) continue;
		if (b.timeSec >= trimEnd - END_EPS) continue;
		if (countInActive && fd && b.timeSec < fd.timeSec) continue;
		const tClick = fd && songStartSec !== null ? songStartSec + (b.timeSec - fd.timeSec) : preludeSec + prependSec + (b.timeSec - trimStart);
		if (tClick < 0 || tClick >= totalSec - 1e-6) continue;
		mixClickKernel(data, sampleRate, tClick, b.indexInBar === 0);
	}
	let speechOk = true;
	let speechFail = null;
	const ac = new AudioContext({ sampleRate });
	try {
		if (!includeSpeech) {} else {
			const events = buildCueSpeechEvents(sm);
			const speechRows = [];
			let mixOrder = 0;
			for (const e of events) if (e.kind === "title") speechRows.push({
				t: Math.max(0, e.tSec),
				text: e.text,
				order: mixOrder++
			});
			else if (e.kind === "count") speechRows.push({
				t: e.tSec,
				text: e.text,
				speedup: COUNT_TTS_SPEEDUP,
				order: mixOrder++
			});
			else if (e.kind === "section") speechRows.push({
				t: e.tSec,
				text: e.text,
				order: mixOrder++
			});
			speechRows.sort((a, b) => a.t !== b.t ? a.t - b.t : a.order - b.order);
			const mixSpeechAt = async (t, text, opts) => {
				const r = await fetchDesktopTtsSynthesizeWav(text);
				if (!r.ok) {
					speechOk = false;
					speechFail = speechFail ?? r.error;
					return 0;
				}
				let buf;
				try {
					buf = await ac.decodeAudioData(await r.blob.arrayBuffer());
				} catch {
					speechOk = false;
					speechFail = speechFail ?? "Could not decode speech WAV";
					return 0;
				}
				let ch0 = buf.numberOfChannels > 0 ? buf.getChannelData(0) : new Float32Array(0);
				const sp = opts?.speedup ?? 1;
				if (sp > 1 && ch0.length > 0) ch0 = new Float32Array(resampleMonoSpeedup(ch0, sp));
				return addClipAtOffset(data, sampleRate, ch0, buf.sampleRate, t, SPEECH_MIX_GAIN);
			};
			for (const row of speechRows) await mixSpeechAt(Math.max(0, row.t), row.text, row.speedup ? { speedup: row.speedup } : void 0);
		}
	} finally {
		await ac.close().catch(() => {});
	}
	let peak = 0;
	for (let i = 0; i < data.length; i++) {
		const a = Math.abs(data[i]);
		if (a > peak) peak = a;
	}
	if (peak > .99 && peak > 0) {
		const s = .99 / peak;
		for (let i = 0; i < data.length; i++) data[i] *= s;
	}
	const ctx2 = new AudioContext({ sampleRate });
	try {
		const buf = ctx2.createBuffer(1, frames, sampleRate);
		buf.copyToChannel(data, 0, 0);
		return {
			blob: await audioBufferToWavBlob(buf),
			preludeOffsetSec: preludeSec + prependSec,
			speechSkippedReason: !includeSpeech || speechOk ? void 0 : `No voice in this file — ${speechFail ?? "desktop unreachable"}. Run BarBro desktop and set up Piper (TTS debug page).`
		};
	} finally {
		await ctx2.close().catch(() => {});
	}
}
//#endregion
export { Pencil as n, renderCueTrackWavBlob as t };
