/* The app credentials (app ID, secret, slicer version) and the MQTT certificates are not part of this repository.
   They are read at runtime from the pinned PyPI package anycubic-cloud-api:
   PyPI JSON → wheel URL and SHA-256 → download the wheel, verify the checksum → read the files from the ZIP.
   The wheel is cached in the instance data directory. */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import type { Credentials } from './signature.ts';

export const PACKAGE = { name: 'anycubic-cloud-api', version: '0.4.33' };

/* Minimal ZIP reader (central directory, methods 0 and 8), sufficient for wheels */
export function readZip(zip: Buffer): Map<string, Buffer> {
    let eocd = zip.length - 22;
    while (eocd >= 0 && zip.readUInt32LE(eocd) !== 0x06054b50) {
        eocd--;
    }
    if (eocd < 0) {
        throw new Error('not a ZIP file');
    }
    const count = zip.readUInt16LE(eocd + 10);
    let p = zip.readUInt32LE(eocd + 16);
    const files = new Map<string, Buffer>();
    for (let i = 0; i < count; i++) {
        const method = zip.readUInt16LE(p + 10),
            size = zip.readUInt32LE(p + 20);
        const nameLen = zip.readUInt16LE(p + 28),
            extraLen = zip.readUInt16LE(p + 30),
            commentLen = zip.readUInt16LE(p + 32);
        const local = zip.readUInt32LE(p + 42),
            name = zip.toString('utf8', p + 46, p + 46 + nameLen);
        const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
        const raw = zip.subarray(start, start + size);
        files.set(name, method === 8 ? inflateRawSync(raw) : Buffer.from(raw));
        p += 46 + nameLen + extraLen + commentLen;
    }
    return files;
}

export async function loadPackage(dir: string): Promise<Map<string, Buffer>> {
    const file = join(dir, `${PACKAGE.name}-${PACKAGE.version}.whl`);
    const meta = (await (await fetch(`https://pypi.org/pypi/${PACKAGE.name}/${PACKAGE.version}/json`)).json()) as any;
    const wheel = (meta.urls as any[]).find(u => u.packagetype === 'bdist_wheel');
    if (!wheel) {
        throw new Error('no wheel on PyPI');
    }
    let zip: Buffer;
    try {
        zip = await readFile(file);
    } catch {
        zip = Buffer.from(await (await fetch(wheel.url)).arrayBuffer());
    }
    const sha = createHash('sha256').update(zip).digest('hex');
    if (sha !== wheel.digests.sha256) {
        throw new Error(`wheel checksum mismatch (${sha.slice(0, 12)}…)`);
    }
    await mkdir(dir, { recursive: true });
    await writeFile(file, zip);
    return readZip(zip);
}

export function credentialsFrom(files: Map<string, Buffer>): Credentials {
    const path = [...files.keys()].find(n => n.endsWith('anycubic_cloud_api/const/const.py'));
    if (!path) {
        throw new Error('const/const.py missing in package');
    }
    const text = files.get(path)!.toString('utf8');
    const value = (n: string) => {
        const m = text.match(new RegExp(`^${n} = ["']([^"']+)["']`, 'm'));
        if (!m) {
            throw new Error(`${n} not found`);
        }
        return m[1];
    };
    return {
        appId: value('AC_KNOWN_AID'),
        appSecret: value('AC_KNOWN_SEC'),
        version: value('AC_KNOWN_VID_SLICER_NEXT'),
    };
}
