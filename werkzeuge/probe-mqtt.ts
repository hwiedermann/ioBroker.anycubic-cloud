/* MQTT aufzeichnen, NUR ZUHÖREN (kein publish im Code). Aufruf: node werkzeuge/probe-mqtt.ts [minuten]
   Jede Nachricht als JSON-Zeile nach ~/.anycubic/probe/mqtt.jsonl (außerhalb des Repos, Topic mit gekürztem Schlüssel).
   Konsole: eine Zeile je Nachricht mit type/action/state und den Datenfeldern. */
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import mqtt from "mqtt";
import { ENDPUNKT, MQTT_HOST, MQTT_PORT } from "../src/lib/konstanten.ts";
import { kennungenAus, paketLaden } from "../src/lib/kennungen.ts";
import { abos, mqttLogin, zertifikateAus } from "../src/lib/mqtt-login.ts";
import { AnycubicRest } from "../src/lib/rest.ts";

const minuten = Number(process.argv[2] ?? 75);
const DIR = join(homedir(), ".anycubic");
const LOG = join(DIR, "probe", "mqtt.jsonl");
await mkdir(join(DIR, "probe"), { recursive: true });
const zeit = () => new Date().toLocaleTimeString("de-DE");

const dateien = await paketLaden();
const api = new AnycubicRest(kennungenAus(dateien), (await readFile(join(DIR, "token"), "utf8")).trim());
await api.anmelden();
const ich = (await api.aufruf(ENDPUNKT.benutzer)).data;
const drucker = (await api.aufruf<any[]>(ENDPUNKT.drucker)).data;
const schluessel = drucker.map((d) => d.key as string);
const kuerze = (s: string) => schluessel.reduce((a, k) => a.split(k).join(k.slice(0, 4) + "…"), s);

const z = zertifikateAus(dateien);
const login = mqttLogin(api.userToken!, ich.user_email, z.ca);
const client = mqtt.connect({
  host: MQTT_HOST, port: MQTT_PORT, protocol: "mqtts", protocolVersion: 4, clean: true, keepalive: 1200,
  clientId: login.clientId, username: login.benutzer, password: login.passwort,
  ca: z.ca, cert: z.cert, key: z.key, servername: MQTT_HOST,
  ciphers: "DEFAULT:@SECLEVEL=0", minVersion: "TLSv1.2", rejectUnauthorized: true,
  reconnectPeriod: 5000,
});

const zaehler = new Map<string, number>();
client.on("connect", () => {
  console.log(`${zeit()} ✔ MQTT verbunden`);
  for (const t of abos(drucker, ich.id)) client.subscribe(t, (e) => console.log(`${zeit()} ${e ? "✘" : "✔"} Abo ${kuerze(t)}${e ? " " + e.message : ""}`));
});
client.on("message", async (topic, buf) => {
  const text = buf.toString("utf8");
  let p: any; try { p = JSON.parse(text); } catch { p = { roh: text }; }
  await appendFile(LOG, JSON.stringify({ t: new Date().toISOString(), topic: kuerze(topic), p }) + "\n");
  const art = `${p.type}/${p.action}/${p.state}`;
  zaehler.set(art, (zaehler.get(art) ?? 0) + 1);
  const d = p.data && typeof p.data === "object" ? p.data : {};
  const kurz = ["progress", "remain_time", "curr_layer", "total_layers", "curr_nozzle_temp", "curr_hotbed_temp", "fan_speed_pct"]
    .filter((k) => k in d).map((k) => `${k}=${d[k]}`).join(" ");
  console.log(`${zeit()} ${art}  ${kurz || "Felder: " + Object.keys(d).join(",")}`);
});
client.on("error", (e) => console.log(`${zeit()} ✘ Fehler: ${e.message}`));
client.on("close", () => console.log(`${zeit()} – Verbindung zu`));

setTimeout(() => {
  console.log(`\n${zeit()} Ende nach ${minuten} min. Nachrichten je type/action/state:`);
  for (const [k, n] of [...zaehler].sort()) console.log(`  ${n}× ${k}`);
  client.end(); process.exit(0);
}, minuten * 60_000);
