import { scryptSync, timingSafeEqual } from "node:crypto";

// Passwords set before Spoonjoy moved off RedwoodJS (spoonjoy/spoonjoy) are still stored in
// Redwood dbAuth's formats, with the salt in the User row's `salt` column:
// - legacy (Redwood before v4, CryptoJS): PBKDF2-HMAC-SHA1, 1 iteration, 32 bytes, as 64 hex chars.
// - scrypt (Redwood v4 and later): 64 hex chars, then `|cost|blockSize|parallelization`.
// Redwood's own `DbAuthHandler._verifyUser` checked both and upgraded a legacy hash on sign-in,
// but a chef who never signed in after an upgrade still has the old hash. These checks match
// Redwood's `hashPassword` and `legacyHashPassword` (@redwoodjs/auth-dbauth-api 8.2.0) byte for
// byte. A successful match is upgraded to bcrypt by the caller, so each chef needs it only once.

export type RedwoodPasswordFormat = "redwood_pbkdf2_sha1" | "redwood_scrypt";

const LEGACY_PBKDF2 = /^[0-9a-f]{64}$/;
const REDWOOD_SCRYPT = /^([0-9a-f]{64})\|(\d+)\|(\d+)\|(\d+)$/;

// Redwood always wrote cost 2^14, block size 8, parallelization 1. Refuse anything far outside
// that rather than let a stored row pick an expensive work factor.
const MAX_SCRYPT_COST = 2 ** 15;
const MAX_SCRYPT_BLOCK_SIZE = 16;
const MAX_SCRYPT_PARALLELIZATION = 2;

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}

export function redwoodPasswordFormat(hashedPassword: string): RedwoodPasswordFormat | null {
  if (LEGACY_PBKDF2.test(hashedPassword)) return "redwood_pbkdf2_sha1";
  if (REDWOOD_SCRYPT.test(hashedPassword)) return "redwood_scrypt";
  return null;
}

async function pbkdf2Sha1(password: string, salt: string): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-1", salt: encoder.encode(salt), iterations: 1 },
    key,
    256,
  );
  return new Uint8Array(bits);
}

/** True when `password` matches a Redwood dbAuth hash and its salt; false for any other format. */
export async function verifyRedwoodPassword(
  password: string,
  hashedPassword: string,
  salt: string | null | undefined,
): Promise<boolean> {
  if (!salt) return false;
  if (LEGACY_PBKDF2.test(hashedPassword)) {
    return equalBytes(await pbkdf2Sha1(password, salt), hexToBytes(hashedPassword));
  }
  const scrypt = REDWOOD_SCRYPT.exec(hashedPassword);
  if (!scrypt) return false;
  const cost = Number(scrypt[2]);
  const blockSize = Number(scrypt[3]);
  const parallelization = Number(scrypt[4]);
  if (
    cost < 2 || cost > MAX_SCRYPT_COST || (cost & (cost - 1)) !== 0 ||
    blockSize < 1 || blockSize > MAX_SCRYPT_BLOCK_SIZE ||
    parallelization < 1 || parallelization > MAX_SCRYPT_PARALLELIZATION
  ) {
    return false;
  }
  const derived = scryptSync(password.normalize("NFC"), salt, 32, {
    cost,
    blockSize,
    parallelization,
    maxmem: 256 * cost * blockSize * parallelization,
  });
  return equalBytes(new Uint8Array(derived), hexToBytes(scrypt[1]));
}
