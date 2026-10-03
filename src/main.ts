/* ioBroker-Adapter anycubic-cloud — liest Druckerstatus, Druckauftrag und ACE über die Anycubic-Cloud.
   REST beim Start und als Abgleich, MQTT für Echtzeit. Der Adapter ist rein lesend: es gibt bewusst
   kein publish und kein sendOrder, er schickt also keine Befehle an den Drucker. */
import * as utils from '@iobroker/adapter-core';
import mqtt, { type MqttClient } from 'mqtt';
import { Druckerbild, type Schreib } from './lib/druckerbild.ts';
import { kennungenAus, paketLaden } from './lib/kennungen.ts';
import { ENDPUNKT, MQTT_HOST, MQTT_PORT } from './lib/konstanten.ts';
import { abos, mqttLogin, zertifikateAus } from './lib/mqtt-login.ts';
import { AnycubicRest } from './lib/rest.ts';
import { jwtNutzlast } from './lib/signatur.ts';
import { definition, KANAELE } from './lib/zustaende.ts';

declare global {
    namespace ioBroker {
        interface AdapterConfig {
            token: string;
            restMinuten: number;
            tokenWarnTage: number;
        }
    }
}

interface Drucker {
    id: string;
    key: string;
    machine_type: number;
    bild: Druckerbild;
    merker: string;
}

/* Backoff für den MQTT-Reconnect (ms): nach Erfolg zurück auf den ersten Wert */
const BACKOFF = [5_000, 10_000, 30_000, 60_000, 300_000];
/* Zustände, in denen laufend MQTT-Meldungen zu erwarten sind (für den Totmann-Wächter) */
const AKTIV = new Set(['lädt', 'prüft', 'nivelliert', 'heizt', 'druckt', 'pausiert', 'setzt_fort']);
const STILL_ABGLEICH = 5 * 60_000; // so lange still im Druck → erst REST-Abgleich
const STILL_RECONNECT = 12 * 60_000; // so lange still im Druck → MQTT erzwingen

class AnycubicCloud extends utils.Adapter {
    private api?: AnycubicRest;
    private client?: MqttClient;
    private drucker = new Map<string, Drucker>(); // Schlüssel = Cloud-key (steht im Topic)
    private angelegt = new Set<string>();
    private abgleichTimer?: ioBroker.Interval;
    private taktTimer?: ioBroker.Interval; // Minutentakt: Diagnose, Wächter, letzte Meldung
    private gestoppt = false;
    private backoffStufe = 0;
    private letzteMeldungTs = 0;
    private abgleichLaeuft = false; // Single-Flight: REST-Abfragen nie überlappen
    private reconnectErzwungen = 0;
    /* Diagnose: welche Meldungsarten kommen an (info.meldungen) */
    private zaehler: Record<string, number> = {};

    constructor(options: Partial<utils.AdapterOptions> = {}) {
        super({ ...options, name: 'anycubic-cloud' });
        this.on('ready', () => this.start().catch(e => this.fehlerAus(e)));
        this.on('unload', cb => this.ende(cb));
    }

    private async fehlerAus(e: any) {
        this.log.error(`Start fehlgeschlagen: ${e?.message ?? e}`);
        await this.setStatus('Fehler beim Start').catch(() => {});
    }

    private async setStatus(text: string) {
        await this.setState('info.status', text, true).catch(() => {});
    }

