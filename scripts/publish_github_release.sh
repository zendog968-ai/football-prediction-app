#!/usr/bin/env bash
set -euo pipefail

BUILD_DIR=${1:?usage: publish_github_release.sh <validated-build-dir>}
VERSION_TAG="data-$(date -u +%Y%m%dT%H%M%SZ)-${GITHUB_SHA:0:7}"
LATEST_TAG="data-latest"
required=("${BUILD_DIR}/football_data_expanded.db" "${BUILD_DIR}/model/soccer_predict_model.pkl" "${BUILD_DIR}/model_performance_filters.json" "${BUILD_DIR}/pipeline_status.json")
for asset in "${required[@]}"; do
  test -s "${asset}" || { echo "Missing validated asset: ${asset}" >&2; exit 1; }
done

if ! gh release view "${VERSION_TAG}" >/dev/null 2>&1; then
  gh release create "${VERSION_TAG}" --title "Aurelia Football ${VERSION_TAG}" --notes "Automated, validated public-data release."
fi

gh release upload "${VERSION_TAG}" --clobber \
  "${BUILD_DIR}/football_data_expanded.db#football_data_expanded.db" \
  "${BUILD_DIR}/model/soccer_predict_model.pkl#soccer_predict_model.pkl" \
  "${BUILD_DIR}/model_performance_filters.json#model_performance_filters.json"

python3 - "${BUILD_DIR}/pipeline_status.json" "${VERSION_TAG}" <<'PY'
import json
import sys
from pathlib import Path

path = Path(sys.argv[1])
payload = json.loads(path.read_text(encoding="utf-8"))
payload["release_tag"] = sys.argv[2]
path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
PY

if ! gh release view "${LATEST_TAG}" >/dev/null 2>&1; then
  gh release create "${LATEST_TAG}" --title "Aurelia Football current data pointer" --notes "Points to the latest fully validated immutable release."
fi
gh release upload "${LATEST_TAG}" --clobber "${BUILD_DIR}/pipeline_status.json#pipeline_status.json"
