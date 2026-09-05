const circomlibjs = require("circomlibjs");

// Deterministic-ish test key material. In a real deployment the "signer"
// stands in for the OpenID Provider's signing key (cf. zkLogin's pk_OP).
async function buildSigner() {
  const eddsa = await circomlibjs.buildEddsa();
  const F = eddsa.F;
  const privKey = Buffer.from(
    "0001020304050607080900010203040506070809000102030405060708090a",
    "hex"
  );
  const pubKey = eddsa.prv2pub(privKey);
  return { eddsa, F, privKey, pubKey };
}

async function buildPoseidon() {
  return circomlibjs.buildPoseidon();
}

// Signs `msg` (a field element, e.g. a Poseidon hash of the "claims") and
// returns the witness components expected by circuits/sig_verify.circom.
async function signMessage({ eddsa, F, privKey }, msgField) {
  const signature = eddsa.signPoseidon(privKey, F.e(msgField));
  return {
    R8x: F.toObject(signature.R8[0]).toString(),
    R8y: F.toObject(signature.R8[1]).toString(),
    S: signature.S.toString(),
  };
}

function pubKeyToFieldStrings({ eddsa, F, pubKey }) {
  return {
    pubKeyX: F.toObject(pubKey[0]).toString(),
    pubKeyY: F.toObject(pubKey[1]).toString(),
  };
}

module.exports = { buildSigner, buildPoseidon, signMessage, pubKeyToFieldStrings };
