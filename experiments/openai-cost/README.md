# AI電話の原価検証（OpenAI音声API）

Issue #1 の検証用スクリプト。電話回線は使わず、客側の日本語音声をAPIに送って `usage` から金額を計算する。結果の整理は [docs/costs.md](../../docs/costs.md) を参照。

## ファイル

| ファイル | 内容 |
|---|---|
| `scenarios.py` | 受付AIの指示文と、台本6本の客側の発話 |
| `gen_audio.py` | 客側の発話を `gpt-4o-mini-tts` で PCM16 24kHz に変換し `audio/` に保存（Git 対象外） |
| `run_call.py` | Realtime API に1通話分を流し、ターンごとの usage と金額を `results/` に保存 |
| `run_pipeline.py` | 組み合わせ構成（音声認識→テキストAI→音声合成）で同じ台本を流す |
| `pricing.py` | Realtime モデルの単価（2026-11-05 確認） |
| `summarize.py` | `results/` を集計して Markdown の表を出力 |
| `run.sh` | `.env` の `OPENAI_API_KEY` を渡して `python:3.12-slim` コンテナで実行する |

## 実行

```bash
./run.sh gen_audio.py
./run.sh run_call.py gpt-realtime-2.1-mini new_booking --max-usd 0.5
./run.sh run_pipeline.py new_booking
python3 summarize.py
```

`--max-usd` を超えると通話の途中で中断する。2026-11-05 の全計測（3構成×6本）の API 代は合計約0.75 USD。

## 前提と限界

- Realtime は、各発話の前に「直前のAI返答の長さ＋2秒」、後に2秒の無音を入れる。実回線では AI の発話中や無音の間も入力音声が流れ続けるため。
- 客の発話は固定で、AI の返答に応じて変えない。
- `gpt-4o-mini-tts` は usage を返さないため、出力音声トークン数は Realtime の実測（トークン/秒）から推定する。
- 日本語の聞き取りと応答の品質は評価していない。
