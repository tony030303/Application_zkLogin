#!/usr/bin/env bash
# Compiles circuits/sig_verify.circom and runs a LOCAL, insecure trusted
# setup (single contribution). This is fine for coursework/benchmarking;
# it is NOT a substitute for a real multi-party ceremony like the one the
# zkLogin authors ran (paper, Appendix D).
set -euo pipefail
cd "$(dirname "$0")/.."

CIRCOM_BIN="${CIRCOM_BIN:-circom}"
PTAU_POWER=14   # 2^14 = 16384 >= constraints in sig_verify.circom (~8.7k)

mkdir -p build

echo "== 1. Compiling circuit =="
"$CIRCOM_BIN" circuits/sig_verify.circom --r1cs --wasm --sym -o build

echo "== 2. Powers of Tau (phase 1, generic) =="
npx snarkjs powersoftau new bn128 "$PTAU_POWER" build/pot_0000.ptau -v
npx snarkjs powersoftau contribute build/pot_0000.ptau build/pot_0001.ptau \
  --name="local contribution" -v -e="$(head -c 64 /dev/urandom | base64)"
npx snarkjs powersoftau prepare phase2 build/pot_0001.ptau build/pot_final.ptau -v

echo "== 3. Groth16 setup (phase 2, circuit-specific) =="
npx snarkjs groth16 setup build/sig_verify.r1cs build/pot_final.ptau build/sig_verify_0000.zkey
npx snarkjs zkey contribute build/sig_verify_0000.zkey build/sig_verify_final.zkey \
  --name="local contribution" -v -e="$(head -c 64 /dev/urandom | base64)"
npx snarkjs zkey export verificationkey build/sig_verify_final.zkey build/verification_key.json

echo "== Done. Artifacts in build/ =="
ls -la build
