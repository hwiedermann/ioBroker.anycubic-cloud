/* Druckerbild: macht aus REST-Antworten und MQTT-Meldungen Datenpunkt-Werte für EINEN Drucker.
   Reine Logik ohne ioBroker-Abhängigkeit, damit sie sich eigenständig testen lässt.
   Regeln: „fertig“ erst bei finished, Pause-Code 10401 = Benutzer, supplies_usage in mm,
   Temperaturen nur bei Änderung ≥ 1 °C, Job-Werte von fod/auto_leveling stammen noch vom Vorjob. */

export type Wert = string | number | boolean | null;
export interface Schreib { id: string; wert: Wert }

/* Verbrauch eines Drucks je ACE-Slot — Grundlage für den Buchungsvorschlag im Druckwerk */
export interface SlotVerbrauch {
  slot: number;            // 1..4 (Anzeige; intern index + 1)
  gramm: number;           // verbraucht (bei Abbruch hochgerechnet aus den mm)
  geplant: number;         // laut Slicer
  farbe: string; material: string; sku: string; manuell: boolean;
  restVorher: number | null; restNachher: number | null;   // consumables_percent
}
export interface Verbrauch {
  taskid: string; datei: string; ergebnis: "fertig" | "abgebrochen" | "fehler";
  start: string | null; ende: string; mm: number; quelle: "plan" | "mm";
  slots: SlotVerbrauch[];
}
export interface Plan { taskid: string; gramm: number[]; material: string }

const ZUSTAND: Record<string, string> = {
  downloading: "lädt", checking: "prüft", fod: "prüft", auto_leveling: "nivelliert", preheating: "heizt",
  printing: "druckt", pausing: "pausiert", paused: "pausiert", resuming: "setzt_fort", resumed: "druckt",
  finished: "fertig", stopping: "bricht_ab", stoped: "abgebrochen", failed: "fehler",
};
/* in diesen Zuständen gehören progress/remain_time/curr_layer zum laufenden Job */
const JOBWERTE_GUELTIG = new Set(["preheating", "printing", "pausing", "paused", "resuming", "resumed", "finished", "stopping", "stoped", "failed"]);
const ENDE: Record<string, Verbrauch["ergebnis"]> = { finished: "fertig", stoped: "abgebrochen", failed: "fehler" };

/* g je mm Filament 1,75 mm: Querschnitt 2,405 mm² × Dichte */
const DICHTE: Record<string, number> = { PLA: 1.24, PETG: 1.27, ABS: 1.04, ASA: 1.07, TPU: 1.21, PA: 1.14, PC: 1.2 };
export const grammJeMm = (material: string) => 0.0024053 * (DICHTE[material?.toUpperCase().replace(/[^A-Z]/g, "")] ?? 1.24);

const hex = (c: unknown) => Array.isArray(c) && c.length >= 3
  ? "#" + c.slice(0, 3).map((x) => Math.max(0, Math.min(255, Number(x) || 0)).toString(16).padStart(2, "0")).join("")
  : "";
const zahl = (v: unknown): number | null => (v === null || v === undefined || v === "" || isNaN(Number(v)) ? null : Number(v));
const iso = (ms: number) => new Date(ms).toISOString();

export class Druckerbild {
  /* zuletzt geschriebene Werte (ohne Präfix) — schreibt nur Änderungen */
  werte = new Map<string, Wert>();
  plan: Plan | null = null;
  verlauf: Verbrauch[] = [];
  private jobStart: string | null = null;
  private restBeiStart: (number | null)[] = [];
  private slots: { farbe: string; material: string; sku: string; rest: number | null; manuell: boolean }[] = [];
  private taskid = "";
  private datei = "";
  private mm = 0;

  constructor(gemerkt?: { plan?: Plan | null; verlauf?: Verbrauch[]; job?: { taskid: string; start: string | null; rest: (number | null)[] } }) {
    this.plan = gemerkt?.plan ?? null;
    this.verlauf = gemerkt?.verlauf ?? [];
    if (gemerkt?.job) { this.taskid = gemerkt.job.taskid; this.jobStart = gemerkt.job.start; this.restBeiStart = gemerkt.job.rest; }
  }

