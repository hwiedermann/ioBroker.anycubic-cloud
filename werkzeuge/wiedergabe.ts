/* Aufgezeichnete MQTT-Meldungen durch das Druckerbild schicken — prüft das Mapping ohne Drucker und ohne Cloud.
   Aufruf: node werkzeuge/wiedergabe.ts [~/.anycubic/probe/mqtt.jsonl] [--alle]
   Startzustand wie im Adapter: printer/info + getProjects aus ~/.anycubic/probe/ (REST-Rohantworten). */
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { Druckerbild } from "../src/lib/druckerbild.ts";

const P = join(homedir(), ".anycubic", "probe");
const datei = process.argv.find((x, i) => i > 1 && !x.startsWith("--")) ?? join(P, "mqtt.jsonl");
const alle = process.argv.includes("--alle");

const bild = new Druckerbild();
const info = JSON.parse(await readFile(join(P, "drucker-772865.json"), "utf8")).data;
const projekte = JSON.parse(await readFile(join(P, "projekte.json"), "utf8")).data;
bild.ausInfo(info);
bild.planAusProjekt(projekte.find((p: any) => p.print_status === 1));

let n = 0, schreib = 0;
for (const zeile of (await readFile(datei, "utf8")).split("\n")) {
  if (!zeile.trim()) continue;
  const r = JSON.parse(zeile);
  const aus = bild.ausMqtt(r.p, Date.parse(r.t));
  n++; schreib += aus.length;
  const wichtig = aus.filter((s) => alle || /^(zustand$|job\.(taskId|ende)|ereignis|verbrauch\.letzter|meldung\.letzteCode|ace\.aktiverSlot)/.test(s.id));
  for (const s of wichtig) console.log(`${r.t.slice(11, 19)}  ${s.id} = ${String(s.wert).slice(0, 160)}`);
}
console.log(`\n${n} Meldungen → ${schreib} Schreibvorgänge (${Math.round(schreib / n * 10) / 10} je Meldung)`);
console.log("\nEndstand:");
for (const [k, v] of [...bild.werte].sort()) if (!k.startsWith("verbrauch")) console.log(`  ${k} = ${String(v).slice(0, 100)}`);
console.log("\nVerbrauchsverlauf:");
for (const v of bild.verlauf) console.log(" ", JSON.stringify(v));
