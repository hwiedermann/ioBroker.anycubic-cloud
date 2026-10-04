/* ioBroker adapter anycubic-cloud: reads printer status, print job and ACE via the Anycubic cloud.
   REST at start and as periodic resync, MQTT for live updates. The adapter is read-only: there is
   deliberately no publish and no sendOrder, so it never sends commands to the printer. */
import * as utils from '@iobroker/adapter-core';
import mqtt, { type MqttClient } from 'mqtt';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ENDPOINT, MQTT_HOST, MQTT_PORT } from './lib/constants.ts';
import { credentialsFrom, loadPackage } from './lib/credentials.ts';
import { migrate, type Migrated } from './lib/migration.ts';
import { certificatesFrom, mqttLogin, subscriptions } from './lib/mqtt-login.ts';
import { PrinterModel, type Write } from './lib/printer-model.ts';
import { AnycubicRest } from './lib/rest.ts';
import { jwtPayload } from './lib/signature.ts';
import { CHANNELS, definition } from './lib/states.ts';

declare global {
    namespace ioBroker {
        interface AdapterConfig {
            token: string;
            resyncMinutes: number;
            tokenWarnDays: number;
        }
    }
}

interface Printer {
    id: string;
    key: string;
    machine_type: number;
    model: PrinterModel;
    memo: string;
}

/* reconnect delays (ms), back to the first value after a successful connect */
const BACKOFF = [5_000, 10_000, 30_000, 60_000, 300_000];
/* states in which MQTT messages keep coming, used by the watchdog */
const ACTIVE = new Set(['downloading', 'checking', 'leveling', 'heating', 'printing', 'paused', 'resuming']);
const QUIET_RESYNC = 5 * 60_000; // silent during a print for this long → REST resync
const QUIET_RECONNECT = 12 * 60_000; // silent during a print for this long → force MQTT reconnect

class AnycubicCloud extends utils.Adapter {
    private api?: AnycubicRest;
    private client?: MqttClient;
    private printers = new Map<string, Printer>(); // key = cloud key (part of the topic)
    private created = new Set<string>();
    private migrated = new Map<string, Migrated>();
    private resyncTimer?: ioBroker.Interval;
    private tickTimer?: ioBroker.Interval;
    private stopped = false;
    private backoffLevel = 0;
    private lastMessageTs = 0;
    private resyncRunning = false; // REST requests never overlap
    /* diagnostics: received message kinds since start (info.messageCounts) */
    private counts: Record<string, number> = {};

    constructor(options: Partial<utils.AdapterOptions> = {}) {
        super({ ...options, name: 'anycubic-cloud' });
        this.on('ready', () => this.onReady().catch(e => this.startFailed(e)));
        this.on('unload', cb => this.onUnload(cb));
    }

    private async startFailed(e: any) {
        this.log.error(`Start failed: ${e?.message ?? e}`);
        await this.setStatus('start failed').catch(() => {});
    }

    private async setStatus(text: string) {
        await this.setState('info.status', text, true).catch(() => {});
    }