  /* Zustand, der einen Adapter-Neustart überleben muss (main.ts legt ihn in job.merker ab) */
  merker() { return { plan: this.plan, job: { taskid: this.taskid, start: this.jobStart, rest: this.restBeiStart } }; }

  private setze(aus: Schreib[], id: string, wert: Wert, schwelle = 0) {
    if (wert === undefined) return;
    const alt = this.werte.get(id);
    if (alt === wert) return;
    if (schwelle && typeof alt === "number" && typeof wert === "number" && Math.abs(alt - wert) < schwelle) return;
    this.werte.set(id, wert);
    aus.push({ id, wert });
  }

  /* ---------- REST ---------- */

  /* getPrinters-Eintrag: Stammdaten + Zähler */
  ausListe(d: any): Schreib[] {
    const a: Schreib[] = [];
    this.setze(a, "name", d.name ?? "");
    this.setze(a, "modell", d.model ?? "");
    this.setze(a, "online", d.device_status === 1);
    this.setze(a, "statistik.drucke", zahl(d.print_count));
    this.setze(a, "statistik.druckzeit", d.print_totaltime ?? "");
    this.setze(a, "statistik.material", d.material_used ?? "");
    return a;
  }

  /* /v2/printer/info: vollständiger Ist-Zustand (Start + Abgleich) */
  ausInfo(i: any): Schreib[] {
    const a: Schreib[] = [];
    this.setze(a, "online", i.device_status === 1);
    this.setze(a, "firmware", i.version?.firmware_version ?? "");
    this.setze(a, "firmwareUpdate", i.version?.need_update === 1);
    if (i.parameter) this.temperaturen(a, i.parameter);
    const box = Array.isArray(i.multi_color_box) ? i.multi_color_box[0] : i.multi_color_box;
    if (box) this.ace(a, box);
    const p = i.project;
    if (p && p.print_status === 1) {
      /* läuft gerade — Jobwerte übernehmen, Zustand aus pause ableiten */
      this.jobBeginn(a, String(p.task_id ?? ""), p.name ?? "", Date.now() - (Number(p.print_time) || 0) * 60_000);
      this.setze(a, "zustand", p.pause ? "pausiert" : (this.werte.get("zustand") as string) || "druckt");
      this.jobwerte(a, { progress: p.progress, remain_time: p.remain_time, print_time: p.print_time, curr_layer: p.curr_layer, total_layers: p.total_layers, supplies_usage: p.supplies_usage });
      const planG = Number(p.estimate_supplies_usage_g) || (this.plan?.taskid === this.taskid ? this.plan.gramm.reduce((x, y) => x + y, 0) : 0);
      if (planG) this.setze(a, "job.filamentPlanG", Math.round(planG * 100) / 100);
      this.setze(a, "belegt", true);
    } else if (!this.werte.has("zustand")) {
      this.setze(a, "zustand", "frei");
      this.setze(a, "belegt", false);
    }
    return a;
  }

  /* Slicer-Plan aus getProjects (slice_result „filament used [g]“), falls PrintStart verpasst wurde */
  planAusProjekt(p: any) {
    if (!p || this.plan?.taskid === String(p.taskid)) return;
    try {
      const sr = typeof p.slice_result === "string" ? JSON.parse(p.slice_result) : p.slice_result;
      const g = sr?.["filament used [g]"];
      const sp = typeof p.slice_param === "string" ? JSON.parse(p.slice_param) : p.slice_param;
      const mat = (sp?.paint_infos ?? []).map((x: any) => x.material_type).filter(Boolean).join(";") || String(sp?.filament_type ?? "");
      if (Array.isArray(g)) this.plan = { taskid: String(p.taskid), gramm: g.map(Number), material: mat };
    } catch { /* kein Plan */ }
  }

  /* ---------- MQTT ---------- */

