/**
 * Postgres `bytea` over PostgREST travels as a hex-format string
 * (`\x` + two hex digits per byte). These are the only two places where
 * that representation is spelled out.
 */

const HEX = Array.from({ length: 256 }, (_, i) =>
  i.toString(16).padStart(2, '0')
);

/** Encodes bytes for a PostgREST insert/RPC argument. */
export function toByteaHex(bytes: Uint8Array): string {
  let out = '\\x';
  for (const b of bytes) out += HEX[b];
  return out;
}

/** Decodes a PostgREST-returned bytea column value. */
export function fromByteaHex(value: string | null): Uint8Array | null {
  if (value === null) return null;
  const hex = value.startsWith('\\x') ? value.slice(2) : value;
  if (hex.length % 2 !== 0) {
    throw new Error(`malformed bytea hex value (odd length ${hex.length})`);
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) {
      throw new Error('malformed bytea hex value (non-hex digits)');
    }
    out[i] = byte;
  }
  return out;
}
