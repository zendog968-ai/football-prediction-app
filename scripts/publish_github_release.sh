#!/usr/bin/env bash
set -euo pipefail

BUILD_DIR=${1:?usage: publish_github_release.sh <validated-build-dir>}
VERSION_TAG="data-$(date -u +%Y%m%dT%H%M%SZ)-${GITHUB_SHA:0:7}"
LATEST_TAG="data-latest"
required=("${BUILD_DIR}/football_data_expanded.db" "${BUILD_DIR}/model/soccer_predict_model.pkl" "${BUILD_DIR}/model_performance_filters.json" "${BUILD_DIR}/pipeline_status.json")
for asset in "${required[@]}"; do
  test -s "${asset}" || { echo "Missing validated asset: ${asset}" >&2; exit 1; }
done

function gh_retry() {
  local n=1
  local max=3
  local delay=15
  while true; do
    "$@" && break || {
      if [[ $n -lt $max ]]; then
        ((n++))
        echo "Command failed. Attempt $n/$max in $delay seconds..."
        sleep $delay
      else
        echo "The command has failed after $n attempts."
        return 1
      fi
    }
  done
}

if ! gh release view "${VERSION_TAG}" >/dev/null 2>&1; then
  gh_retry gh release create "${VERSION_TAG}" --title "Aurelia Football ${VERSION_TAG}" --notes "Automated, validated public-data release."
fi

gh_retry gh release upload "${VERSION_TAG}" --clobber \
  "${BUILD_DIR}/football_data_expanded.db#football_data_expanded.db" \
  "${BUILD_DIR}/model/soccer_predict_model.pkl#soccer_predict_model.pkl" \
  "${BUILD_DIR}/model_performance_filters.json#model_performance_filters.json"

python3 data-pipeline/finalize_release_manifest.py --manifest "${BUILD_DIR}/pipeline_status.json" --release-tag "${VERSION_TAG}"

if ! gh release view "${LATEST_TAG}" >/dev/null 2>&1; then
  gh_retry gh release create "${LATEST_TAG}" --title "Aurelia Football current data pointer" --notes "Points to the latest fully validated immutable release."
fi
gh_retry gh release upload "${LATEST_TAG}" --clobber "${BUILD_DIR}/pipeline_status.json#pipeline_status.json"