  ausMqtt(m: any, jetzt = Date.now()): Schreib[] {
    const a: Schreib[] = [];
    if (!m || typeof m !== "object" || !m.type) return a;      // …/response-Quittungen
    const d = m.data && typeof m.data === "object" ? m.data : {};
    const art = `${m.type}/${m.action}/${m.state}`;
    if (m.code != null && m.code !== 200 && m.type !== "buried") {
      this.setze(a, "meldung.letzteCode", Number(m.code));
      this.setze(a, "meldung.letzteText", String(m.msg ?? ""));
      this.setze(a, "meldung.letzteRoh", art);
      this.setze(a, "meldung.letzteZeit", iso(jetzt));
    }
    switch (m.type) {
      case "print": this.druck(a, m, d, jetzt); break;
      case "status":
        if (m.action === "workReport") this.setze(a, "belegt", m.state === "busy");
        if (m.action === "onlineReport") this.setze(a, "online", m.state !== "offline");
        break;
      case "lastWill": this.setze(a, "online", false); break;
      case "tempature": this.temperaturen(a, d); break;
      case "fan":
        this.setze(a, "luefter.bauteil", zahl(d.fan_speed_pct));
        this.setze(a, "luefter.hilfs", zahl(d.aux_fan_speed_pct));
        this.setze(a, "luefter.ace", zahl(d.box_fan_level));
        break;
      case "light": {
        const l = Array.isArray(d.lights) ? d.lights[0] : d;
        if (l && "status" in l) { this.setze(a, "licht", l.status === 1); this.setze(a, "lichtHelligkeit", zahl(l.brightness)); }
        break;
      }
      case "aiSettings":
        if (d.ai_settings) {
          this.setze(a, "ki.aktiv", d.ai_settings.status !== 0);
          this.setze(a, "ki.empfindlichkeit", JSON.stringify(d.ai_settings.sensitivity_level ?? null));
        }
        break;
      case "multiColorBox":
        if (Array.isArray(d.multi_color_box) && d.multi_color_box[0]) this.ace(a, d.multi_color_box[0]);
        if ("loaded_slot" in d && !Array.isArray(d.multi_color_box)) this.setze(a, "ace.aktiverSlot", Number(d.loaded_slot) + 1);
        break;
      case "buried":
        if (m.action === "PrintStart" && d.taskid) {
          const g = String(d.print_filaments_weight ?? "").replace(/g\s*$/i, "").split(",").map((x) => Number(x.trim()));
          if (g.length && g.every((x) => !isNaN(x))) this.plan = { taskid: String(d.taskid), gramm: g, material: String(d.print_filaments ?? "") };
          this.setze(a, "job.filamentPlanG", zahl(d.estimate_weight));
          if (d.storage_total) this.setze(a, "speicher.belegtProzent", Math.round((Number(d.storage_used) / Number(d.storage_total)) * 100));
        }
        break;
    }
    return a;
  }

  private druck(a: Schreib[], m: any, d: any, jetzt: number) {
    const state = String(m.state);
    const tid = d.taskid ? String(d.taskid) : this.taskid;
    if (tid && tid !== this.taskid && state !== "finished" && state !== "stoped") this.jobBeginn(a, tid, d.display_filename ?? d.filename ?? "", jetzt);
    if (d.display_filename || d.filename) {
      this.datei = String(d.display_filename ?? d.filename).replace(/\.gcode$/i, "");
      this.setze(a, "job.datei", this.datei);
    }
    if (d.source_info?.models) this.setze(a, "job.modelle", d.source_info.models.map((x: any) => x.name).join(", "));
    if (d.source_info?.plate_index != null) this.setze(a, "job.platte", Number(d.source_info.plate_index));
    this.setze(a, "zustandRoh", `print/${m.action}/${state}`);
    if (ZUSTAND[state]) this.setze(a, "zustand", ZUSTAND[state]);
    if (state === "downloading") this.setze(a, "job.ladenProzent", zahl(d.progress));
    if (JOBWERTE_GUELTIG.has(state)) this.jobwerte(a, d);
    if (m.action === "pause" && m.code != null) {
      this.setze(a, "job.pauseCode", Number(m.code));
      this.setze(a, "job.pauseGrund", m.code === 10401 ? "Benutzer" : String(m.msg ?? "Fehlerpause"));
    }
    if (state === "resumed") { this.setze(a, "job.pauseCode", 0); this.setze(a, "job.pauseGrund", ""); }
    if (ENDE[state]) this.jobEnde(a, ENDE[state], jetzt);
  }

