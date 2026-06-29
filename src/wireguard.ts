import { createPrivateKey, createPublicKey, generateKeyPairSync } from "node:crypto";

export type WireGuardKeyPair = {
  publicKey: string;
  privateKey: string;
};

function exportRawKey(material: Buffer): Buffer {
  return material.subarray(material.length - 32);
}

function buildX25519PrivateKeyDer(rawPrivateKey: Buffer): Buffer {
  const prefix = Buffer.from("302e020100300506032b656e04220420", "hex");
  return Buffer.concat([prefix, rawPrivateKey]);
}

export function deriveWireGuardPublicKey(privateKeyBase64: string): string {
  const rawPrivateKey = Buffer.from(privateKeyBase64, "base64");
  if (rawPrivateKey.length !== 32) {
    throw new Error("SERVER_PRIVATE_KEY must be a 32-byte base64 WireGuard key");
  }

  const privateKey = createPrivateKey({
    key: buildX25519PrivateKeyDer(rawPrivateKey),
    format: "der",
    type: "pkcs8",
  });
  const publicKey = createPublicKey(privateKey).export({
    format: "der",
    type: "spki",
  });

  return exportRawKey(Buffer.from(publicKey)).toString("base64");
}

export function createWireGuardKeyPair(): WireGuardKeyPair {
  const pair = generateKeyPairSync("x25519", {
    publicKeyEncoding: { format: "der", type: "spki" },
    privateKeyEncoding: { format: "der", type: "pkcs8" },
  }) as unknown as { publicKey: Buffer; privateKey: Buffer };

  return {
    publicKey: exportRawKey(Buffer.from(pair.publicKey)).toString("base64"),
    privateKey: exportRawKey(Buffer.from(pair.privateKey)).toString("base64"),
  };
}
