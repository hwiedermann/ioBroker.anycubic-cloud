/* Objektdefinitionen je Datenpunkt (relativ zum Drucker-Kanal). Alles nur lesend (write: false) —
   Befehle sind nicht vorgesehen. Unbekannte IDs bekommen eine neutrale Definition (siehe definition()). */

type Def = { name: string; type: "number" | "string" | "boolean"; role: string; unit?: string; states?: Record<string, string> };

const D: Record<string, Def> = {
  name: { name: "Name", type: "string", role: "info.name" },
  modell: { name: "Modell", type: "string", role: "info.hardware" },
  firmware: { name: "Firmware", type: "string", role: "info.firmware" },
  firmwareUpdate: { name: "Firmware-Update verfügbar", type: "boolean", role: "indicator" },
  online: { name: "Online", type: "boolean", role: "indicator.reachable" },
  belegt: { name: "Belegt (workReport busy)", type: "boolean", role: "indicator.working" },
  zustand: { name: "Zustand", type: "string", role: "text",
    states: Object.fromEntries(["frei", "lädt", "prüft", "nivelliert", "heizt", "druckt", "pausiert", "setzt_fort", "fertig", "bricht_ab", "abgebrochen", "fehler"].map((z) => [z, z])) },
  zustandRoh: { name: "Letzte Druckmeldung roh (type/action/state)", type: "string", role: "text" },
  "statistik.drucke": { name: "Drucke gesamt", type: "number", role: "value" },
  "statistik.druckzeit": { name: "Druckzeit gesamt", type: "string", role: "text" },
  "statistik.material": { name: "Material gesamt", type: "string", role: "text" },
  "speicher.belegtProzent": { name: "Gerätespeicher belegt", type: "number", role: "value", unit: "%" },

  "job.taskId": { name: "Task-ID", type: "string", role: "text" },
  "job.datei": { name: "Datei", type: "string", role: "text" },
  "job.modelle": { name: "Modelle", type: "string", role: "text" },
  "job.platte": { name: "Platte", type: "number", role: "value" },
  "job.ladenProzent": { name: "Datei laden", type: "number", role: "value", unit: "%" },
  "job.fortschritt": { name: "Fortschritt", type: "number", role: "value.progress", unit: "%" },
  "job.restzeit": { name: "Restzeit", type: "number", role: "value.interval", unit: "min" },
  "job.laufzeit": { name: "Laufzeit", type: "number", role: "value.interval", unit: "min" },
  "job.schicht": { name: "Schicht", type: "number", role: "value" },
  "job.schichten": { name: "Schichten gesamt", type: "number", role: "value" },
  "job.filamentMm": { name: "Filament bisher", type: "number", role: "value", unit: "mm" },
  "job.filamentG": { name: "Filament bisher (aus mm)", type: "number", role: "value", unit: "g" },
  "job.filamentPlanG": { name: "Filament laut Slicer", type: "number", role: "value", unit: "g" },
  "job.start": { name: "Start", type: "string", role: "date" },
  "job.ende": { name: "Ende", type: "string", role: "date" },
  "job.pauseCode": { name: "Pause-Code (10401 = Benutzer)", type: "number", role: "value" },
  "job.pauseGrund": { name: "Pause-Grund", type: "string", role: "text" },
  "job.merker": { name: "Interner Merker (Plan, Jobstart)", type: "string", role: "json" },

  "temp.duese": { name: "Düse", type: "number", role: "value.temperature", unit: "°C" },
  "temp.dueseSoll": { name: "Düse Soll", type: "number", role: "value.temperature", unit: "°C" },
  "temp.bett": { name: "Bett", type: "number", role: "value.temperature", unit: "°C" },
  "temp.bettSoll": { name: "Bett Soll", type: "number", role: "value.temperature", unit: "°C" },
  "luefter.bauteil": { name: "Bauteillüfter", type: "number", role: "value", unit: "%" },
  "luefter.hilfs": { name: "Hilfslüfter", type: "number", role: "value", unit: "%" },
  "luefter.ace": { name: "ACE-Lüfter (Stufe)", type: "number", role: "value" },
  licht: { name: "Licht", type: "boolean", role: "sensor.light" },
  lichtHelligkeit: { name: "Licht Helligkeit", type: "number", role: "value", unit: "%" },
  "ki.aktiv": { name: "KI-Überwachung aktiv", type: "boolean", role: "indicator" },
  "ki.empfindlichkeit": { name: "KI-Empfindlichkeit (roh)", type: "string", role: "json" },

  "ace.temp": { name: "ACE Temperatur", type: "number", role: "value.temperature", unit: "°C" },
  "ace.feuchte": { name: "ACE Feuchte", type: "number", role: "value.humidity", unit: "%" },
  "ace.aktiverSlot": { name: "Geladener Slot (0 = keiner)", type: "number", role: "value" },
  "ace.autoFeed": { name: "Auto-Nachführung", type: "boolean", role: "indicator" },
  "ace.slots": { name: "Alle Slots (JSON)", type: "string", role: "json" },
  "ace.trocknen.aktiv": { name: "Trocknen aktiv", type: "boolean", role: "indicator" },
  "ace.trocknen.zielTemp": { name: "Trocknen Zieltemperatur", type: "number", role: "value.temperature", unit: "°C" },
  "ace.trocknen.dauer": { name: "Trocknen Dauer", type: "number", role: "value.interval", unit: "min" },
  "ace.trocknen.restzeit": { name: "Trocknen Restzeit", type: "number", role: "value.interval", unit: "min" },

  "meldung.letzteCode": { name: "Letzter Meldungscode (≠ 200)", type: "number", role: "value" },
  "meldung.letzteText": { name: "Letzter Meldungstext (Anzeige)", type: "string", role: "text" },
  "meldung.letzteRoh": { name: "Letzte Meldung roh", type: "string", role: "text" },
  "meldung.letzteZeit": { name: "Letzte Meldung Zeit", type: "string", role: "date" },
  "ereignis.fertig": { name: "Druck fertig (true bei finished, false bei neuem Job)", type: "boolean", role: "indicator" },
  "verbrauch.letzter": { name: "Verbrauch letzter Druck je Slot (JSON)", type: "string", role: "json" },
  "verbrauch.verlauf": { name: "Verbrauch der letzten 30 Drucke (JSON)", type: "string", role: "json" },
};

const SLOT: Record<string, Def> = {
  farbe: { name: "Farbe", type: "string", role: "level.color.rgb" },
  material: { name: "Material", type: "string", role: "text" },
  sku: { name: "SKU (RFID)", type: "string", role: "text" },
  restProzent: { name: "Restmenge", type: "number", role: "value.fill", unit: "%" },
  status: { name: "Status (roh)", type: "number", role: "value" },
  manuell: { name: "Von Hand eingetragen (ohne RFID, kein Restwert)", type: "boolean", role: "indicator" },
};

export function definition(id: string): Def {
  const s = id.match(/^ace\.slot(\d+)\.(\w+)$/);
  if (s && SLOT[s[2]]) return { ...SLOT[s[2]], name: `Slot ${s[1]} ${SLOT[s[2]].name}` };
  return D[id] ?? { name: id, type: "string", role: "state" };
}

export const KANAELE: Record<string, string> = {
  job: "Aktueller Druck", temp: "Temperaturen", luefter: "Lüfter", ki: "KI-Überwachung", ace: "ACE Pro",
  "ace.trocknen": "Trocknen", meldung: "Meldungen", ereignis: "Ereignisse", verbrauch: "Filamentverbrauch",
  statistik: "Statistik", speicher: "Gerätespeicher",
};