    private async onReady() {
        this.migrated = await migrate(this);
        await this.stateWithValue('info.status', 'starting', {
            name: { en: 'Status', de: 'Status' },
            type: 'string',
            role: 'text',
        });
        await this.stateWithValue('info.lastMessage', '', {
            name: { en: 'Time of the last MQTT message', de: 'Zeitpunkt der letzten MQTT-Meldung' },
            type: 'string',
            role: 'date',
        });
        await this.stateWithValue('info.tokenExpiring', false, {
            name: { en: 'Token expires soon', de: 'Token läuft bald ab' },
            type: 'boolean',
            role: 'indicator',
        });
        await this.setState('info.connection', false, true);

        const token = String(this.config.token ?? '').trim();
        if (!token) {
            this.log.warn('No slicer token configured');
            await this.setStatus('no token');
            return;
        }

        let exp = 0;
        try {
            exp = Number(jwtPayload(token).exp) * 1000;
        } catch {
            this.log.error('Token is not a valid JWT');
            await this.setStatus('token invalid');
            return;
        }
        /* 0.2.x stored these under German keys */
        const old = this.config as any;
        const resyncMinutes = Math.max(5, Number(this.config.resyncMinutes ?? old.restMinuten) || 10);
        const warnDays = Math.max(1, Number(this.config.tokenWarnDays ?? old.tokenWarnTage) || 14);
        const days = Math.floor((exp - Date.now()) / 864e5);
        await this.stateWithValue('info.tokenExpiry', new Date(exp).toISOString(), {
            name: { en: 'Token expiry', de: 'Token läuft ab' },
            type: 'string',
            role: 'date',
        });
        await this.stateWithValue('info.tokenDaysLeft', days, {
            name: { en: 'Token days left', de: 'Token-Resttage' },
            type: 'number',
            role: 'value',
            unit: 'd',
        });
        if (exp < Date.now()) {
            this.log.error('Slicer token has expired, please renew it in the instance settings');
            await this.setState('info.tokenExpiring', true, true);
            await this.setStatus('token expired');
            return; // no reconnect attempts with a dead token
        }
        const soon = days <= warnDays;
        await this.setState('info.tokenExpiring', soon, true);
        if (soon) {
            this.log.warn(`Slicer token expires in ${days} days`);
        }

        await this.setStatus('connecting');
        const files = await loadPackage(utils.getAbsoluteInstanceDataDir(this));
        this.api = new AnycubicRest(credentialsFrom(files), token);
        await this.api.login();
        const user = (await this.api.request(ENDPOINT.user)).data;
        if (!user?.user_email) {
            throw new Error('account data without email, login incomplete');
        }

        await this.resync(true);
        if (!this.printers.size) {
            this.log.warn('No printers found in the account');
            await this.setStatus('no printer in account');
            return;
        }

        const certs = certificatesFrom(files);
        const login = mqttLogin(this.api.userToken!, user.user_email, certs.ca);
        const list = [...this.printers.values()].map(p => ({ machine_type: p.machine_type, key: p.key }));
        this.client = mqtt.connect({
            host: MQTT_HOST,
            port: MQTT_PORT,
            protocol: 'mqtts',
            protocolVersion: 4,
            clean: true,
            keepalive: 60,
            clientId: login.clientId,
            username: login.username,
            password: login.password,
            ca: certs.ca,
            cert: certs.cert,
            key: certs.key,
            servername: MQTT_HOST,
            ciphers: 'DEFAULT:@SECLEVEL=0',
            minVersion: 'TLSv1.2',
            rejectUnauthorized: true,
            reconnectPeriod: BACKOFF[0],
            connectTimeout: 30_000,
        } as mqtt.IClientOptions);

        let firstConnect = true;
        this.client.on('connect', () => {
            this.backoffLevel = 0;
            if (this.client) {
                (this.client.options as any).reconnectPeriod = BACKOFF[0];
            }
            this.lastMessageTs = Date.now();
            this.log.info('MQTT connected');
            void this.setState('info.connection', true, true);
            void this.setStatus('connected');
            for (const t of subscriptions(list, user.id)) {
                this.client!.subscribe(t, e => e && this.log.warn(`Subscribe failed: ${e.message}`));
            }
            if (!firstConnect) {
                this.resync().catch(e => this.log.warn(`REST resync: ${e.message}`));
            }
            firstConnect = false;
        });
        this.client.on('reconnect', () => {
            this.backoffLevel = Math.min(this.backoffLevel + 1, BACKOFF.length - 1);
            if (this.client) {
                (this.client.options as any).reconnectPeriod = BACKOFF[this.backoffLevel];
            }
            void this.setStatus(`waiting (${Math.round(BACKOFF[this.backoffLevel] / 1000)} s)`);
        });
        this.client.on('close', () => {
            if (!this.stopped) {
                void this.setState('info.connection', false, true);
                void this.setStatus('disconnected');
            }
        });
        this.client.on('error', e => this.log.warn(`MQTT: ${e.message}`));
        this.client.on('message', (topic, buf) =>
            this.onMessage(topic, buf).catch(e => this.log.warn(`Processing message: ${e.message}`)),
        );

        await this.stateWithValue('info.messageCounts', '{}', {
            name: {
                en: 'Received messages since start per type/action (JSON)',
                de: 'Empfangene Meldungen seit Start je type/action (JSON)',
            },
            type: 'string',
            role: 'json',
        });
        this.resyncTimer = this.setInterval(
            () => this.resync().catch(e => this.log.warn(`REST resync: ${e.message}`)),
            resyncMinutes * 60_000,
        );
        this.tickTimer = this.setInterval(() => this.tick(), 60_000);
    }

