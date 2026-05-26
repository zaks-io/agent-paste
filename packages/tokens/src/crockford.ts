const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CROCKFORD_DECODE = new Map<string, number>([...CROCKFORD].map((character, index) => [character, index]));

/** Decodes a 16-character Crockford base32 public id to 10 bytes (80 bits). */
export function decodeCrockfordPublicId(publicId: string): Uint8Array | null {
  if (publicId.length !== 16 || !/^[0-9A-HJKMNP-TV-Z]{16}$/.test(publicId)) {
    return null;
  }

  let buffer = 0n;
  let bits = 0;
  const bytes: number[] = [];

  for (const character of publicId) {
    const value = CROCKFORD_DECODE.get(character);
    if (value === undefined) {
      return null;
    }
    buffer = (buffer << 5n) | BigInt(value);
    bits += 5;
    while (bits >= 8) {
      bits -= 8;
      const shift = BigInt(bits);
      bytes.push(Number((buffer >> shift) & 0xffn));
    }
  }

  if (bytes.length !== 10) {
    return null;
  }

  return Uint8Array.from(bytes);
}