    private async start() {
        await this.zustand('info.status', 'startet', {
            name: 'Status im Klartext',
            type: 'string',
            role: 'text',
        });
        await this.zustand('info.letzteMeldung', '', {
            name: 'Zeitpunkt der letzten MQTT-Meldung',
            type: 'string',
            role: 'date',
        });
        await this.zustand('info.tokenWarnung', false, {
            name: 'Token läuft bald ab',
            type: 'boolean',
            role: 'indicator',
        });
        await this.setState('info.connection', false, true);

        const token = String(this.config.token ?? '').trim();
        if (!token) {
            this.log.warn('Kein Slicer-Token eingetragen (Instanz-Einstellungen).');
            await this.setStatus('kein Token');
            return;
        }

        let exp = 0;
        try {
            exp = Number(jwtNutzlast(token).exp) * 1000;
        } catch {
            this.log.error('Token ist kein gültiges JWT.');
            await this.setStatus('Token ungültig');
            return;
        }
        const tage = Math.floor((exp - Date.now()) / 864e5);
        const warnTage = Math.max(1, Number(this.config.tokenWarnTage) || 14);
        await this.zustand('info.tokenAblauf', new Date(exp).toISOString(), {
            name: 'Token läuft ab',
            type: 'string',
            role: 'date',
        });
        await this.zustand('info.tokenTage', tage, {
            name: 'Token-Resttage',
            type: 'number',
            role: 'value',
            unit: 'd',
        });
        if (exp < Date.now()) {
            this.log.error('Slicer-Token ist abgelaufen — bitte in den Instanz-Einstellungen erneuern.');
            await this.setState('info.tokenWarnung', true, true);
            await this.setStatus('Token abgelaufen');
            return; // bewusst kein Reconnect-Versuch mit totem Token
        }
        const bald = tage <= warnTage;
        await this.setState('info.tokenWarnung', bald, true);
        if (bald) {
            this.log.warn(`Slicer-Token läuft in ${tage} Tagen ab — rechtzeitig erneuern.`);
        }

        await this.setStatus('verbindet');
        const dateien = await paketLaden(utils.getAbsoluteInstanceDataDir(this));
        this.api = new AnycubicRest(kennungenAus(dateien), token);
        await this.api.anmelden();
        const ich = (await this.api.aufruf(ENDPUNKT.benutzer)).data;
        if (!ich?.user_email) {
            throw new Error('Kontodaten ohne E-Mail — Anmeldung unvollständig');
        }

        await this.restAbgleich(true);
        if (!this.drucker.size) {
            this.log.warn('Keine Drucker im Konto gefunden.');
            await this.setStatus('kein Drucker im Konto');
            return;
        }

        const z = zertifikateAus(dateien);
        const login = mqttLogin(this.api.userToken!, ich.user_email, z.ca);
        const liste = [...this.drucker.values()].map(d => ({
            machine_type: d.machine_type,
            key: d.key,
        }));
        this.client = mqtt.connect({
            host: MQTT_HOST,
            port: MQTT_PORT,
            protocol: 'mqtts',
            protocolVersion: 4,
            clean: true,
            keepalive: 60,
            clientId: login.clientId,
            username: login.benutzer,
            password: login.passwort,
            ca: z.ca,
            cert: z.cert,
            key: z.key,
            servername: MQTT_HOST,
            ciphers: 'DEFAULT:@SECLEVEL=0',
            minVersion: 'TLSv1.2',
            rejectUnauthorized: true,
            reconnectPeriod: BACKOFF[0],
            connectTimeout: 30_000,
        } as mqtt.IClientOptions);

        let ersteVerbindung = true;
        this.client.on('connect', () => {
            this.backoffStufe = 0;
            if (this.client) {
                (this.client.options as any).reconnectPeriod = BACKOFF[0];
            }
            this.letzteMeldungTs = Date.now();
            this.log.info('MQTT verbunden');
            this.setState('info.connection', true, true);
            this.setStatus('verbunden');
            for (const t of abos(liste, ich.id)) {
                this.client!.subscribe(t, e => e && this.log.warn(`Abo fehlgeschlagen: ${e.message}`));
            }
            if (!ersteVerbindung) {
                this.restAbgleich().catch(e => this.log.warn(`REST-Abgleich: ${e.message}`));
            }
            ersteVerbindung = false;
        });
        this.client.on('reconnect', () => {
            /* ansteigender Abstand, bis die Verbindung wieder steht */
            this.backoffStufe = Math.min(this.backoffStufe + 1, BACKOFF.length - 1);
            if (this.client) {
                (this.client.options as any).reconnectPeriod = BACKOFF[this.backoffStufe];
            }
            this.setStatus(`wartet (${Math.round(BACKOFF[this.backoffStufe] / 1000)} s)`);
        });
        this.client.on('close', () => {
            if (!this.gestoppt) {
                this.setState('info.connection', false, true);
                this.setStatus('getrennt');
            }
        });
        this.client.on('error', e => this.log.warn(`MQTT: ${e.message}`));
        this.client.on('message', (topic, buf) =>
            this.nachricht(topic, buf).catch(e => this.log.warn(`Meldung verarbeiten: ${e.message}`)),
        );

        await this.zustand('info.meldungen', '{}', {
            name: 'Empfangene Meldungen seit Start je type/action (JSON)',
            type: 'string',
            role: 'json',
        });
        const minuten = Math.max(5, Number(this.config.restMinuten) || 10);
        this.abgleichTimer = this.setInterval(
            () => this.restAbgleich().catch(e => this.log.warn(`REST-Abgleich: ${e.message}`)),
            minuten * 60_000,
        );
        this.taktTimer = this.setInterval(() => this.takt(), 60_000);
    }

