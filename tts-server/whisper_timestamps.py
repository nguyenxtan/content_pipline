#!/usr/bin/env python3
"""
Standalone Whisper word-timestamp extractor.
Usage: python whisper_timestamps.py <audio_path> [initial_text]
Output: JSON to stdout — {"success": true, "words": [{word, start, end}, ...]}
"""
import sys, json

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"success": False, "words": [], "error": "No audio path"}))
        sys.exit(1)

    audio_path = sys.argv[1]
    initial_text = sys.argv[2] if len(sys.argv) > 2 else None

    try:
        from faster_whisper import WhisperModel
        model = WhisperModel("small", device="cpu", compute_type="int8")
        segments, _ = model.transcribe(
            audio_path,
            language="vi",
            word_timestamps=True,
            beam_size=5,
            condition_on_previous_text=False,
        )
        words = []
        for seg in segments:
            if seg.words:
                for w in seg.words:
                    word = w.word.strip()
                    if word:
                        start = round(w.start, 3)
                        # Cap word duration at 2s max to prevent stuck subtitles from bad timestamps
                        end = round(min(w.end, w.start + 2.0), 3)
                        words.append({"word": word, "start": start, "end": end})
        print(json.dumps({"success": True, "words": words}))
    except Exception as e:
        print(json.dumps({"success": False, "words": [], "error": str(e)}))
        sys.exit(1)

if __name__ == "__main__":
    main()