    /* every minute: write diagnostics, keep the last message time, watchdog */
    private tick() {
        void this.setState('info.messageCounts', JSON.stringify(this.counts), true);
        if (this.lastMessageTs) {
            void this.setState('info.lastMessage', new Date(this.lastMessageTs).toISOString(), true);
        }
        /* messages keep coming only while a print is running */
        const active = [...this.printers.values()].some(p => ACTIVE.has(String(p.model.values.get('status'))));
        if (!active || !this.lastMessageTs) {
            return;
        }
        const quiet = Date.now() - this.lastMessageTs;
        if (quiet > QUIET_RECONNECT && this.client) {
            this.log.warn(`No MQTT message for ${Math.round(quiet / 60000)} min during a print, reconnecting`);
            try {
                this.client.reconnect();
            } catch {
                /* may already be reconnecting */
            }
            this.lastMessageTs = Date.now(); // do not trigger again right away
        } else if (quiet > QUIET_RESYNC) {
            this.resync().catch(e => this.log.warn(`REST resync (watchdog): ${e.message}`));
        }
    }

    /* printer list + printer/info + running job (plan from getProjects) */
    private async resync(first = false) {
        if (this.resyncRunning) {
            return;
        }
        this.resyncRunning = true;
        try {
            const list = (await this.api!.request<any[]>(ENDPOINT.printers)).data ?? [];
            for (const d of list) {
                const id = String(d.id);
                let p = this.printers.get(d.key);
                if (!p) {
                    p = await this.addPrinter(id, d);
                }
                await this.write(p, p.model.fromList(d));
                const info = (await this.api!.request(ENDPOINT.printerInfo, { query: { id } })).data;
                if (info?.project?.print_status === 1) {
                    const projects =
                        (await this.api!.request<any[]>(ENDPOINT.projects, { query: { page: 1, limit: 5 } })).data ??
                        [];
                    p.model.planFromProject(projects.find(x => String(x.taskid) === String(info.project.task_id)));
                }
                if (info) {
                    await this.write(p, p.model.fromInfo(info));
                }
                if (first) {
                    this.log.info(`Printer "${d.name}" (${id}) found, status ${p.model.values.get('status')}`);
                }
            }
        } finally {
            this.resyncRunning = false;
        }
    }

    private async addPrinter(id: string, d: any): Promise<Printer> {
        await this.setObjectNotExistsAsync(id, {
            type: 'device',
            common: { name: d.name ?? id },
            native: { machine_type: d.machine_type },
        });
        const m = this.migrated.get(id);
        const memo = m?.memo ?? (await this.readJson(`${id}.job.internal`));
        const history = m?.history ?? (await this.readJson(`${id}.usage.history`));
        const p: Printer = {
            id,
            key: d.key,
            machine_type: d.machine_type,
            memo: '',
            model: new PrinterModel({ ...(memo ?? {}), history: Array.isArray(history) ? history : [] }),
        };
        this.printers.set(d.key, p);
        if (m) {
            /* carry the history over right away, otherwise it would only reappear after the next print */
            const carried: Write[] = [];
            if (m.history) {
                carried.push({ id: 'usage.history', value: JSON.stringify(m.history) });
            }
            if (m.last) {
                carried.push({ id: 'usage.last', value: JSON.stringify(m.last) });
            }
            await this.write(p, carried);
        }
        return p;
    }

