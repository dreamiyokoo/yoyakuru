"""results/ の JSON を構成・台本ごとに集計し、Markdown の表を出力する。"""
import glob
import json
import os
from collections import defaultdict

YEN = 150
rows = defaultdict(dict)
for f in sorted(glob.glob("results/*.json")):
    r = json.load(open(f))
    conf = os.path.basename(f).rsplit("_", 1)[0].replace("_" + r["scenario"], "")
    rows[conf][r["scenario"]] = (r["total_usd"], r["call_sec"])

print("| 構成 | 台本 | 通話秒 | USD/通話 | 円/通話 | 円/分 |")
print("|---|---|---:|---:|---:|---:|")
for conf, sc in rows.items():
    usd = sum(v[0] for v in sc.values())
    sec = sum(v[1] for v in sc.values())
    for name, (u, s) in sc.items():
        print(f"| {conf} | {name} | {s:.0f} | {u:.4f} | {u * YEN:.1f} | {u * YEN / (s / 60):.1f} |")
    print(f"| **{conf}** | **平均（{len(sc)}本）** | {sec / len(sc):.0f} | {usd / len(sc):.4f} | "
          f"**{usd / len(sc) * YEN:.1f}** | **{usd * YEN / (sec / 60):.1f}** |")
