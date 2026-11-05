"""1通話分を Realtime API に流し、ターンごとの usage と金額を記録する。

usage: python run_call.py <model> <scenario> [--max-usd 0.5]
"""
import argparse
import asyncio
import base64
import json
import os
import time

import websockets

from pricing import realtime_cost
from scenarios import SCENARIOS, SYSTEM

ap = argparse.ArgumentParser()
ap.add_argument("model")
ap.add_argument("scenario")
ap.add_argument("--max-usd", type=float, default=0.5)
ap.add_argument("--gap", type=float, default=2.0, help="発話前の無音秒数（前のAI返答の長さも加算）")
args = ap.parse_args()


async def main():
    url = f"wss://api.openai.com/v1/realtime?model={args.model}"
    headers = {"Authorization": f"Bearer {os.environ['OPENAI_API_KEY']}"}
    turns, total, in_sec, out_sec = [], 0.0, 0.0, 0.0
    async with websockets.connect(url, additional_headers=headers, max_size=None) as ws:
        await ws.send(json.dumps({
            "type": "session.update",
            "session": {
                "type": "realtime",
                "instructions": SYSTEM,
                "output_modalities": ["audio"],
                "audio": {
                    "input": {"format": {"type": "audio/pcm", "rate": 24000}, "turn_detection": None},
                    "output": {"format": {"type": "audio/pcm", "rate": 24000}, "voice": "marin"},
                },
            },
        }))
        for i, _ in enumerate(SCENARIOS[args.scenario]):
            speech = open(f"audio/{args.scenario}_{i}.pcm", "rb").read()
            # 実回線では無音・AI発話中も入力音声として流れ続けるため、前のAI返答分＋gap秒の無音を前置する
            prev_ai = turns[-1]["reply_sec"] if turns else 0.0
            pad = int((args.gap + prev_ai) * 24000) * 2
            pcm = b"\x00" * pad + speech + b"\x00" * (2 * 24000)
            in_sec += len(pcm) / 48000
            for off in range(0, len(pcm), 48000):  # 1秒ずつ
                await ws.send(json.dumps({
                    "type": "input_audio_buffer.append",
                    "audio": base64.b64encode(pcm[off:off + 48000]).decode(),
                }))
            await ws.send(json.dumps({"type": "input_audio_buffer.commit"}))
            await ws.send(json.dumps({"type": "response.create"}))
            audio_bytes = 0
            while True:
                ev = json.loads(await asyncio.wait_for(ws.recv(), timeout=60))
                t = ev["type"]
                if t == "error":
                    raise SystemExit(f"API error: {ev}")
                if t == "response.output_audio.delta":
                    audio_bytes += len(base64.b64decode(ev["delta"]))
                if t == "response.done":
                    usage = ev["response"]["usage"]
                    cost = realtime_cost(args.model, usage)
                    total += cost
                    out_sec += audio_bytes / 48000
                    turns.append({"turn": i, "usage": usage, "usd": cost, "reply_sec": audio_bytes / 48000})
                    print(f"turn {i}: in={usage['input_tokens']} out={usage['output_tokens']} ${cost:.5f} (累計 ${total:.5f})")
                    break
            if total > args.max_usd:
                raise SystemExit(f"上限 ${args.max_usd} を超えたため中断")
    result = {
        "model": args.model, "scenario": args.scenario, "total_usd": total,
        "customer_audio_sec": in_sec, "ai_audio_sec": out_sec,
        "call_sec": in_sec + out_sec, "turns": turns,
    }
    out = f"results/{args.model}_{args.scenario}_{int(time.time())}.json"
    json.dump(result, open(out, "w"), ensure_ascii=False, indent=2)
    print(f"合計 ${total:.4f} / 通話 {in_sec + out_sec:.0f}秒 → 1分あたり ${total / ((in_sec + out_sec) / 60):.4f}")


asyncio.run(main())
