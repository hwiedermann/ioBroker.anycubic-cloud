/* Object definitions per state, relative to the printer device. Everything is read-only.
   Unknown IDs get a neutral definition, see definition(). */

import { slotName, tr, type Name } from './i18n.ts';

type Def = {
    name: Name;
    type: 'number' | 'string' | 'boolean';
    role: string;
    unit?: string;
    states?: Record<string, string>;
};

const n = tr;

export const STATUS_VALUES = [
    'idle',
    'downloading',
    'checking',
    'leveling',
    'heating',
    'printing',
    'paused',
    'resuming',
    'finished',
    'stopping',
    'stopped',
    'error',
];

const D: Record<string, Def> = {
    name: { name: n('Name', 'Name'), type: 'string', role: 'info.name' },
    model: { name: n('Model', 'Modell'), type: 'string', role: 'info.hardware' },
    firmware: { name: n('Firmware', 'Firmware'), type: 'string', role: 'info.firmware' },
    firmwareUpdate: {
        name: n('Firmware update available', 'Firmware-Update verfügbar'),
        type: 'boolean',
        role: 'indicator',
    },
    online: { name: n('Online', 'Online'), type: 'boolean', role: 'indicator.reachable' },
    busy: { name: n('Busy', 'Belegt'), type: 'boolean', role: 'indicator.working' },
    status: {
        name: n('Status', 'Zustand'),
        type: 'string',
        role: 'text',
        states: Object.fromEntries(STATUS_VALUES.map(s => [s, s])),
    },
    statusRaw: {
        name: n('Last print message (type/action/state)', 'Letzte Druckmeldung (type/action/state)'),
        type: 'string',
        role: 'text',
    },
    light: { name: n('Light', 'Licht'), type: 'boolean', role: 'sensor.light' },
    lightBrightness: {
        name: n('Light brightness', 'Licht Helligkeit'),
        type: 'number',
        role: 'value',
        unit: '%',
    },

    'statistics.prints': { name: n('Total prints', 'Drucke gesamt'), type: 'number', role: 'value' },
    'statistics.printTime': { name: n('Total print time', 'Druckzeit gesamt'), type: 'string', role: 'text' },
    'statistics.material': { name: n('Total material', 'Material gesamt'), type: 'string', role: 'text' },
    'storage.usedPercent': {
        name: n('Device storage used', 'Gerätespeicher belegt'),
        type: 'number',
        role: 'value',
        unit: '%',
    },

    'job.taskId': { name: n('Task ID', 'Task-ID'), type: 'string', role: 'text' },
    'job.file': { name: n('File', 'Datei'), type: 'string', role: 'text' },
    'job.models': { name: n('Models', 'Modelle'), type: 'string', role: 'text' },
    'job.plate': { name: n('Plate', 'Platte'), type: 'number', role: 'value' },
    'job.downloadProgress': {
        name: n('File download', 'Datei laden'),
        type: 'number',
        role: 'value',
        unit: '%',
    },
    'job.progress': { name: n('Progress', 'Fortschritt'), type: 'number', role: 'value.progress', unit: '%' },
    'job.remainingTime': {
        name: n('Remaining time', 'Restzeit'),
        type: 'number',
        role: 'value.interval',
        unit: 'm',
    },
    'job.elapsedTime': {
        name: n('Elapsed time', 'Laufzeit'),
        type: 'number',
        role: 'value.interval',
        unit: 'm',
    },
    'job.layer': { name: n('Layer', 'Schicht'), type: 'number', role: 'value' },
    'job.layerTotal': { name: n('Total layers', 'Schichten gesamt'), type: 'number', role: 'value' },
    'job.filamentMm': {
        name: n('Filament used so far', 'Filament bisher'),
        type: 'number',
        role: 'value',
        unit: 'mm',
    },
    'job.filamentG': {
        name: n('Filament used so far (from mm)', 'Filament bisher (aus mm)'),
        type: 'number',
        role: 'value',
        unit: 'g',
    },
    'job.filamentPlannedG': {
        name: n('Filament according to slicer', 'Filament laut Slicer'),
        type: 'number',
        role: 'value',
        unit: 'g',
    },
    'job.start': { name: n('Start', 'Start'), type: 'string', role: 'date' },
    'job.end': { name: n('End', 'Ende'), type: 'string', role: 'date' },
    'job.pauseCode': {
        name: n('Pause code (10401 = user)', 'Pause-Code (10401 = Benutzer)'),
        type: 'number',
        role: 'value',
    },
    'job.pauseReason': { name: n('Pause reason', 'Pause-Grund'), type: 'string', role: 'text' },
    'job.internal': {
        name: n('Internal memo (plan, job start)', 'Interner Merker (Plan, Jobstart)'),
        type: 'string',
        role: 'json',
    },

    'temperature.nozzle': { name: n('Nozzle', 'Düse'), type: 'number', role: 'value.temperature', unit: '°C' },
    'temperature.nozzleTarget': {
        name: n('Nozzle target', 'Düse Soll'),
        type: 'number',
        role: 'value.temperature',
        unit: '°C',
    },
    'temperature.bed': { name: n('Bed', 'Bett'), type: 'number', role: 'value.temperature', unit: '°C' },
    'temperature.bedTarget': {
        name: n('Bed target', 'Bett Soll'),
        type: 'number',
        role: 'value.temperature',
        unit: '°C',
    },
    'fan.part': { name: n('Part cooling fan', 'Bauteillüfter'), type: 'number', role: 'value', unit: '%' },
    'fan.auxiliary': { name: n('Auxiliary fan', 'Hilfslüfter'), type: 'number', role: 'value', unit: '%' },
    'fan.ace': { name: n('ACE fan (level)', 'ACE-Lüfter (Stufe)'), type: 'number', role: 'value' },
    'ai.enabled': { name: n('AI monitoring enabled', 'KI-Überwachung aktiv'), type: 'boolean', role: 'indicator' },
    'ai.sensitivity': {
        name: n('AI sensitivity (raw)', 'KI-Empfindlichkeit (roh)'),
        type: 'string',
        role: 'json',
    },

    'ace.temperature': {
        name: n('ACE temperature', 'ACE Temperatur'),
        type: 'number',
        role: 'value.temperature',
        unit: '°C',
    },
    'ace.humidity': { name: n('ACE humidity', 'ACE Feuchte'), type: 'number', role: 'value.humidity', unit: '%' },
    'ace.activeSlot': {
        name: n('Loaded slot (0 = none)', 'Geladener Slot (0 = keiner)'),
        type: 'number',
        role: 'value',
    },
    'ace.autoFeed': { name: n('Auto feed', 'Auto-Nachführung'), type: 'boolean', role: 'indicator' },
    'ace.slots': { name: n('All slots (JSON)', 'Alle Slots (JSON)'), type: 'string', role: 'json' },
    'ace.drying.active': { name: n('Drying active', 'Trocknen aktiv'), type: 'boolean', role: 'indicator' },
    'ace.drying.targetTemperature': {
        name: n('Drying target temperature', 'Trocknen Zieltemperatur'),
        type: 'number',
        role: 'value.temperature',
        unit: '°C',
    },
    'ace.drying.duration': {
        name: n('Drying duration', 'Trocknen Dauer'),
        type: 'number',
        role: 'value.interval',
        unit: 'm',
    },
    'ace.drying.remainingTime': {
        name: n('Drying remaining time', 'Trocknen Restzeit'),
        type: 'number',
        role: 'value.interval',
        unit: 'm',
    },

    'message.lastCode': {
        name: n('Last message code (≠ 200)', 'Letzter Meldungscode (≠ 200)'),
        type: 'number',
        role: 'value',
    },
    'message.lastText': { name: n('Last message text', 'Letzter Meldungstext'), type: 'string', role: 'text' },
    'message.lastRaw': { name: n('Last message raw', 'Letzte Meldung roh'), type: 'string', role: 'text' },
    'message.lastTime': { name: n('Last message time', 'Letzte Meldung Zeit'), type: 'string', role: 'date' },
    'event.finished': {
        name: n(
            'Print finished (true when finished, false on a new job)',
            'Druck fertig (true bei Ende, false bei neuem Job)',
        ),
        type: 'boolean',
        role: 'indicator',
    },
    'usage.last': {
        name: n('Filament usage of the last print per slot (JSON)', 'Verbrauch letzter Druck je Slot (JSON)'),
        type: 'string',
        role: 'json',
    },
    'usage.history': {
        name: n('Filament usage of the last 30 prints (JSON)', 'Verbrauch der letzten 30 Drucke (JSON)'),
        type: 'string',
        role: 'json',
    },
};

