/* App-Kennungen (App-ID, Secret, Slicer-Version) und die MQTT-Zertifikate liegen NICHT im Repo,
   sondern werden zur Laufzeit aus dem fest gepinnten PyPI-Paket anycubic-cloud-api gelesen.
   Ablauf: PyPI-JSON → Wheel-URL + SHA-256 → Wheel laden, Prüfsumme vergleichen → Dateien aus dem ZIP lesen.
   Der Zwischenspeicher liegt in iobroker-data (bzw. ~/.anycubic/paket/ bei den Hilfsskripten). */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";
import type { Kennungen } from "./signatur.ts";

export const PAKET = { name: "anycubic-cloud-api", version: "0.4.33" };

/* Minimaler ZIP-Leser (zentrales Verzeichnis, Methoden 0 und 8) — reicht für Wheels */
export function zipLesen(zip: Buffer): Map<string, Buffer> {
  let eocd = zip.length - 22;
  while (eocd >= 0 && zip.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error("kein ZIP");
  const anzahl = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  const dateien = new Map<string, Buffer>();
  for (let i = 0; i < anzahl; i++) {
    const methode = zip.readUInt16LE(p + 10), groesse = zip.readUInt32LE(p + 20);
    const nLen = zip.readUInt16LE(p + 28), xLen = zip.readUInt16LE(p + 30), kLen = zip.readUInt16LE(p + 32);
    const lokal = zip.readUInt32LE(p + 42), name = zip.toString("utf8", p + 46, p + 46 + nLen);
    const start = lokal + 30 + zip.readUInt16LE(lokal + 26) + zip.readUInt16LE(lokal + 28);
    const roh = zip.subarray(start, start + groesse);
    dateien.set(name, methode === 8 ? inflateRawSync(roh) : Buffer.from(roh));
    p += 46 + nLen + xLen + kLen;
  }
  return dateien;
}

/* Wheel holen (oder aus dem Zwischenspeicher), Prüfsumme gegen PyPI */
export async function paketLaden(ordner = join(homedir(), ".anycubic", "paket")): Promise<Map<string, Buffer>> {
  const datei = join(ordner, `${PAKET.name}-${PAKET.version}.whl`);
  const meta = await (await fetch(`https://pypi.org/pypi/${PAKET.name}/${PAKET.version}/json`)).json() as any;
  const whl = (meta.urls as any[]).find((u) => u.packagetype === "bdist_wheel");
  if (!whl) throw new Error("kein Wheel auf PyPI");
  let zip: Buffer;
  try { zip = await readFile(datei); } catch {
    zip = Buffer.from(await (await fetch(whl.url)).arrayBuffer());
  }
  const sha = createHash("sha256").update(zip).digest("hex");
  if (sha !== whl.digests.sha256) throw new Error(`Prüfsumme des Wheels passt nicht (${sha.slice(0, 12)}…)`);
  await mkdir(ordner, { recursive: true });
  await writeFile(datei, zip);
  return zipLesen(zip);
}

export function kennungenAus(dateien: Map<string, Buffer>): Kennungen {
  const pfad = [...dateien.keys()].find((n) => n.endsWith("anycubic_cloud_api/const/const.py"));
  if (!pfad) throw new Error("const/const.py nicht im Paket");
  const text = dateien.get(pfad)!.toString("utf8");
  const wert = (n: string) => {
    const m = text.match(new RegExp(`^${n} = ["']([^"']+)["']`, "m"));
    if (!m) throw new Error(`${n} nicht gefunden`);
    return m[1];
  };
  return { appId: wert("AC_KNOWN_AID"), appSecret: wert("AC_KNOWN_SEC"), version: wert("AC_KNOWN_VID_SLICER_NEXT") };
}