    /* Minutentakt: Diagnosezähler schreiben, letzte Meldung festhalten, Totmann-Wächter */
    private takt() {
        this.setState('info.meldungen', JSON.stringify(this.zaehler), true);
        if (this.letzteMeldungTs) {
            this.setState('info.letzteMeldung', new Date(this.letzteMeldungTs).toISOString(), true);
        }
        /* Nur wenn ein Druck läuft, sind laufend Meldungen zu erwarten */
        const aktiv = [...this.drucker.values()].some(d => AKTIV.has(String(d.bild.werte.get('zustand'))));
        if (!aktiv || !this.letzteMeldungTs) {
            return;
        }
        const still = Date.now() - this.letzteMeldungTs;
        if (still > STILL_RECONNECT && this.client) {
            this.log.warn(
                `Seit ${Math.round(still / 60000)} min keine MQTT-Meldung trotz laufendem Druck — Verbindung wird neu aufgebaut.`,
            );
            this.reconnectErzwungen++;
            try {
                this.client.reconnect();
            } catch {
                /* läuft evtl. schon */
            }
            this.letzteMeldungTs = Date.now(); // nicht sofort erneut auslösen
        } else if (still > STILL_ABGLEICH) {
            this.restAbgleich().catch(e => this.log.warn(`REST-Abgleich (Wächter): ${e.message}`));
        }
    }

    /* Druckerliste + printer/info + laufender Job (Plan aus getProjects). Single-Flight: nie überlappend. */
    private async restAbgleich(erst = false) {
        if (this.abgleichLaeuft) {
            return;
        }
        this.abgleichLaeuft = true;
        try {
            const liste = (await this.api!.aufruf<any[]>(ENDPUNKT.drucker)).data ?? [];
            for (const d of liste) {
                const id = String(d.id);
                let dr = this.drucker.get(d.key);
                if (!dr) {
                    await this.setObjectNotExistsAsync(id, {
                        type: 'device',
                        common: { name: d.name ?? id },
                        native: { machine_type: d.machine_type },
                    });
                    const merker = await this.lesen(`${id}.job.merker`);
                    const verlauf = await this.lesen(`${id}.verbrauch.verlauf`);
                    dr = {
                        id,
                        key: d.key,
                        machine_type: d.machine_type,
                        merker: '',
                        bild: new Druckerbild({
                            ...(merker ?? {}),
                            verlauf: Array.isArray(verlauf) ? verlauf : [],
                        }),
                    };
                    this.drucker.set(d.key, dr);
                }
                await this.schreiben(dr, dr.bild.ausListe(d));
                const info = (await this.api!.aufruf(ENDPUNKT.druckerInfo, { query: { id } })).data;
                if (info?.project?.print_status === 1) {
                    const pj =
                        (
                            await this.api!.aufruf<any[]>(ENDPUNKT.projekte, {
                                query: { page: 1, limit: 5 },
                            })
                        ).data ?? [];
                    dr.bild.planAusProjekt(pj.find(p => String(p.taskid) === String(info.project.task_id)));
                }
                if (info) {
                    await this.schreiben(dr, dr.bild.ausInfo(info));
                }
                if (erst) {
                    this.log.info(`Drucker „${d.name}“ (${id}) gefunden, Zustand ${dr.bild.werte.get('zustand')}`);
                }
            }
        } finally {
            this.abgleichLaeuft = false;
        }
    }