const SLOT: Record<string, Def> = {
    /* read-only: level.* roles require write = true, there is no read-only colour role */
    color: { name: n('color', 'Farbe'), type: 'string', role: 'text' },
    material: { name: n('material', 'Material'), type: 'string', role: 'text' },
    sku: { name: n('SKU (RFID)', 'SKU (RFID)'), type: 'string', role: 'text' },
    remaining: { name: n('remaining', 'Restmenge'), type: 'number', role: 'value.fill', unit: '%' },
    status: { name: n('status (raw)', 'Status (roh)'), type: 'number', role: 'value' },
    manual: {
        name: n('entered by hand (no RFID, no remaining value)', 'von Hand eingetragen (ohne RFID, kein Restwert)'),
        type: 'boolean',
        role: 'indicator',
    },
};

/** true if the ID relative to the printer has its own definition (not the neutral fallback) */
export function isKnown(id: string): boolean {
    const s = id.match(/^ace\.slot(\d+)\.(\w+)$/);
    return s ? !!SLOT[s[2]] : !!D[id];
}

export function definition(id: string): Def {
    const s = id.match(/^ace\.slot(\d+)\.(\w+)$/);
    if (s && SLOT[s[2]]) {
        const d = SLOT[s[2]];
        return { ...d, name: slotName(s[1], d.name) };
    }
    return D[id] ?? { name: n(id, id), type: 'string', role: 'state' };
}

export const CHANNELS: Record<string, Name> = {
    job: n('Current print', 'Aktueller Druck'),
    temperature: n('Temperatures', 'Temperaturen'),
    fan: n('Fans', 'Lüfter'),
    ai: n('AI monitoring', 'KI-Überwachung'),
    ace: n('ACE Pro', 'ACE Pro'),
    'ace.drying': n('Drying', 'Trocknen'),
    message: n('Messages', 'Meldungen'),
    event: n('Events', 'Ereignisse'),
    usage: n('Filament usage', 'Filamentverbrauch'),
    statistics: n('Statistics', 'Statistik'),
    storage: n('Device storage', 'Gerätespeicher'),
};