  private jobBeginn(a: Schreib[], taskid: string, datei: string, jetzt = Date.now()) {
    if (taskid === this.taskid) return;
    this.taskid = taskid;
    this.jobStart = iso(jetzt);
    this.mm = 0;
    this.restBeiStart = this.slots.map((s) => s.rest);
    this.setze(a, "job.taskId", taskid);
    this.setze(a, "job.start", this.jobStart);
    this.setze(a, "job.ende", "");
    this.setze(a, "job.pauseCode", 0);
    this.setze(a, "job.pauseGrund", "");
    this.setze(a, "job.modelle", "");
    this.setze(a, "job.filamentMm", 0);
    this.setze(a, "job.filamentG", 0);
    if (datei) this.setze(a, "job.datei", datei.replace(/\.gcode$/i, ""));
    this.setze(a, "ereignis.fertig", false);
  }

  private jobwerte(a: Schreib[], d: any) {
    this.setze(a, "job.fortschritt", zahl(d.progress));
    this.setze(a, "job.restzeit", zahl(d.remain_time));
    this.setze(a, "job.laufzeit", zahl(d.print_time));
    this.setze(a, "job.schicht", zahl(d.curr_layer));
    this.setze(a, "job.schichten", zahl(d.total_layers));
    if (zahl(d.supplies_usage) !== null) {
      this.mm = Number(d.supplies_usage);
      this.setze(a, "job.filamentMm", this.mm);
      this.setze(a, "job.filamentG", Math.round(this.mm * grammJeMm(this.hauptmaterial()) * 10) / 10);
    }
  }

  private hauptmaterial(): string {
    if (this.plan?.taskid === this.taskid) {
      const i = this.plan.gramm.indexOf(Math.max(...this.plan.gramm));
      return this.slots[i]?.material || this.plan.material.split(";")[0] || "PLA";
    }
    const aktiv = Number(this.werte.get("ace.aktiverSlot") ?? 0) - 1;
    return this.slots[aktiv]?.material || "PLA";
  }

  private jobEnde(a: Schreib[], ergebnis: Verbrauch["ergebnis"], jetzt: number) {
    const ende = iso(jetzt);
    this.setze(a, "job.ende", ende);
    this.setze(a, "belegt", false);
    if (ergebnis === "fertig") {
      this.setze(a, "ereignis.fertig", true);
      this.setze(a, "job.restzeit", 0);
    }
    if (!this.taskid || this.verlauf.some((v) => v.taskid === this.taskid)) return;
    const v = this.verbrauch(ergebnis, ende);
    if (v) {
      this.verlauf = [v, ...this.verlauf].slice(0, 30);
      this.setze(a, "verbrauch.letzter", JSON.stringify(v));
      this.setze(a, "verbrauch.verlauf", JSON.stringify(this.verlauf));
    }
  }