    private async onMessage(topic: string, buf: Buffer) {
        if (topic.endsWith('/response')) {
            return; // only acknowledgements {msgid}
        }
        this.lastMessageTs = Date.now();
        const p = [...this.printers.values()].find(x => topic.includes(`/${x.key}/`));
        if (!p) {
            return;
        }
        let m: any;
        try {
            m = JSON.parse(buf.toString('utf8'));
        } catch {
            return;
        }
        const kind = `${m?.type}/${m?.action}`;
        this.counts[kind] = (this.counts[kind] ?? 0) + 1;
        this.log.debug(`MQTT ${kind}/${m?.state}`);
        await this.write(p, p.model.fromMqtt(m));
    }

    private async write(p: Printer, list: Write[]) {
        for (const w of list) {
            const id = `${p.id}.${w.id}`;
            if (!this.created.has(id)) {
                await this.createObject(p.id, w.id);
            }
            await this.setState(id, { val: w.value, ack: true });
            if (w.id === 'event.finished' && w.value === true) {
                this.log.info(`Print finished: ${p.model.values.get('job.file')}`);
            }
        }
        /* store the memo (slicer plan, job start, remaining amounts) only on change, so it survives a restart mid-print */
        const memo = JSON.stringify(p.model.memo());
        if (memo !== p.memo) {
            p.memo = memo;
            if (!this.created.has(`${p.id}.job.internal`)) {
                await this.createObject(p.id, 'job.internal');
            }
            await this.setState(`${p.id}.job.internal`, memo, true);
        }
    }

    /* extendObject instead of setObjectNotExists, so names of objects kept from 0.2.x are updated as well */
    private async createObject(device: string, rel: string) {
        const parts = rel.split('.');
        for (let i = 1; i < parts.length; i++) {
            const k = parts.slice(0, i).join('.');
            if (this.created.has(`${device}.${k}`)) {
                continue;
            }
            const slot = k.match(/^ace\.slot(\d+)$/);
            await this.extendObjectAsync(`${device}.${k}`, {
                type: 'channel',
                common: { name: CHANNELS[k] ?? (slot ? `Slot ${slot[1]}` : k) },
                native: {},
            });
            this.created.add(`${device}.${k}`);
        }
        await this.extendObjectAsync(`${device}.${rel}`, {
            type: 'state',
            common: { ...definition(rel), read: true, write: false },
            native: {},
        });
        this.created.add(`${device}.${rel}`);
    }

    private async stateWithValue(id: string, value: ioBroker.StateValue, common: Partial<ioBroker.StateCommon>) {
        await this.extendObjectAsync(id, {
            type: 'state',
            common: { read: true, write: false, ...common } as ioBroker.StateCommon,
            native: {},
        });
        await this.setState(id, value, true);
    }

    private async readJson(id: string): Promise<any> {
        try {
            const s = await this.getStateAsync(id);
            return s?.val ? JSON.parse(String(s.val)) : null;
        } catch {
            return null;
        }
    }

    private onUnload(cb: () => void) {
        try {
            this.stopped = true;
            if (this.resyncTimer) {
                this.clearInterval(this.resyncTimer);
            }
            if (this.tickTimer) {
                this.clearInterval(this.tickTimer);
            }
            try {
                this.client?.end(true);
            } catch {
                /* ignore */
            }
            void this.setState('info.connection', false, true);
            void this.setState('info.status', 'stopped', true);
        } finally {
            cb();
        }
    }
}

/* started directly (not in compact mode); realpath because node resolves symlinks in import.meta.url */
const startedDirectly = (() => {
    try {
        return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
    } catch {
        return false;
    }
})();
if (startedDirectly) {
    new AnycubicCloud();
}

/* compact mode */
export default function startAdapter(options: Partial<utils.AdapterOptions> = {}) {
    return new AnycubicCloud(options);
}
