pragma circom 2.1.6;

include "../node_modules/circomlib/circuits/eddsaposeidon.circom";
include "../node_modules/circomlib/circuits/poseidon.circom";

// SigVerify
// -----------------------------------------------------------------------
// Mirrors the core statement of zkLogin (Baldimtsi et al., CCS'24, Fig. 7):
//
//   zkLogin's Ckt proves:
//     zkaddr == H(stid, aud, iss, salt)   AND   JWT.Verify(pk_OP, jwt)
//
// Here we prove the same *shape* of statement, but replace the JWT's
// RSA-2048 + SHA-256 signature (not ZK-friendly, ~80% of the paper's
// circuit constraints, cf. Section 5.1.1) with an EdDSA signature over
// Poseidon (ZK-friendly natively). This is a minimal testbed for the
// "ZK-friendly primitives" extension discussed in the README.
//
//   addr == Poseidon(pubKeyX, pubKeyY, salt)   AND   EdDSA-Poseidon.Verify(pk, msg, sig)
//
// Public inputs:
//   msg      - Poseidon hash standing in for the signed claim set
//   pubKeyX,
//   pubKeyY  - signer's (the "OP"'s) EdDSA public key
//   salt     - persistent randomness (unlinkability, as in the paper's Eq. 1)
//   addr     - claimed address, must equal Poseidon(pubKeyX, pubKeyY, salt)
//
// Private witness:
//   R8x, R8y, S - the EdDSA signature over msg
// -----------------------------------------------------------------------
template SigVerify() {
    // Public inputs
    signal input msg;
    signal input pubKeyX;
    signal input pubKeyY;
    signal input salt;
    signal input addr;

    // Private witness (the signature = the "JWT" in zkLogin terms)
    signal input R8x;
    signal input R8y;
    signal input S;

    // 1. Verify the EdDSA-Poseidon signature over msg.
    //    This plays the role of JWT.Verify(pk_OP, jwt) in the paper.
    component verifier = EdDSAPoseidonVerifier();
    verifier.enabled <== 1;
    verifier.Ax <== pubKeyX;
    verifier.Ay <== pubKeyY;
    verifier.R8x <== R8x;
    verifier.R8y <== R8y;
    verifier.S <== S;
    verifier.M <== msg;

    // 2. Verify the address binds (pubKey, salt), analogous to
    //    zkaddr = H(stid, aud, iss, salt) in the paper (Eq. 1).
    component hasher = Poseidon(3);
    hasher.inputs[0] <== pubKeyX;
    hasher.inputs[1] <== pubKeyY;
    hasher.inputs[2] <== salt;

    addr === hasher.out;
}

component main {public [msg, pubKeyX, pubKeyY, salt, addr]} = SigVerify();
