/* ioBroker-Adapter anycubic-cloud — liest Druckerstatus, Druckauftrag und ACE über die Anycubic-Cloud.
   REST beim Start und als Abgleich, MQTT für Echtzeit. Der Adapter ist rein lesend: es gibt bewusst
   kein publish und kein sendOrder, er schickt also keine Befehle an den Drucker. */
import * as utils from "@iobroker/adapter-core";
import mqtt, { type MqttClient } from "mqtt";
import { Druckerbild, type Schreib } from "./lib/druckerbild.ts";
import { kennungenAus, paketLaden } from "./lib/kennungen.ts";
import { ENDPUNKT, MQTT_HOST, MQTT_PORT } from "./lib/konstanten.ts";
import { abos, mqttLogin, zertifikateAus } from "./lib/mqtt-login.ts";
import { AnycubicRest } from "./lib/rest.ts";
import { jwtNutzlast } from "./lib/signatur.ts";
import { definition, KANAELE } from "./lib/zustaende.ts";

declare global {
  namespace ioBroker { interface AdapterConfig { token: string; restMinuten: number } }
}

interface Drucker { id: string; key: string; machine_type: number; bild: Druckerbild; merker: string }

class AnycubicCloud extends utils.Adapter {
  private api?: AnycubicRest;
  private client?: MqttClient;
  private drucker = new Map<string, Drucker>();       // Schlüssel = Cloud-key (steht im Topic)
  private angelegt = new Set<string>();
  private abgleichTimer?: ioBroker.Interval;
  private gestoppt = false;
  /* Diagnose: welche Meldungsarten kommen an (info.meldungen, minütlich) — z. B. ob tempature ohne offenen Slicer kommt */
  private zaehler: Record<string, number> = {};
  private zaehlerTimer?: ioBroker.Interval;

  constructor(options: Partial<utils.AdapterOptions> = {}) {
    super({ ...options, name: "anycubic-cloud" });
    this.on("ready", () => this.start().catch((e) => this.log.error(`Start fehlgeschlagen: ${e?.message ?? e}`)));
    this.on("unload", (cb) => this.ende(cb));
  }

  private async start() {
    await this.setState("info.connection", false, true);
    const token = String(this.config.token ?? "").trim();
    if (!token) { this.log.warn("Kein Slicer-Token eingetragen (Instanz-Einstellungen)."); return; }

    let exp = 0;
    try { exp = Number(jwtNutzlast(token).exp) * 1000; } catch { this.log.error("Token ist kein gültiges JWT."); return; }
    const tage = Math.floor((exp - Date.now()) / 864e5);
    await this.zustand("info.tokenAblauf", new Date(exp).toISOString(), { name: "Token läuft ab", type: "string", role: "date" });
    await this.zustand("info.tokenTage", tage, { name: "Token-Resttage", type: "number", role: "value", unit: "d" });
    if (exp < Date.now()) { this.log.error("Slicer-Token ist abgelaufen — bitte in den Instanz-Einstellungen erneuern."); return; }
    if (tage < 14) this.log.warn(`Slicer-Token läuft in ${tage} Tagen ab.`);

    const dateien = await paketLaden(utils.getAbsoluteInstanceDataDir(this));
    this.api = new AnycubicRest(kennungenAus(dateien), token);
    await this.api.anmelden();
    const ich = (await this.api.aufruf(ENDPUNKT.benutzer)).data;
    if (!ich?.user_email) throw new Error("Kontodaten ohne E-Mail — Anmeldung unvollständig");

    await this.restAbgleich(true);
    if (!this.drucker.size) { this.log.warn("Keine Drucker im Konto gefunden."); return; }

    const z = zertifikateAus(dateien);
    const login = mqttLogin(this.api.userToken!, ich.user_email, z.ca);
    const liste = [...this.drucker.values()].map((d) => ({ machine_type: d.machine_type, key: d.key }));
    this.client = mqtt.connect({
      host: MQTT_HOST, port: MQTT_PORT, protocol: "mqtts", protocolVersion: 4, clean: true, keepalive: 1200,
      clientId: login.clientId, username: login.benutzer, password: login.passwort,
      ca: z.ca, cert: z.cert, key: z.key, servername: MQTT_HOST,
      ciphers: "DEFAULT:@SECLEVEL=0", minVersion: "TLSv1.2", rejectUnauthorized: true,
      reconnectPeriod: 30_000, connectTimeout: 30_000,
    } as mqtt.IClientOptions);
    let ersteVerbindung = true;
    this.client.on("connect", () => {
      this.log.info("MQTT verbunden");
      this.setState("info.connection", true, true);
      for (const t of abos(liste, ich.id)) this.client!.subscribe(t, (e) => e && this.log.warn(`Abo fehlgeschlagen: ${e.message}`));
      /* nach Wiederverbindung den verpassten Stand per REST holen */
      if (!ersteVerbindung) this.restAbgleich().catch((e) => this.log.warn(`REST-Abgleich: ${e.message}`));
      ersteVerbindung = false;
    });
    this.client.on("close", () => { if (!this.gestoppt) this.setState("info.connection", false, true); });
    this.client.on("error", (e) => this.log.warn(`MQTT: ${e.message}`));
    this.client.on("message", (topic, buf) => this.nachricht(topic, buf).catch((e) => this.log.warn(`Meldung verarbeiten: ${e.message}`)));

    await this.zustand("info.meldungen", "{}", { name: "Empfangene Meldungen seit Start je type/action (JSON)", type: "string", role: "json" });
    this.zaehlerTimer = this.setInterval(() => this.setState("info.meldungen", JSON.stringify(this.zaehler), true), 60_000);
    const minuten = Math.max(5, Number(this.config.restMinuten) || 10);
    this.abgleichTimer = this.setInterval(() => this.restAbgleich().catch((e) => this.log.warn(`REST-Abgleich: ${e.message}`)), minuten * 60_000);
  }

