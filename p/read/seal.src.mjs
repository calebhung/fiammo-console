// fiammo — seals a reply written in the browser to the post author's
// identity key, in the same shape the app's DMs use (DM_ENCRYPTION_SPEC.md,
// "Message format"): a fresh AES-256-GCM content key over the JSON payload,
// and that key wrapped with HPKE (X25519, HKDF-SHA256, ChaCha20-Poly1305,
// CryptoKit's Curve25519_SHA256_ChachaPoly) to the author. Base mode, not
// auth mode: the reader has no identity key of their own to authenticate
// with. What proves who wrote it is the phone code the server checked.
import { CipherSuite, HkdfSha256 } from "@hpke/core";
import { DhkemX25519HkdfSha256 } from "@hpke/dhkem-x25519";
import { Chacha20Poly1305 } from "@hpke/chacha20poly1305";

const suite = new CipherSuite({
  kem: new DhkemX25519HkdfSha256(),
  kdf: new HkdfSha256(),
  aead: new Chacha20Poly1305(),
});

const enc = new TextEncoder();
const b64 = (buf) => {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
};
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export function binding(answerId, linkId, ownerId) {
  return `fiammo-tl-v1|${answerId}|${linkId}|${ownerId}`.toLowerCase();
}

export async function sealReply({ publicKey, keyId, ownerId, linkId, answerId, body }) {
  const bind = binding(answerId, linkId, ownerId);
  const owner = ownerId.toLowerCase();

  const rawKey = crypto.getRandomValues(new Uint8Array(32));
  const aesKey = await crypto.subtle.importKey("raw", rawKey, "AES-GCM", false, ["encrypt"]);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, additionalData: enc.encode(bind) },
    aesKey, enc.encode(JSON.stringify({ body })));
  // CryptoKit's AES.GCM.SealedBox(combined:) is nonce | ciphertext | tag,
  // which is WebCrypto's output (ciphertext | tag) with the nonce in front.
  const combined = new Uint8Array(12 + sealed.byteLength);
  combined.set(nonce, 0);
  combined.set(new Uint8Array(sealed), 12);

  const recipientPublicKey = await suite.kem.deserializePublicKey(unb64(publicKey));
  const sender = await suite.createSenderContext({
    recipientPublicKey,
    info: enc.encode(`${bind}|wrap|${owner}`),
  });
  const wrapped = await sender.seal(rawKey);

  return {
    ciphertext: b64(combined),
    envelope: { v: 1, mode: "base", keys: { [owner]: { kid: keyId, enc: b64(sender.enc), ct: b64(wrapped) } } },
  };
}

window.fiammoSeal = { sealReply };
