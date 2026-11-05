"""客側発話を gpt-4o-mini-tts で PCM16 24kHz に変換して audio/ に保存する。"""
import os
import sys

import requests

from scenarios import SCENARIOS

names = sys.argv[1:] or list(SCENARIOS)
for name in names:
    for i, text in enumerate(SCENARIOS[name]):
        path = f"audio/{name}_{i}.pcm"
        if os.path.exists(path):
            continue
        r = requests.post(
            "https://api.openai.com/v1/audio/speech",
            headers={"Authorization": f"Bearer {os.environ['OPENAI_API_KEY']}"},
            json={
                "model": "gpt-4o-mini-tts",
                "voice": "alloy",
                "input": text,
                "response_format": "pcm",
                "instructions": "電話越しの自然な日本語の話し方で。",
            },
            timeout=60,
        )
        r.raise_for_status()
        open(path, "wb").write(r.content)
        print(path, len(r.content) / 48000, "sec")
