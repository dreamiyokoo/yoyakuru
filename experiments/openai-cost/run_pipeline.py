"""組み合わせ構成: gpt-4o-transcribe → gpt-5.4-mini(テキスト) → gpt-4o-mini-tts の原価を測る。

音声認識は発話区間だけを送る前提（無音は課金されない）。
TTS は usage が返らないため、Realtime の実測（出力音声トークン/秒）で音声トークン数を推定する。
usage: python run_pipeline.py <scenario>
"""
import glob
import io
import json
import os
import sys
import time
import wave

import requests

from scenarios import SCENARIOS, SYSTEM

# USD per 1M tokens (https://developers.openai.com/api/docs/pricing 2026-11-05)
TRANSCRIBE_IN, TRANSCRIBE_OUT = 2.50, 10.00
LLM_IN, LLM_CACHED, LLM_OUT = 0.75, 0.075, 4.50
TTS_TEXT_IN, TTS_AUDIO_OUT = 0.60, 12.00

KEY = os.environ["OPENAI_API_KEY"]
H = {"Authorization": f"Bearer {KEY}"}
scenario = sys.argv[1]


def tokens_per_sec() -> float:
    toks = sec = 0
    for f in glob.glob("results/gpt-*.json"):
        r = json.load(open(f))
        for t in r["turns"]:
            toks += t["usage"]["output_token_details"]["audio_tokens"]
            sec += t["reply_sec"]
    return toks / sec


def wav(pcm: bytes) -> bytes:
    b = io.BytesIO()
    with wave.open(b, "wb") as w:
        w.setnchannels(1), w.setsampwidth(2), w.setframerate(24000)
        w.writeframes(pcm)
    return b.getvalue()


tps = tokens_per_sec()
history = [{"role": "system", "content": SYSTEM}]
total = {"stt": 0.0, "llm": 0.0, "tts": 0.0}
call_sec, prev_ai = 0.0, 0.0
for i, _ in enumerate(SCENARIOS[scenario]):
    pcm = open(f"audio/{scenario}_{i}.pcm", "rb").read()
    speech_sec = len(pcm) / 48000
    call_sec += 2.0 + prev_ai + speech_sec + 2.0  # run_call.py と同じ前提

    r = requests.post("https://api.openai.com/v1/audio/transcriptions", headers=H,
                      files={"file": ("a.wav", wav(pcm), "audio/wav")},
                      data={"model": "gpt-4o-transcribe", "language": "ja"}, timeout=60)
    r.raise_for_status()
    j = r.json()
    u = j["usage"]
    total["stt"] += (u["input_tokens"] * TRANSCRIBE_IN + u["output_tokens"] * TRANSCRIBE_OUT) / 1e6
    history.append({"role": "user", "content": j["text"]})

    r = requests.post("https://api.openai.com/v1/chat/completions", headers=H, timeout=60,
                      json={"model": "gpt-5.4-mini", "messages": history, "max_completion_tokens": 300})
    r.raise_for_status()
    c = r.json()
    u = c["usage"]
    cached = u.get("prompt_tokens_details", {}).get("cached_tokens", 0)
    total["llm"] += ((u["prompt_tokens"] - cached) * LLM_IN + cached * LLM_CACHED + u["completion_tokens"] * LLM_OUT) / 1e6
    reply = c["choices"][0]["message"]["content"]
    history.append({"role": "assistant", "content": reply})

    r = requests.post("https://api.openai.com/v1/audio/speech", headers=H, timeout=60,
                      json={"model": "gpt-4o-mini-tts", "voice": "alloy", "input": reply, "response_format": "pcm"})
    r.raise_for_status()
    prev_ai = len(r.content) / 48000
    text_tokens = len(reply)  # 日本語は概ね1文字≒1トークンとして過大寄りに見積もる
    total["tts"] += (text_tokens * TTS_TEXT_IN + prev_ai * tps * TTS_AUDIO_OUT) / 1e6
    print(f"turn {i}: 「{j['text']}」→「{reply}」")

usd = sum(total.values())
print({k: round(v, 5) for k, v in total.items()})
print(f"合計 ${usd:.4f} / 通話 {call_sec:.0f}秒 → 1分あたり ${usd / (call_sec / 60):.4f}")
json.dump({"scenario": scenario, "total_usd": usd, "call_sec": call_sec, "breakdown": total},
          open(f"results/pipeline_{scenario}_{int(time.time())}.json", "w"), ensure_ascii=False, indent=2)
