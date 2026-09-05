// Generates build/input.json: a valid witness for circuits/sig_verify.circom
// (used by scripts/prove.sh). Run with: node scripts/gen_input.js > build/input.json
const path = require("path");
const { buildSigner, buildPoseidon, signMessage, pubKeyToFieldStrings } = require(
  path.join(__dirname, "..", "test", "helpers.js")
);

(async () => {
  const signer = await buildSigner();
  const poseidon = await buildPoseidon();
  const F = poseidon.F;

  const msg = "12345";
  const salt = "999";
  const { pubKeyX, pubKeyY } = pubKeyToFieldStrings(signer);
  const sig = await signMessage(signer, msg);
  const addr = F.toObject(poseidon([BigInt(pubKeyX), BigInt(pubKeyY), BigInt(salt)])).toString();

  const input = { msg, pubKeyX, pubKeyY, salt, addr, ...sig };
  process.stdout.write(JSON.stringify(input, null, 2) + "\n");
})();
