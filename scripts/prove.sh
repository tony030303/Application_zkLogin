#!/usr/bin/env bash
# Generates a sample valid witness + Groth16 proof, timing each step.
# Requires scripts/setup.sh to have been run first.
set -euo pipefail
cd "$(dirname "$0")/.."

mkdir -p build

echo "== Generating sample input =="
node scripts/gen_input.js > build/input.json

echo "== Calculating witness =="
time node build/sig_verify_js/generate_witness.js \
  build/sig_verify_js/sig_verify.wasm build/input.json build/witness.wtns

echo "== Generating Groth16 proof =="
time npx snarkjs groth16 prove build/sig_verify_final.zkey build/witness.wtns \
  build/proof.json build/public.json

echo "== Proof size (bytes) =="
wc -c < build/proof.json
