#!/bin/bash
# usage: ./run.sh gen_audio.py | ./run.sh run_call.py gpt-realtime-2.1-mini new_booking
set -euo pipefail
cd "$(dirname "$0")"
set -a; . ../../.env; set +a
docker run --rm -e OPENAI_API_KEY -v "$PWD":/w -w /w -u "$(id -u):$(id -g)" -e HOME=/tmp -e PIP_CACHE_DIR=/tmp/pip \
  python:3.12-slim sh -c 'pip install -q --user websockets requests 2>&1 | grep -v WARNING || true; PATH=$PATH:/tmp/.local/bin PYTHONPATH=/tmp/.local/lib/python3.12/site-packages python "$@"' _ "$@"
