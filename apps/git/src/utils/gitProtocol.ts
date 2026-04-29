export function wantsSideBand(body: ArrayBuffer | undefined) {
  if (!body) {
    return false;
  }

  const text = new TextDecoder().decode(body.slice(0, 1024));
  return text.includes(" side-band") || text.includes(" side-band-64k");
}

export function encodeSideBandProgress(lines: string[]) {
  const encoder = new TextEncoder();
  const chunks = lines.map((line) =>
    pktLine(concatBytes(new Uint8Array([2]), encoder.encode(`${line}\n`))),
  );
  return concatBytes(...chunks);
}

export function insertBeforeFlush(body: Uint8Array, insertion: Uint8Array) {
  const flush = new TextEncoder().encode("0000");

  if (endsWith(body, flush)) {
    return concatBytes(body.slice(0, -flush.byteLength), insertion, flush);
  }

  return concatBytes(body, insertion, flush);
}

function pktLine(payload: Uint8Array) {
  const encoder = new TextEncoder();
  const length = payload.byteLength + 4;
  const header = encoder.encode(length.toString(16).padStart(4, "0"));
  return concatBytes(header, payload);
}

function endsWith(value: Uint8Array, suffix: Uint8Array) {
  if (value.byteLength < suffix.byteLength) {
    return false;
  }

  return suffix.every(
    (byte, index) => value[value.byteLength - suffix.byteLength + index] === byte,
  );
}

function concatBytes(...chunks: Uint8Array[]) {
  const size = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const combined = new Uint8Array(size);
  let offset = 0;

  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return combined;
}
