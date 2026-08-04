import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';

export interface PasswordDigest {
  digest: Buffer;
  salt: Buffer;
}

export async function createPasswordDigest(password: string): Promise<PasswordDigest> {
  const salt = randomBytes(16);
  return { salt, digest: await derivePasswordDigest(password, salt) };
}

export async function verifyPasswordDigest(
  password: string,
  digestSource: PasswordDigest,
): Promise<boolean> {
  const digest = await derivePasswordDigest(password, digestSource.salt);
  return (
    digest.length === digestSource.digest.length && timingSafeEqual(digest, digestSource.digest)
  );
}

export function randomPasswordDigest(): Promise<PasswordDigest> {
  return createPasswordDigest(randomBytes(32).toString('base64url'));
}

function derivePasswordDigest(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(
      password,
      salt,
      64,
      { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
      (error, derivedKey) => (error ? reject(error) : resolve(derivedKey)),
    );
  });
}
