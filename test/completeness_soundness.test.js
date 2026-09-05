const path = require("path");
const { expect } = require("chai");
const wasm_tester = require("circom_tester").wasm;
const { buildSigner, buildPoseidon, signMessage, pubKeyToFieldStrings } = require("./helpers");

// These tests check the circuit itself (circuits/sig_verify.circom) at the
// R1CS witness level, independent of the Groth16 setup/proving artifacts.
//
// - "Completeness": a valid witness (valid signature + correct address
//   binding) must produce a satisfying witness assignment.
// - "Soundness" (circuit-level): an invalid witness (tampered signature,
//   wrong signer, or wrong address) must fail witness calculation, i.e. it
//   violates the circuit's constraints and therefore no proof can be
//   produced for it. This mirrors zkLogin's unforgeability requirement
//   (Def. 6 in the paper): without a valid witness, no accepting
//   proof/signature exists.
//
// See scripts/prove.sh + scripts/verify.sh for the full end-to-end
// Groth16 proof generation/verification against the compiled zkey.

describe("SigVerify circuit — completeness and soundness", function () {
  this.timeout(120000);

  let circuit, signer, poseidon, F;

  before(async () => {
    circuit = await wasm_tester(path.join(__dirname, "..", "circuits", "sig_verify.circom"));
    signer = await buildSigner();
    poseidon = await buildPoseidon();
    F = poseidon.F;
  });

  async function validInput(msgValue = 12345n, saltValue = 999n) {
    const msg = msgValue.toString();
    const salt = saltValue.toString();
    const { pubKeyX, pubKeyY } = pubKeyToFieldStrings(signer);
    const sig = await signMessage(signer, msg);
    const addr = F.toObject(
      poseidon([BigInt(pubKeyX), BigInt(pubKeyY), BigInt(salt)])
    ).toString();
    return { msg, pubKeyX, pubKeyY, salt, addr, ...sig };
  }

  it("[completeness] accepts a valid signature + correctly bound address", async () => {
    const input = await validInput();
    const witness = await circuit.calculateWitness(input, true);
    await circuit.checkConstraints(witness);
    // sanity check: witness[0] is always 1 by convention
    expect(witness[0]).to.equal(1n);
  });

  it("[soundness] rejects a tampered signature (wrong S)", async () => {
    const input = await validInput();
    input.S = (BigInt(input.S) + 1n).toString(); // flip the signature scalar
    let threw = false;
    try {
      const witness = await circuit.calculateWitness(input, true);
      await circuit.checkConstraints(witness);
    } catch (e) {
      threw = true;
    }
    expect(threw, "circuit should reject a tampered signature").to.equal(true);
  });

  it("[soundness] rejects a signature from a different signer", async () => {
    const input = await validInput();
    // substitute an unrelated public key while keeping the original signature
    input.pubKeyX = (BigInt(input.pubKeyX) + 7n).toString();
    let threw = false;
    try {
      const witness = await circuit.calculateWitness(input, true);
      await circuit.checkConstraints(witness);
    } catch (e) {
      threw = true;
    }
    expect(threw, "circuit should reject a mismatched public key").to.equal(true);
  });

  it("[soundness] rejects a witness whose address does not match H(pubKey, salt)", async () => {
    const input = await validInput();
    input.addr = (BigInt(input.addr) + 1n).toString(); // wrong claimed address
    let threw = false;
    try {
      const witness = await circuit.calculateWitness(input, true);
      await circuit.checkConstraints(witness);
    } catch (e) {
      threw = true;
    }
    expect(threw, "circuit should reject an incorrectly bound address").to.equal(true);
  });
});
