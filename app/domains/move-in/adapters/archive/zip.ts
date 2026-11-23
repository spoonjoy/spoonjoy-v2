// Reads a zip archive through ranged reads, so a backup that sits in blob storage is never loaded
// whole: the end record and central directory come first, then only the entries asked for. Entries
// are stored or deflated (what Python's zipfile writes); deflate is undone with the platform's
// DecompressionStream, which Workers and Node both have.

/** Where the archive's bytes come from: a blob read by range, or bytes already in memory. */
export interface RangeSource {
  size: number;
  read(offset: number, length: number): Promise<Uint8Array>;
}

export type ArchiveErrorCode = "not-a-zip" | "too-large" | "encrypted" | "unsupported-compression" | "entry-too-large";

export class ArchiveError extends Error {
  constructor(
    readonly code: ArchiveErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ArchiveError";
  }
}

export interface ZipEntry {
  name: string;
  method: number;
  flags: number;
  compressedSize: number;
  size: number;
  localHeaderOffset: number;
}

export interface ZipArchive {
  entries: ZipEntry[];
  get(name: string): ZipEntry | undefined;
  read(entry: ZipEntry, options?: { maxBytes?: number }): Promise<Uint8Array>;
}

const END_RECORD = 0x06054b50;
const CENTRAL_HEADER = 0x02014b50;
const LOCAL_HEADER = 0x04034b50;
const END_RECORD_SIZE = 22;
const MAX_COMMENT = 0xffff;

export function bytesSource(bytes: Uint8Array): RangeSource {
  return {
    size: bytes.length,
    read: async (offset, length) => bytes.subarray(offset, offset + length),
  };
}

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function notAZip(detail: string): ArchiveError {
  return new ArchiveError("not-a-zip", `This file isn't a zip archive we can read (${detail}).`);
}

async function findEndRecord(source: RangeSource): Promise<DataView> {
  if (source.size < END_RECORD_SIZE) throw notAZip("too short");
  const tailLength = Math.min(source.size, END_RECORD_SIZE + MAX_COMMENT);
  const tail = await source.read(source.size - tailLength, tailLength);
  const tailView = view(tail);
  for (let at = tail.length - END_RECORD_SIZE; at >= 0; at--) {
    if (tailView.getUint32(at, true) === END_RECORD) return new DataView(tail.buffer, tail.byteOffset + at, END_RECORD_SIZE);
  }
  throw notAZip("no end record");
}

export async function openZip(source: RangeSource): Promise<ZipArchive> {
  const end = await findEndRecord(source);
  const count = end.getUint16(10, true);
  const directorySize = end.getUint32(12, true);
  const directoryOffset = end.getUint32(16, true);
  if (count === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) {
    throw new ArchiveError("too-large", "This archive is over 4 GB or holds over 65,535 files, which move-in can't read yet.");
  }
  if (directoryOffset + directorySize > source.size) throw notAZip("cut off");
  const directory = await source.read(directoryOffset, directorySize);
  const directoryView = view(directory);
  const decoder = new TextDecoder();
  const entries: ZipEntry[] = [];
  let at = 0;
  for (let index = 0; index < count; index++) {
    if (at + 46 > directory.length || directoryView.getUint32(at, true) !== CENTRAL_HEADER) throw notAZip("bad directory");
    const nameLength = directoryView.getUint16(at + 28, true);
    const extraLength = directoryView.getUint16(at + 30, true);
    const commentLength = directoryView.getUint16(at + 32, true);
    entries.push({
      flags: directoryView.getUint16(at + 8, true),
      method: directoryView.getUint16(at + 10, true),
      compressedSize: directoryView.getUint32(at + 20, true),
      size: directoryView.getUint32(at + 24, true),
      localHeaderOffset: directoryView.getUint32(at + 42, true),
      name: decoder.decode(directory.subarray(at + 46, at + 46 + nameLength)),
    });
    at += 46 + nameLength + extraLength + commentLength;
  }
  const byName = new Map(entries.map((entry) => [entry.name, entry]));
  return {
    entries,
    get: (name) => byName.get(name),
    read: (entry, options) => readEntry(source, entry, options?.maxBytes),
  };
}

async function readEntry(source: RangeSource, entry: ZipEntry, maxBytes = Number.POSITIVE_INFINITY): Promise<Uint8Array> {
  if (entry.flags & 1) throw new ArchiveError("encrypted", `${entry.name} is password-protected.`);
  if (entry.method !== 0 && entry.method !== 8) {
    throw new ArchiveError("unsupported-compression", `${entry.name} uses a compression method move-in can't read.`);
  }
  if (entry.size > maxBytes) throw new ArchiveError("entry-too-large", `${entry.name} is larger than move-in allows.`);
  const header = view(await source.read(entry.localHeaderOffset, 30));
  if (header.byteLength < 30 || header.getUint32(0, true) !== LOCAL_HEADER) throw notAZip(`bad header for ${entry.name}`);
  const dataOffset = entry.localHeaderOffset + 30 + header.getUint16(26, true) + header.getUint16(28, true);
  const data = await source.read(dataOffset, entry.compressedSize);
  if (entry.method === 0) return data;
  try {
    const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    throw notAZip(`damaged entry ${entry.name}`);
  }
}
