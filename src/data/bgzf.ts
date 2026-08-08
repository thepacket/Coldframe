// Gzip decompression for the browser, including BGZF.
//
// VCFSubset returns BGZF - many small gzip members concatenated, each carrying
// its own size in a 'BC' extra subfield. DecompressionStream('gzip') cannot be
// trusted with trailing members across browsers, so BGZF is walked block by
// block using the size the format itself provides. Plain single-member gzip
// (the NCBI expression matrix) takes the one-shot path.

async function inflateMember(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** BGZF: gzip magic, FLG.FEXTRA set, and a 'BC' subfield in the extra area. */
function isBgzf(b: Uint8Array): boolean {
  if (b.length < 18 || b[0] !== 0x1f || b[1] !== 0x8b || ((b[3] ?? 0) & 4) === 0) return false;
  const xlen = (b[10] as number) | ((b[11] as number) << 8);
  let at = 12;
  const end = 12 + xlen;
  while (at + 4 <= end && at + 4 <= b.length) {
    const slen = (b[at + 2] as number) | ((b[at + 3] as number) << 8);
    if (b[at] === 66 && b[at + 1] === 67 && slen === 2) return true;
    at += 4 + slen;
  }
  return false;
}

/** Total block size, read from the BC subfield of a block starting at `off`. */
function bgzfBlockSize(b: Uint8Array, off: number): number {
  const xlen = (b[off + 10] as number) | ((b[off + 11] as number) << 8);
  let at = off + 12;
  const end = at + xlen;
  while (at + 4 <= end) {
    const slen = (b[at + 2] as number) | ((b[at + 3] as number) << 8);
    if (b[at] === 66 && b[at + 1] === 67 && slen === 2) {
      return ((b[at + 4] as number) | ((b[at + 5] as number) << 8)) + 1;
    }
    at += 4 + slen;
  }
  throw new Error(`BGZF block at ${off} has no BC subfield`);
}

export async function gunzip(buf: ArrayBuffer): Promise<Uint8Array> {
  const bytes = new Uint8Array(buf);
  if (!isBgzf(bytes)) return inflateMember(bytes);

  const parts: Uint8Array[] = [];
  let off = 0;
  let total = 0;
  while (off < bytes.length) {
    const size = bgzfBlockSize(bytes, off);
    const part = await inflateMember(bytes.subarray(off, off + size));
    if (part.length > 0) parts.push(part); // the EOF marker block inflates to nothing
    total += part.length;
    off += size;
  }

  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

export async function gunzipText(buf: ArrayBuffer): Promise<string> {
  return new TextDecoder().decode(await gunzip(buf));
}
