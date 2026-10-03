/* REST-Durchstich, NUR LESEN — Konto, Drucker und laufender Job. Aufruf: node werkzeuge/probe-rest.ts
   Token aus ~/.anycubic/token, Kennungen aus dem PyPI-Paket. Ausgabe redigiert: keine Tokens,
   E-Mail maskiert, Drucker-Schlüssel gekürzt. Rohantworten (unredigiert) nur nach ~/.anycubic/probe/. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { ENDPUNKT } from "../src/lib/konstanten.ts";
import { kennungenAus, paketLaden } from "../src/lib/kennungen.ts";
import { AnycubicRest } from "../src/lib/rest.ts";
import { jwtNutzlast } from "../src/lib/signatur.ts";

const DIR = join(homedir(), ".anycubic");
const kurz = (s: unknown) => (typeof s === "string" && s.length > 8 ? s.slice(0, 4) + "…" + s.slice(-2) : s);
const maske = (m: unknown) => typeof m === "string" ? m.replace(/^(.).*(@.*)$/, "$1***$2") : m;
const roh = async (name: string, daten: unknown) => {
  await mkdir(join(DIR, "probe"), { recursive: true });
  await writeFile(join(DIR, "probe", `${name}.json`), JSON.stringify(daten, null, 2));
};

const accessToken = (await readFile(join(DIR, "token"), "utf8")).trim();
const exp = Number(jwtNutzlast(accessToken).exp) * 1000;
console.log(`Token gültig bis ${new Date(exp).toLocaleString("de-DE")} (${Math.round((exp - Date.now()) / 864e5)} Tage)`);

const kennungen = kennungenAus(await paketLaden());
console.log(`Kennungen aus PyPI-Paket geladen (Version ${kennungen.version})`);

const api = new AnycubicRest(kennungen, accessToken);
await api.anmelden();
console.log(`✔ Token-Tausch ok, User-Token läuft bis ${new Date(Number(jwtNutzlast(api.userToken!).exp) * 1000).toLocaleString("de-DE")}`);

const ich = await api.aufruf(ENDPUNKT.benutzer); await roh("benutzer", ich);
console.log(`✔ Konto: id ${kurz(String(ich.data?.id))}, ${maske(ich.data?.user_email)}`);

const dr = await api.aufruf<any[]>(ENDPUNKT.drucker); await roh("drucker", dr);
for (const d of dr.data ?? []) {
  console.log(`✔ Drucker: „${d.name}“ · Modell ${d.machine_type ?? d.model} · id ${d.id} · key ${kurz(d.key)} · Status ${d.device_status ?? d.status} · ${d.is_printing ? "druckt" : "frei"}`);
  const info = await api.aufruf(ENDPUNKT.druckerInfo, { query: { id: d.id } }); await roh(`drucker-${d.id}`, info);
  console.log(`  Felder printer/info: ${Object.keys(info.data ?? {}).join(", ")}`);
}

const pj = await api.aufruf<any[]>(ENDPUNKT.projekte, { query: { page: 1, limit: 5 } }); await roh("projekte", pj);
for (const p of (pj.data ?? []).slice(0, 3)) {
  console.log(`✔ Job: ${p.gcode_name ?? p.name} · Status ${p.print_status} · ${p.progress ?? "?"} % · Rest ${p.remain_time ?? "?"} min · Schicht ${p.curr_layer ?? "?"}/${p.total_layers ?? "?"}`);
}
console.log("Rohantworten: ~/.anycubic/probe/");