  /* Verbrauch je Slot: fertig → Slicer-Plan; Abbruch → tatsächliche mm × g/mm, nach Plananteilen verteilt.
     Ohne Plan: alles auf den aktiven Slot. */
  private verbrauch(ergebnis: Verbrauch["ergebnis"], ende: string): Verbrauch | null {
    const plan = this.plan?.taskid === this.taskid ? this.plan.gramm : null;
    const ist = this.mm * grammJeMm(this.hauptmaterial());
    let gramm: number[]; let geplant: number[]; let quelle: Verbrauch["quelle"];
    if (plan && plan.some((g) => g > 0)) {
      const summe = plan.reduce((s, g) => s + g, 0);
      const faktor = ergebnis === "fertig" ? 1 : Math.min(1, ist / summe);
      gramm = plan.map((g) => g * faktor); geplant = plan; quelle = ergebnis === "fertig" ? "plan" : "mm";
    } else {
      const aktiv = Number(this.werte.get("ace.aktiverSlot") ?? 0) - 1;
      if (aktiv < 0 || !ist) return null;
      gramm = this.slots.map((_, i) => (i === aktiv ? ist : 0)); geplant = gramm.map(() => 0); quelle = "mm";
    }
    const slots: SlotVerbrauch[] = [];
    gramm.forEach((g, i) => {
      if (g < 0.5) return;
      const s = this.slots[i] ?? { farbe: "", material: "", sku: "", rest: null, manuell: false };
      slots.push({ slot: i + 1, gramm: Math.round(g * 10) / 10, geplant: Math.round((geplant[i] ?? 0) * 10) / 10,
        farbe: s.farbe, material: s.material, sku: s.sku, manuell: s.manuell, restVorher: this.restBeiStart[i] ?? null, restNachher: s.rest });
    });
    if (!slots.length) return null;
    return { taskid: this.taskid, datei: this.datei, ergebnis, start: this.jobStart, ende, mm: this.mm, quelle, slots };
  }

  private temperaturen(a: Schreib[], d: any) {
    this.setze(a, "temp.duese", zahl(d.curr_nozzle_temp), 1);
    this.setze(a, "temp.dueseSoll", zahl(d.target_nozzle_temp));
    this.setze(a, "temp.bett", zahl(d.curr_hotbed_temp), 1);
    this.setze(a, "temp.bettSoll", zahl(d.target_hotbed_temp));
  }

  private ace(a: Schreib[], b: any) {
    if ("temp" in b) this.setze(a, "ace.temp", zahl(b.temp));
    if ("humidity" in b) this.setze(a, "ace.feuchte", zahl(b.humidity));
    if ("loaded_slot" in b) this.setze(a, "ace.aktiverSlot", Number(b.loaded_slot) + 1);   // 0 = keiner
    if ("auto_feed" in b) this.setze(a, "ace.autoFeed", b.auto_feed === 1);
    const t = b.drying_status;
    if (t) {
      this.setze(a, "ace.trocknen.aktiv", t.status === 1);
      this.setze(a, "ace.trocknen.zielTemp", zahl(t.target_temp));
      this.setze(a, "ace.trocknen.dauer", zahl(t.duration));
      this.setze(a, "ace.trocknen.restzeit", zahl(t.remain_time));
      if (t.humidity != null) this.setze(a, "ace.feuchte", zahl(t.humidity));
    }
    for (const s of Array.isArray(b.slots) ? b.slots : []) {
      const i = Number(s.index);
      if (!(i >= 0 && i < 16)) continue;
      const alt = this.slots[i] ?? { farbe: "", material: "", sku: "", rest: null, manuell: false };
      /* edit_status 1 = am Drucker von Hand eingetragen (Rolle ohne RFID): SKU ist dann ein Überbleibsel,
         consumables_percent steht auf 0 und ist KEIN Messwert → Rest leer lassen */
      const manuell = "edit_status" in s ? s.edit_status === 1 : alt.manuell;
      const prozent = "consumables_percent" in s ? zahl(s.consumables_percent) : alt.rest;
      const neu = { farbe: "color" in s ? hex(s.color) : alt.farbe, material: s.type ?? alt.material, sku: manuell ? "" : (s.sku ?? alt.sku),
        rest: manuell && !prozent ? null : prozent, manuell };
      this.slots[i] = neu;
      const p = `ace.slot${i + 1}`;
      this.setze(a, `${p}.farbe`, neu.farbe);
      this.setze(a, `${p}.material`, neu.material);
      this.setze(a, `${p}.sku`, neu.sku);
      this.setze(a, `${p}.restProzent`, neu.rest);
      this.setze(a, `${p}.manuell`, neu.manuell);
      if ("status" in s) this.setze(a, `${p}.status`, zahl(s.status));
    }
    if (Array.isArray(b.slots) && b.slots.length)
      this.setze(a, "ace.slots", JSON.stringify(this.slots.map((s, i) => ({ slot: i + 1, ...s }))));
  }
}
