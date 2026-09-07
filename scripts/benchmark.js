// Benchmarks witness generation, proving and verification time over N runs
// and writes raw measurements to build/benchmark_results.csv (as required
// by the deliverable: "benchmark scripts and raw measurements").
//
// Usage: node scripts/benchmark.js [N]
// Requires scripts/setup.sh to have been run first.
const fs = require("fs");
const path = require("path");
const os = require("os");
const snarkjs = require("snarkjs");
const { execSync } = require("child_process");
const { buildSigner, buildPoseidon, signMessage, pubKeyToFieldStrings } = require(
  path.join(__dirname, "..", "test", "helpers.js")
);

const N = parseInt(process.argv[2] || "10", 10);
const BUILD = path.join(__dirname, "..", "build");
const WASM = path.join(BUILD, "sig_verify_js", "sig_verify.wasm");
const ZKEY = path.join(BUILD, "sig_verify_final.zkey");
const VKEY = JSON.parse(fs.readFileSync(path.join(BUILD, "verification_key.json")));
const BENCHMARKS = path.join(__dirname, "..", "benchmarks");

if (!fs.existsSync(BENCHMARKS)) {
  fs.mkdirSync(BENCHMARKS, { recursive: true });
}

function now() {
  return Number(process.hrtime.bigint()) / 1e6; // ms
}

async function main() {
  const signer = await buildSigner();
  const poseidon = await buildPoseidon();
  const F = poseidon.F;
  const { pubKeyX, pubKeyY } = pubKeyToFieldStrings(signer);

  const rows = [["run", "witness_ms", "prove_ms", "verify_ms", "proof_size_bytes"]];

  for (let i = 0; i < N; i++) {
    const msg = (1000 + i).toString();
    const salt = (500 + i).toString();
    const sig = await signMessage(signer, msg);
    const addr = F.toObject(poseidon([BigInt(pubKeyX), BigInt(pubKeyY), BigInt(salt)])).toString();
    const input = { msg, pubKeyX, pubKeyY, salt, addr, ...sig };

    const t0 = now();
    const wtnsPath = path.join(BUILD, `bench_witness_${i}.wtns`);
    await snarkjs.wtns.calculate(input, WASM, wtnsPath);
    const t1 = now();
    const { proof, publicSignals } = await snarkjs.groth16.prove(ZKEY, wtnsPath);
    const t2 = now();
    const ok = await snarkjs.groth16.verify(VKEY, publicSignals, proof);
    const t3 = now();
    fs.unlinkSync(wtnsPath);

    if (!ok) throw new Error(`Verification failed on run ${i}`);

    const proofBytes = Buffer.byteLength(JSON.stringify(proof));
    rows.push([i, (t1 - t0).toFixed(2), (t2 - t1).toFixed(2), (t3 - t2).toFixed(2), proofBytes]);
    console.log(`run ${i}: prove=${(t2 - t1).toFixed(1)}ms verify=${(t3 - t2).toFixed(1)}ms`);
  }

  const csv = rows.map((r) => r.join(",")).join("\n") + "\n";
  fs.writeFileSync(path.join(BENCHMARKS, "benchmark_results.csv"), csv);

  const meta = {
    node: process.version,
    platform: `${os.type()} ${os.release()} ${os.arch()}`,
    cpus: os.cpus().map((c) => c.model)[0],
    cpu_count: os.cpus().length,
    circom_version: execSync("circom --version").toString().trim(),
    runs: N,
  };
  fs.writeFileSync(path.join(BENCHMARKS, "benchmark_meta.json"), JSON.stringify(meta, null, 2));

  console.log("\nSaved benchmarks/benchmark_results.csv and benchmarks/benchmark_meta.json");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
