#!/usr/bin/env python3

import json
import os
import sys
import warnings

warnings.filterwarnings("ignore")

from faster_whisper import WhisperModel


def normalize_word(value):
    return " ".join(str(value or "").split())


def main():
    paths = sys.argv[1:]
    if not paths:
        print(json.dumps({"error": "Usage: transcribe-audio.py <media-path> [...]"}))
        sys.exit(1)

    model_name = os.getenv("WHISPER_MODEL", "base.en")
    compute_type = os.getenv("WHISPER_COMPUTE_TYPE", "int8")
    beam_size = int(os.getenv("WHISPER_BEAM_SIZE", "5"))

    model = WhisperModel(model_name, device="cpu", compute_type=compute_type)
    results = []

    for media_path in paths:
      segments_iter, info = model.transcribe(
          media_path,
          language="en",
          vad_filter=True,
          beam_size=beam_size,
          word_timestamps=True,
          condition_on_previous_text=False,
      )

      segments = []
      words = []
      transcript_text = []
      for segment in segments_iter:
          segment_words = []
          for word in segment.words or []:
              token = normalize_word(word.word)
              if not token:
                  continue
              record = {
                  "word": token,
                  "start": round(float(word.start), 3),
                  "end": round(float(word.end), 3),
              }
              segment_words.append(record)
              words.append(record)

          cleaned_text = " ".join(str(segment.text or "").split())
          if cleaned_text:
              transcript_text.append(cleaned_text)

          segments.append({
              "start": round(float(segment.start), 3),
              "end": round(float(segment.end), 3),
              "text": cleaned_text,
              "words": segment_words,
          })

      results.append({
          "path": media_path,
          "language": getattr(info, "language", None),
          "duration": round(float(getattr(info, "duration", 0) or 0), 3),
          "text": " ".join(transcript_text).strip(),
          "segments": segments,
          "words": words,
      })

    print(json.dumps({"results": results}, ensure_ascii=False))


if __name__ == "__main__":
    main()
