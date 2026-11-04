import fs from 'node:fs';
import path from 'node:path';

export class JsonFileError extends Error {}

/** Returns undefined when the file does not exist; throws (never clobbers) when it is not valid JSON. */
export function readJsonObject(file: string): Record<string, unknown> | undefined {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw err;
  }
  if (text.trim() === '') return {};
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new JsonFileError(`${file} is not valid JSON (${(err as Error).message}). Fix it first; nothing was changed.`);
  }
  if (!isPlainObject(data)) {
    throw new JsonFileError(`${file} must contain a JSON object. Fix it first; nothing was changed.`);
  }
  return data;
}

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Write via temp file + rename so a crash never leaves a half-written settings file. */
export function writeFileAtomic(file: string, content: string, mode: number): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, content, { mode });
  fs.chmodSync(tmp, mode);
  fs.renameSync(tmp, file);
}

export function fileMode(file: string): number | undefined {
  try {
    return fs.statSync(file).mode & 0o777;
  } catch {
    return undefined;
  }
}

export function toJson(data: unknown): string {
  return `${JSON.stringify(data, null, 2)}\n`;
}
