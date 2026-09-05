#!/usr/bin/env bash
# Verifies build/proof.json against build/public.json, timing the check.
# Requires scripts/prove.sh to have been run first.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== Verifying Groth16 proof =="
time npx snarkjs groth16 verify build/verification_key.json build/public.json build/proof.json
