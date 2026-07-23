#!/usr/bin/env python3
"""Like lyrics/transcribe.py but PRESERVES segments (= lyric lines) with words.
Output: {"segments":[{"text","start","end","words":[{"text","start","end"}]}],"language"}."""
import json, sys
def main():
    audio=sys.argv[1]
    p=json.loads(sys.stdin.read() or "{}")
    from faster_whisper import WhisperModel
    m=WhisperModel(str(p.get("model") or "small"), device="cpu", compute_type="int8",
                   download_root=str(p["modelDir"]) if p.get("modelDir") else None)
    segs,_=m.transcribe(audio, word_timestamps=True, vad_filter=True,
        vad_parameters={"threshold":0.35,"min_silence_duration_ms":500,"speech_pad_ms":400},
        condition_on_previous_text=False, temperature=0.0, repetition_penalty=1.15,
        no_repeat_ngram_size=4, language=(str(p["language"]) if p.get("language") else None), beam_size=5)
    out=[]
    for s in segs:
        words=[{"text":(w.word or "").strip(),"start":round(float(w.start),3),"end":round(float(w.end),3)}
               for w in (s.words or []) if (w.word or "").strip()]
        if not words: continue
        out.append({"text":s.text.strip(),"start":round(float(s.start),3),"end":round(float(s.end),3),"words":words})
    print(json.dumps({"segments":out}))
if __name__=="__main__": main()
