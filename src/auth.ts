import { createHmac, timingSafeEqual } from "node:crypto";

function sign(secret: string, parts: string[]): string {
  return createHmac("sha256", secret).update(parts.join("|")).digest("base64url");
}

export function createGatewayRequestSignature(secret: string, parts: string[]): string {
  return sign(secret, parts);
}

export function verifyGatewaySignature(secret: string, parts: string[], signature: string): boolean {
  const expected = Buffer.from(sign(secret, parts), "utf8");
  const actual = Buffer.from(signature, "utf8");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
