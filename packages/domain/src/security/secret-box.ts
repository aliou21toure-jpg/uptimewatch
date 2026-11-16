import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM envelope: [version:1][iv:12][tag:16][ciphertext].
 * The associated data binds a ciphertext to its row (e.g. `orgId:monitorId`), so copying an
 * encrypted value onto another row — or into another organization — makes decryption fail.
 */
const VERSION = 1;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

export function seal(plaintext: string, key: Buffer, associatedData: string): Buffer {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(associatedData, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), ciphertext]);
}

export function open(envelope: Buffer, key: Buffer, associatedData: string): string {
  if (envelope.length < 1 + IV_LENGTH + TAG_LENGTH || envelope[0] !== VERSION) {
    throw new Error("Unsupported secret envelope");
  }
  const iv = envelope.subarray(1, 1 + IV_LENGTH);
  const tag = envelope.subarray(1 + IV_LENGTH, 1 + IV_LENGTH + TAG_LENGTH);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(Buffer.from(associatedData, "utf8"));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(envelope.subarray(1 + IV_LENGTH + TAG_LENGTH)), decipher.final()]).toString("utf8");
}
