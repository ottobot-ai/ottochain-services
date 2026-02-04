// Metakit SDK utilities (from @constellation-labs/metakit-sdk)
// Copied locally until the SDK is published to npm

export { sign, signDataUpdate, signHash } from './sign.js';
export { canonicalize } from './canonicalize.js';
export { generateKeyPair, keyPairFromPrivateKey, getPublicKeyId, getAddress } from './wallet.js';
export type { SignatureProof, Signed, KeyPair } from './types.js';
