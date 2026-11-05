"""USD per 1M tokens。出典: https://developers.openai.com/api/docs/pricing (2026-11-05 確認)"""

REALTIME = {
    # model: (audio_in, audio_cached_in, audio_out, text_in, text_cached_in, text_out)
    "gpt-realtime": (32.0, 0.40, 64.0, 4.0, 0.40, 16.0),
    "gpt-realtime-1.5": (32.0, 0.40, 64.0, 4.0, 0.40, 16.0),
    "gpt-realtime-2": (32.0, 0.40, 64.0, 4.0, 0.40, 24.0),
    "gpt-realtime-2.1": (32.0, 0.40, 64.0, 4.0, 0.40, 24.0),
    "gpt-realtime-2.1-mini": (10.0, 0.30, 20.0, 0.60, 0.06, 2.40),
    "gpt-realtime-mini": (10.0, 0.30, 20.0, 0.60, 0.06, 2.40),
}


def realtime_cost(model: str, usage: dict) -> float:
    """response.done の usage から USD を計算する。"""
    a_in, a_c, a_out, t_in, t_c, t_out = REALTIME[model]
    d = usage["input_token_details"]
    cached = d.get("cached_tokens_details", {})
    c_audio, c_text = cached.get("audio_tokens", 0), cached.get("text_tokens", 0)
    o = usage["output_token_details"]
    total = (
        (d.get("audio_tokens", 0) - c_audio) * a_in
        + c_audio * a_c
        + (d.get("text_tokens", 0) - c_text) * t_in
        + c_text * t_c
        + o.get("audio_tokens", 0) * a_out
        + o.get("text_tokens", 0) * t_out
    )
    return total / 1_000_000
