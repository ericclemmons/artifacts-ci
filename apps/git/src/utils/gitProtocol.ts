export function wantsSideBand(body: ArrayBuffer | undefined) {
  if (!body) {
    return false;
  }

  const text = new TextDecoder().decode(body.slice(0, 1024));
  return text.includes(" side-band") || text.includes(" side-band-64k");
}

export function getPushedCommitSha(body: ArrayBuffer | undefined) {
  if (!body) {
    return null;
  }

  const updates = parseReceivePackUpdates(new Uint8Array(body));
  const branchUpdate = updates.find(
    (update) => update.ref.startsWith("refs/heads/") && !isZeroSha(update.newSha),
  );
  const update = branchUpdate ?? updates.find((update) => !isZeroSha(update.newSha));

  return update?.newSha ?? null;
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

function parseReceivePackUpdates(body: Uint8Array) {
  const decoder = new TextDecoder();
  const updates: Array<{ oldSha: string; newSha: string; ref: string }> = [];
  let offset = 0;

  while (offset + 4 <= body.byteLength) {
    const lengthText = decoder.decode(body.slice(offset, offset + 4));
    const length = Number.parseInt(lengthText, 16);

    if (!Number.isFinite(length) || length < 0) {
      break;
    }

    offset += 4;

    if (length === 0) {
      continue;
    }

    const payloadLength = length - 4;

    if (payloadLength < 0 || offset + payloadLength > body.byteLength) {
      break;
    }

    const line = decoder.decode(body.slice(offset, offset + payloadLength)).trimEnd();
    offset += payloadLength;

    const command = line.split("\0", 1)[0];
    const [oldSha, newSha, ref] = command.split(" ");

    if (isSha(oldSha) && isSha(newSha) && ref) {
      updates.push({ oldSha, newSha, ref });
    }
  }

  return updates;
}

function isSha(value: string | undefined) {
  return !!value && /^[0-9a-f]{40}$/i.test(value);
}

function isZeroSha(value: string) {
  return /^0{40}$/.test(value);
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
