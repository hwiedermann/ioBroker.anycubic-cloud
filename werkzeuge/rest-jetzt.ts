/* Momentaufnahme per REST (nur lesen): printer/info + jüngstes Projekt → ~/.anycubic/probe/jetzt-*.json */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { ENDPUNKT } from "../src/lib/konstanten.ts";
import { kennungenAus, paketLaden } from "../src/lib/kennungen.ts";
import { AnycubicRest } from "../src/lib/rest.ts";

const DIR = join(homedir(), ".anycubic");
const api = new AnycubicRest(kennungenAus(await paketLaden()), (await readFile(join(DIR, "token"), "utf8")).trim());
await api.anmelden();
const dr = (await api.aufruf<any[]>(ENDPUNKT.drucker)).data;
await mkdir(join(DIR, "probe"), { recursive: true });
for (const d of dr) await writeFile(join(DIR, "probe", `jetzt-info-${d.id}.json`), JSON.stringify(await api.aufruf(ENDPUNKT.druckerInfo, { query: { id: d.id } }), null, 2));
await writeFile(join(DIR, "probe", "jetzt-projekte.json"), JSON.stringify(await api.aufruf(ENDPUNKT.projekte, { query: { page: 1, limit: 10 } }), null, 2));
console.log("gespeichert");
