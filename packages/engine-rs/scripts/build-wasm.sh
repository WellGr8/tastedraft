#!/usr/bin/env bash
# Rebuild the committed WebAssembly packages from packages/engine-rs.
# A machine without Rust can skip this script and use packages/engine-wasm/pkg.
# When rustup or wasm-pack is missing, this script installs them.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export PATH="${CARGO_HOME:-$HOME/.cargo}/bin:/usr/local/cargo/bin:${PATH}"

if ! command -v rustup >/dev/null 2>&1; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable
  # shellcheck disable=SC1090
  source "${CARGO_HOME:-$HOME/.cargo}/env"
fi

if ! rustup target list --installed | grep -q '^wasm32-unknown-unknown$'; then
  rustup target add wasm32-unknown-unknown
fi

if ! command -v wasm-pack >/dev/null 2>&1; then
  curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh
fi

wasm-pack build --release --target nodejs --out-dir ../engine-wasm/pkg/nodejs
wasm-pack build --release --target web --out-dir ../engine-wasm/pkg/web

note='# Built output is committed so the engine loads without a Rust toolchain.'
printf '%s\n' "$note" > ../engine-wasm/pkg/nodejs/.gitignore
printf '%s\n' "$note" > ../engine-wasm/pkg/web/.gitignore