  /* Druckerliste + printer/info + laufender Job (Plan aus getProjects). Beim ersten Mal auch Merker laden. */
  private async restAbgleich(erst = false) {
    const liste = (await this.api!.aufruf<any[]>(ENDPUNKT.drucker)).data ?? [];
    for (const d of liste) {
      const id = String(d.id);
      let dr = this.drucker.get(d.key);
      if (!dr) {
        await this.setObjectNotExistsAsync(id, { type: "device", common: { name: d.name ?? id }, native: { machine_type: d.machine_type } });
        const merker = await this.lesen(`${id}.job.merker`);
        const verlauf = await this.lesen(`${id}.verbrauch.verlauf`);
        dr = { id, key: d.key, machine_type: d.machine_type, merker: "",
          bild: new Druckerbild({ ...(merker ?? {}), verlauf: Array.isArray(verlauf) ? verlauf : [] }) };
        this.drucker.set(d.key, dr);
      }
      await this.schreiben(dr, dr.bild.ausListe(d));
      const info = (await this.api!.aufruf(ENDPUNKT.druckerInfo, { query: { id } })).data;
      if (info?.project?.print_status === 1) {
        const pj = (await this.api!.aufruf<any[]>(ENDPUNKT.projekte, { query: { page: 1, limit: 5 } })).data ?? [];
        dr.bild.planAusProjekt(pj.find((p) => String(p.taskid) === String(info.project.task_id)));
      }
      if (info) await this.schreiben(dr, dr.bild.ausInfo(info));
      if (erst) this.log.info(`Drucker „${d.name}“ (${id}) gefunden, Zustand ${dr.bild.werte.get("zustand")}`);
    }
  }

  private async nachricht(topic: string, buf: Buffer) {
    if (topic.endsWith("/response")) return;                 // nur Quittungen {msgid}
    const dr = [...this.drucker.values()].find((d) => topic.includes(`/${d.key}/`));
    if (!dr) return;
    let m: any;
    try { m = JSON.parse(buf.toString("utf8")); } catch { return; }
    const art = `${m?.type}/${m?.action}`;
    this.zaehler[art] = (this.zaehler[art] ?? 0) + 1;
    await this.schreiben(dr, dr.bild.ausMqtt(m));
  }

  private async schreiben(dr: Drucker, liste: Schreib[]) {
    for (const s of liste) {
      const id = `${dr.id}.${s.id}`;
      if (!this.angelegt.has(id)) await this.anlegen(dr.id, s.id);
      await this.setState(id, { val: s.wert, ack: true });
      if (s.id === "ereignis.fertig" && s.wert === true) this.log.info(`Druck fertig: ${dr.bild.werte.get("job.datei")}`);
    }
    /* Merker (Slicer-Plan, Jobstart, Restprozente) nur bei Änderung sichern — überlebt so einen Neustart mitten im Druck */
    const m = JSON.stringify(dr.bild.merker());
    if (m !== dr.merker) {
      dr.merker = m;
      if (!this.angelegt.has(`${dr.id}.job.merker`)) await this.anlegen(dr.id, "job.merker");
      await this.setState(`${dr.id}.job.merker`, m, true);
    }
  }

  private async anlegen(geraet: string, rel: string) {
    const teile = rel.split(".");
    for (let i = 1; i < teile.length; i++) {
      const k = teile.slice(0, i).join(".");
      if (this.angelegt.has(`${geraet}.${k}`)) continue;
      await this.setObjectNotExistsAsync(`${geraet}.${k}`, { type: "channel", common: { name: KANAELE[k] ?? k }, native: {} });
      this.angelegt.add(`${geraet}.${k}`);
    }
    const d = definition(rel);
    await this.setObjectNotExistsAsync(`${geraet}.${rel}`, {
      type: "state", common: { ...d, read: true, write: false } as ioBroker.StateCommon, native: {},
    });
    this.angelegt.add(`${geraet}.${rel}`);
  }

  private async zustand(id: string, wert: ioBroker.StateValue, common: Partial<ioBroker.StateCommon>) {
    await this.setObjectNotExistsAsync(id, { type: "state", common: { read: true, write: false, ...common } as ioBroker.StateCommon, native: {} });
    await this.setState(id, wert, true);
  }

  private async lesen(id: string): Promise<any> {
    try { const s = await this.getStateAsync(id); return s?.val ? JSON.parse(String(s.val)) : null; } catch { return null; }
  }

  private ende(cb: () => void) {
    try {
      this.gestoppt = true;
      if (this.abgleichTimer) this.clearInterval(this.abgleichTimer);
      if (this.zaehlerTimer) this.clearInterval(this.zaehlerTimer);
      this.client?.end(true);
      this.setState("info.connection", false, true);
    } finally { cb(); }
  }
}

new AnycubicCloud();
