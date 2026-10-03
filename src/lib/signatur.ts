/* Signierte Kopfzeilen für die Anycubic-Cloud im Slicer-Modus.
   Nach anycubic-cloud-api, models/auth.py get_auth_headers():
   Xx-Signature = MD5(appId + timestamp + version + appSecret + nonce + appId), nonce = UUID v1. */
import { createHash, randomUUID } from "node:crypto";
import { GERAETETYP } from "./konstanten.ts";

export interface Kennungen { appId: string; appSecret: string; version: string }

const md5 = (s: string) => createHash("md5").update(s, "utf8").digest("hex");

export function kopfzeilen(k: Kennungen, userToken?: string): Record<string, string> {
  const ts = String(Date.now());
  const nonce = randomUUID();                          // Lib nimmt uuid1 — der Server prüft nur die Signatur
  const h: Record<string, string> = {
    "Xx-Device-Type": GERAETETYP,
    "Xx-Is-Cn": "1",
    "Xx-Nonce": nonce,
    "Xx-Signature": md5(`${k.appId}${ts}${k.version}${k.appSecret}${nonce}${k.appId}`),
    "Xx-Timestamp": ts,
    "Xx-Version": k.version,
    "Content-Type": "application/json",
    "XX-LANGUAGE": "US",
  };
  if (userToken) h["XX-Token"] = userToken;
  return h;
}

/* JWT-Nutzlast lesen (ohne Prüfung) — für Ablaufdatum und Kontrolle */
export function jwtNutzlast(t: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(t.split(".")[1], "base64url").toString("utf8"));
}
