# zkLogin: Final Project

> Coursework project extending **zkLogin: Privacy-Preserving Blockchain
> Authentication with Existing Credentials** (Baldimtsi et al., ACM CCS 2024).
> link to the paper: https://arxiv.org/pdf/2401.11735

> Authors: Sthefany Cedeño, Antonio Sarmiento

> Professor: Marco Zecchini

> Project Submission: September 10, 2026.

![CI](https://github.com/tony030303/Application_zkLogin/actions/workflows/ci.yml/badge.svg)

---

## 1. The application

zkLogin solves the problem of **onboarding users onto a blockchain wallet without
forcing them to manage a new private key**. Instead, it lets a user authenticate
and authorize transactions using an OpenID Connect account they already have
(Google, Facebook, etc.), while keeping their off-chain identity hidden from the
(fully public) blockchain state.

**Role of the ZKP:** the OpenID Provider (OP) issues a signed JWT after login.
Sending that JWT to the chain directly would leak sensitive claims (name,
email, profile picture). zkLogin instead has the user prove, in zero
knowledge, that they hold a valid JWT that (a) was signed by the OP and (b)
binds an ephemeral public key the user controls — without revealing the JWT
itself.

**What is proven, by whom, to whom:**

- **Prover:** the user (or a delegated proving service acting on the user's
  behalf, which never learns the user's ephemeral private key).
- **Verifier:** the blockchain's validators.
- **Statement (public):** the OP's public key, the issuer id, the claimed
  blockchain address `zkaddr`, the ephemeral public key `vk_u`, and its
  expiry time.
- **Witness (private):** the JWT, the salt, and the randomness used to build
  the OpenID nonce.
- **Trust assumptions:** the OpenID Provider and the application's front-end
  are trusted; the application's back-end and any delegated proving/salt
  service are _not_ trusted for security (at most for liveness or, in weaker
  configurations, for privacy).

## 2. The proof system and framework

The paper uses **Groth16** as the zk-SNARK, implemented with **circom** and **snarkjs** / **rapidsnark** (witness calculation and proving). Relevant
properties:

- **Trusted setup:** circuit-specific (Groth16 requires a per-circuit CRS).
  The authors mitigate this with a multi-party ceremony (100+ contributors,
  paper Appendix D) rather than a transparent setup.
- **Proof size:** compact — a few hundred bytes of raw Groth16 proof (the
  full zkLogin signature, including the ephemeral signature, is ~1300 bytes
  base64-encoded).
- **Verifier cost:** a small, constant number of pairings — ~2ms in the
  paper's benchmarks, independent of circuit size.
- **Recursion support:** none in the paper's design; each user generates an
  independent proof, there is no proof aggregation/recursion.
- The main bottleneck in the paper's circuit (~1.1M R1CS constraints) is
  **SHA-256 + RSA-2048 signature verification** (~80% of constraints),
  because JWTs use non-ZK-friendly primitives.

## 3. What can be improved / extensions

Limitations identified in the paper's construction:

| Limitation                                                   | Consequence                                               |
| ------------------------------------------------------------ | --------------------------------------------------------- |
| SHA-256 + RSA verification dominate the circuit              | Slow proving, especially on constrained devices           |
| Circuit-specific trusted setup (Groth16)                     | Any circuit change requires re-running the ceremony       |
| Only RS256 JWTs supported                                    | Providers using ES256-only tokens are excluded            |
| "Normal" proof delegation reveals JWT+salt to the ZK service | Breaks unlinkability against that service                 |
| No proof aggregation across users/transactions               | Verification cost scales linearly with transaction volume |

**Proposed extensions** (motivation for each):

1. **Replace RSA/SHA-256 with ZK-friendly primitives** (EdDSA + Poseidon) to
   shrink the circuit and proving time — motivated directly by the paper's
   own observation that SHA-256/RSA account for ~80% of constraints.
2. Transparent/universal setup (Plonk/Halo2) to remove the per-circuit
   ceremony — motivated by reducing operational/trust overhead.
3. Proof aggregation/batching at the validator level — motivated by the
   paper's own measured ~11% validator throughput drop under load.

## 4. Feasibility analysis

| Extension                                                                        | Category                  | Rationale                                                                                                             |
| -------------------------------------------------------------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| ZK-friendly signature (EdDSA-Poseidon) instead of RSA/SHA-256                    | **Implemented**           | Small, self-contained circuit change; directly measurable constraint/time reduction; doable in the project timeframe. |
| Transparent setup (Plonk/Halo2)                                                  | Feasible but out of scope | Would require re-deriving the whole proving pipeline and tooling; substantial engineering effort.                     |
| Full-private (MPC) delegation of proving                                         | Feasible but out of scope | The paper already sketches this; implementing a secure MPC proving committee is a multi-week systems effort.          |
| Cross-transaction / cross-user proof aggregation with formal security guarantees | Open research problem     | Requires new unforgeability definitions and aggregation-friendly SNARK constructions; not solved by existing tooling. |

## 5. Our implementation

We implemented a **minimal circom circuit** (`circuits/sig_verify.circom`)
that mirrors zkLogin's core statement (`Ckt` in Fig. 7 of the paper) but
swaps RSA-2048 + SHA-256 JWT verification for an **EdDSA signature over
Poseidon**, using [circomlib](https://github.com/iden3/circomlib)'s
`EdDSAPoseidonVerifier` and `Poseidon` templates:

```
addr == Poseidon(pubKeyX, pubKeyY, salt)      // analogous to zkaddr = H(stid, aud, iss, salt)
AND EdDSA-Poseidon.Verify(pubKey, msg, sig)   // analogous to JWT.Verify(pk_OP, jwt)
```

**Framework:** circom 2.2.3 + snarkjs (same ecosystem as the paper, chosen
for direct comparability and mature tooling) + circomlib for the EdDSA/Poseidon
gadgets.

**Deviations from the original plan:** we did not implement JWT
parsing/base64 decoding (the most implementation-heavy part of the paper's
circuit, Section 5.1.2) — our `msg` public input is a stand-in for a
committed claim set, since the parsing logic is orthogonal to the
RSA→EdDSA substitution we wanted to measure.

**Correctness testing** (`test/completeness_soundness.test.js`, run via
`circom_tester`):

- **Completeness:** a valid witness (correct signature + correctly bound
  address) produces a satisfying assignment (`checkConstraints` passes).
- **Soundness:** three negative cases each fail witness calculation /
  constraint checking — a tampered signature scalar, a signature from an
  unrelated key, and an address that doesn't match `H(pubKey, salt)`. This
  models unforgeability at the circuit level: without a valid witness, no
  accepting witness assignment (and therefore no valid proof) exists.

CI: `.github/workflows/ci.yml` runs circuit compilation + these tests on
every push. [CI link/badge above.]

## 6. Performance

**Hardware used:** Intel Core Ultra 9 185H (22 logical CPUs), Windows 10.0.26200 x64, Node v22.14.0, circom 2.2.3.

| Metric                  | This implementation (EdDSA-Poseidon) | zkLogin paper (RSA-2048 + SHA-256)           |
| ----------------------- | ------------------------------------ | -------------------------------------------- |
| R1CS constraints        | ~8,700                               | ~1,100,000                                   |
| Witness generation time | 265.7 ms ± 12.2 ms                   | not separately reported                      |
| Proving time            | 1047.3 ms ± 54.7 ms                  | 2.1s ± 0.15s (server-side, delegated)        |
| Verification time       | 29.2 ms ± 4.8 ms                     | 2.04 ms (Apple M1 Pro)                       |
| Proof size              | ~724 bytes (constant across runs)    | ~1300 bytes (base64, full zkLogin signature) |

\*20 runs total; run 0 excluded from the proving average (JIT/WASM warm-up:
2196 ms vs. ~1000-1200 ms steady-state), run 11 excluded from the
verification average (148 ms outlier, likely a GC/OS scheduling pause).

**Interpretation:**

Our proof is generated roughly 2x faster than in the paper (1.05s vs.
2.1s), which is consistent with our circuit having ~130x fewer constraints
(~8,700 vs. ~1.1M).

Verification, on the other hand, is slower for us than in the paper (29ms
vs. 2.04ms), even though Groth16's verification cost is constant and
independent of circuit size, since it depends only on a fixed number of
pairings over the public signals. This suggests the difference isn't
explained by the circuit itself, but by the execution environment: we ran
snarkjs over JS/WASM on Node under Windows, whereas the paper likely uses
a native, optimized implementation (and possibly different hardware, such
as an Apple M1 with pairing acceleration).

Finally, proof size stays essentially constant (~724 bytes) across all 20
runs, which confirms exactly the Groth16 property the paper points to:
proof size does not depend on circuit size.

## Repository structure

```
circuits/sig_verify.circom     # the ZK circuit (statement described in §1)
test/                          # completeness & soundness tests (circom_tester)
scripts/setup.sh               # compile + local trusted setup (Groth16)
scripts/prove.sh               # generate a sample proof, with timing
scripts/verify.sh              # verify a generated proof, with timing
scripts/benchmark.js           # run N proofs, write raw CSV measurements
benchmarks/                    # generated execution metrics (CSV) and hardware metadata (JSON)
.github/workflows/ci.yml       # CI: compile + run tests on every push

```

## Build & run instructions

```bash
npm install
# Install circom 2.x (prebuilt binary; adjust OS/arch as needed):
curl -sL https://github.com/iden3/circom/releases/download/v2.2.3/circom-linux-amd64 -o /usr/local/bin/circom
chmod +x /usr/local/bin/circom

# 1. Circuit-only correctness tests (fast, no trusted setup needed)
npx mocha test/completeness_soundness.test.js --timeout 120000

# 2. Full pipeline: compile, trusted setup, prove, verify
bash scripts/setup.sh
bash scripts/prove.sh
bash scripts/verify.sh

# 3. Benchmarks (raw measurements -> build/benchmark_results.csv)
node scripts/benchmark.js 20
```