    private async nachricht(topic: string, buf: Buffer) {
        if (topic.endsWith('/response')) {
            return;
        } // nur Quittungen {msgid}
        this.letzteMeldungTs = Date.now();
        const dr = [...this.drucker.values()].find(d => topic.includes(`/${d.key}/`));
        if (!dr) {
            return;
        }
        let m: any;
        try {
            m = JSON.parse(buf.toString('utf8'));
        } catch {
            return;
        }
        const art = `${m?.type}/${m?.action}`;
        this.zaehler[art] = (this.zaehler[art] ?? 0) + 1;
        await this.schreiben(dr, dr.bild.ausMqtt(m));
    }

    private async schreiben(dr: Drucker, liste: Schreib[]) {
        for (const s of liste) {
            const id = `${dr.id}.${s.id}`;
            if (!this.angelegt.has(id)) {
                await this.anlegen(dr.id, s.id);
            }
            await this.setState(id, { val: s.wert, ack: true });
            if (s.id === 'ereignis.fertig' && s.wert === true) {
                this.log.info(`Druck fertig: ${dr.bild.werte.get('job.datei')}`);
            }
        }
        /* Merker (Slicer-Plan, Jobstart, Restprozente) nur bei Änderung sichern — überlebt so einen Neustart mitten im Druck */
        const m = JSON.stringify(dr.bild.merker());
        if (m !== dr.merker) {
            dr.merker = m;
            if (!this.angelegt.has(`${dr.id}.job.merker`)) {
                await this.anlegen(dr.id, 'job.merker');
            }
            await this.setState(`${dr.id}.job.merker`, m, true);
        }
    }

    private async anlegen(geraet: string, rel: string) {
        const teile = rel.split('.');
        for (let i = 1; i < teile.length; i++) {
            const k = teile.slice(0, i).join('.');
            if (this.angelegt.has(`${geraet}.${k}`)) {
                continue;
            }
            await this.setObjectNotExistsAsync(`${geraet}.${k}`, {
                type: 'channel',
                common: { name: KANAELE[k] ?? k },
                native: {},
            });
            this.angelegt.add(`${geraet}.${k}`);
        }
        const d = definition(rel);
        await this.setObjectNotExistsAsync(`${geraet}.${rel}`, {
            type: 'state',
            common: { ...d, read: true, write: false },
            native: {},
        });
        this.angelegt.add(`${geraet}.${rel}`);
    }

    private async zustand(id: string, wert: ioBroker.StateValue, common: Partial<ioBroker.StateCommon>) {
        await this.setObjectNotExistsAsync(id, {
            type: 'state',
            common: { read: true, write: false, ...common } as ioBroker.StateCommon,
            native: {},
        });
        await this.setState(id, wert, true);
    }

    private async lesen(id: string): Promise<any> {
        try {
            const s = await this.getStateAsync(id);
            return s?.val ? JSON.parse(String(s.val)) : null;
        } catch {
            return null;
        }
    }

    private ende(cb: () => void) {
        try {
            this.gestoppt = true;
            if (this.abgleichTimer) {
                this.clearInterval(this.abgleichTimer);
            }
            if (this.taktTimer) {
                this.clearInterval(this.taktTimer);
            }
            try {
                this.client?.end(true);
            } catch {
                /* egal */
            }
            this.setState('info.connection', false, true);
            this.setState('info.status', 'gestoppt', true);
        } finally {
            cb();
        }
    }
}

new AnycubicCloud();
