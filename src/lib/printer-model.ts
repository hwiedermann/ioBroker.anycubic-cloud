/* Turns REST responses and MQTT messages into state values for ONE printer.
   Pure logic without an ioBroker dependency, so it can be tested on its own.
   Rules: "finished" only on state finished, pause code 10401 = user, supplies_usage is in mm,
   temperatures only on a change of at least 1 °C, job values sent during fod/auto_leveling still belong to the previous job. */

export type Value = string | number | boolean | null;
export interface Write {
    id: string;
    value: Value;
}

/* Filament used by one print per ACE slot */
export interface SlotUsage {
    slot: number; // 1..4 (index + 1)
    grams: number; // extrapolated from the printed mm when aborted
    planned: number; // according to the slicer
    color: string;
    material: string;
    sku: string;
    manual: boolean;
    remainingBefore: number | null;
    remainingAfter: number | null; // consumables_percent
}
export interface Usage {
    taskId: string;
    file: string;
    result: 'finished' | 'stopped' | 'error';
    start: string | null;
    end: string;
    mm: number;
    source: 'plan' | 'mm';
    slots: SlotUsage[];
}
export interface Plan {
    taskId: string;
    grams: number[];
    material: string;
}
export interface JobMemo {
    taskId: string;
    start: string | null;
    remaining: (number | null)[];
}

const STATUS: Record<string, string> = {
    downloading: 'downloading',
    checking: 'checking',
    fod: 'checking',
    auto_leveling: 'leveling',
    preheating: 'heating',
    printing: 'printing',
    pausing: 'paused',
    paused: 'paused',
    resuming: 'resuming',
    resumed: 'printing',
    finished: 'finished',
    stopping: 'stopping',
    stoped: 'stopped',
    failed: 'error',
};
/* in these states progress/remain_time/curr_layer belong to the running job */
const JOB_VALUES_VALID = new Set([
    'preheating',
    'printing',
    'pausing',
    'paused',
    'resuming',
    'resumed',
    'finished',
    'stopping',
    'stoped',
    'failed',
]);
const RESULT: Record<string, Usage['result']> = {
    finished: 'finished',
    stoped: 'stopped',
    failed: 'error',
};

/* g per mm of 1.75 mm filament: cross-section 2.405 mm² × density */
const DENSITY: Record<string, number> = {
    PLA: 1.24,
    PETG: 1.27,
    ABS: 1.04,
    ASA: 1.07,
    TPU: 1.21,
    PA: 1.14,
    PC: 1.2,
};
export const gramsPerMm = (material: string) =>
    0.0024053 * (DENSITY[material?.toUpperCase().replace(/[^A-Z]/g, '')] ?? 1.24);

const hex = (c: unknown) =>
    Array.isArray(c) && c.length >= 3
        ? `#${c
              .slice(0, 3)
              .map(x =>
                  Math.max(0, Math.min(255, Number(x) || 0))
                      .toString(16)
                      .padStart(2, '0'),
              )
              .join('')}`
        : '';
const num = (v: unknown): number | null =>
    v === null || v === undefined || v === '' || isNaN(Number(v)) ? null : Number(v);
const iso = (ms: number) => new Date(ms).toISOString();

export class PrinterModel {
    /* last written values by relative ID, so only changes are written */
    values = new Map<string, Value>();
    plan: Plan | null = null;
    history: Usage[] = [];
    private jobStart: string | null = null;
    private remainingAtStart: (number | null)[] = [];
    private slots: {
        color: string;
        material: string;
        sku: string;
        remaining: number | null;
        manual: boolean;
    }[] = [];
    private taskId = '';
    private file = '';
    private mm = 0;

    constructor(memo?: { plan?: Plan | null; history?: Usage[]; job?: JobMemo }) {
        this.plan = memo?.plan ?? null;
        this.history = memo?.history ?? [];
        if (memo?.job) {
            this.taskId = memo.job.taskId;
            this.jobStart = memo.job.start;
            this.remainingAtStart = memo.job.remaining;
        }
    }

    /* State that must survive an adapter restart; main.ts stores it in job.internal */
    memo(): { plan: Plan | null; job: JobMemo } {
        return {
            plan: this.plan,
            job: {
                taskId: this.taskId,
                start: this.jobStart,
                remaining: this.remainingAtStart,
            },
        };
    }

    private set(out: Write[], id: string, value: Value, threshold = 0) {
        if (value === undefined) {
            return;
        }
        const old = this.values.get(id);
        if (old === value) {
            return;
        }
        if (threshold && typeof old === 'number' && typeof value === 'number' && Math.abs(old - value) < threshold) {
            return;
        }
        this.values.set(id, value);
        out.push({ id, value });
    }

    /* ---------- REST ---------- */

    /* entry of getPrinters: master data and counters */
    fromList(d: any): Write[] {
        const a: Write[] = [];
        this.set(a, 'name', d.name ?? '');
        this.set(a, 'model', d.model ?? '');
        this.set(a, 'online', d.device_status === 1);
        this.set(a, 'statistics.prints', num(d.print_count));
        this.set(a, 'statistics.printTime', d.print_totaltime ?? '');
        this.set(a, 'statistics.material', d.material_used ?? '');
        return a;
    }

    /* /v2/printer/info: complete current state (start and resync) */
    fromInfo(i: any): Write[] {
        const a: Write[] = [];
        this.set(a, 'online', i.device_status === 1);
        this.set(a, 'firmware', i.version?.firmware_version ?? '');
        this.set(a, 'firmwareUpdate', i.version?.need_update === 1);
        if (i.parameter) {
            this.temperatures(a, i.parameter);
        }
        const box = Array.isArray(i.multi_color_box) ? i.multi_color_box[0] : i.multi_color_box;
        if (box) {
            this.ace(a, box, true);
        }
        const p = i.project;
        if (p && p.print_status === 1) {
            /* a print is running: take over the job values, derive the status from pause */
            this.jobBegin(a, String(p.task_id ?? ''), p.name ?? '', Date.now() - (Number(p.print_time) || 0) * 60_000);
            this.set(a, 'status', p.pause ? 'paused' : (this.values.get('status') as string) || 'printing');
            this.jobValues(a, {
                progress: p.progress,
                remain_time: p.remain_time,
                print_time: p.print_time,
                curr_layer: p.curr_layer,
                total_layers: p.total_layers,
                supplies_usage: p.supplies_usage,
            });
            const plannedG =
                Number(p.estimate_supplies_usage_g) ||
                (this.plan?.taskId === this.taskId ? this.plan.grams.reduce((x, y) => x + y, 0) : 0);
            if (plannedG) {
                this.set(a, 'job.filamentPlannedG', Math.round(plannedG * 100) / 100);
            }
            this.set(a, 'busy', true);
        } else if (!this.values.has('status')) {
            this.set(a, 'status', 'idle');
            this.set(a, 'busy', false);
        }
        return a;
    }

    /* Slicer plan from getProjects (slice_result "filament used [g]"), in case PrintStart was missed */
    planFromProject(p: any) {
        if (!p || this.plan?.taskId === String(p.taskid)) {
            return;
        }
        try {
            const sr = typeof p.slice_result === 'string' ? JSON.parse(p.slice_result) : p.slice_result;
            const g = sr?.['filament used [g]'];
            const sp = typeof p.slice_param === 'string' ? JSON.parse(p.slice_param) : p.slice_param;
            const material =
                (sp?.paint_infos ?? [])
                    .map((x: any) => x.material_type)
                    .filter(Boolean)
                    .join(';') || String(sp?.filament_type ?? '');
            if (Array.isArray(g)) {
                this.plan = { taskId: String(p.taskid), grams: g.map(Number), material };
            }
        } catch {
            /* no plan */
        }
    }

    /* ---------- MQTT ---------- */

    fromMqtt(m: any, now = Date.now()): Write[] {
        const a: Write[] = [];
        if (!m || typeof m !== 'object' || !m.type) {
            return a;
        }
        const d = m.data && typeof m.data === 'object' ? m.data : {};
        const kind = `${m.type}/${m.action}/${m.state}`;
        if (m.code != null && m.code !== 200 && m.type !== 'buried') {
            this.set(a, 'message.lastCode', Number(m.code));
            this.set(a, 'message.lastText', String(m.msg ?? ''));
            this.set(a, 'message.lastRaw', kind);
            this.set(a, 'message.lastTime', iso(now));
        }
        switch (m.type) {
            case 'print':
                this.print(a, m, d, now);
                break;
            case 'status':
                if (m.action === 'workReport') {
                    this.set(a, 'busy', m.state === 'busy');
                }
                if (m.action === 'onlineReport') {
                    this.set(a, 'online', m.state !== 'offline');
                }
                break;
            case 'lastWill':
                /* lastWill/onlineReport is sent with state "offline" AND "online" (e.g. printer wakes up from sleep) */
                this.set(a, 'online', m.state === 'online');
                break;
            case 'tempature':
                this.temperatures(a, d);
                break;
            case 'fan':
                this.set(a, 'fan.part', num(d.fan_speed_pct));
                this.set(a, 'fan.auxiliary', num(d.aux_fan_speed_pct));
                this.set(a, 'fan.ace', num(d.box_fan_level));
                break;
            case 'light': {
                const l = Array.isArray(d.lights) ? d.lights[0] : d;
                if (l && 'status' in l) {
                    this.set(a, 'light', l.status === 1);
                    this.set(a, 'lightBrightness', num(l.brightness));
                }
                break;
            }
            case 'aiSettings':
                if (d.ai_settings) {
                    this.set(a, 'ai.enabled', d.ai_settings.status !== 0);
                    this.set(a, 'ai.sensitivity', JSON.stringify(d.ai_settings.sensitivity_level ?? null));
                }
                break;
            case 'multiColorBox':
                if (Array.isArray(d.multi_color_box) && d.multi_color_box[0]) {
                    this.ace(a, d.multi_color_box[0]);
                }
                if ('loaded_slot' in d && !Array.isArray(d.multi_color_box)) {
                    this.set(a, 'ace.activeSlot', Number(d.loaded_slot) + 1);
                }
                break;
            case 'buried':
                if (m.action === 'PrintStart' && d.taskid) {
                    const g = String(d.print_filaments_weight ?? '')
                        .replace(/g\s*$/i, '')
                        .split(',')
                        .map(x => Number(x.trim()));
                    if (g.length && g.every(x => !isNaN(x))) {
                        this.plan = {
                            taskId: String(d.taskid),
                            grams: g,
                            material: String(d.print_filaments ?? ''),
                        };
                    }
                    this.set(a, 'job.filamentPlannedG', num(d.estimate_weight));
                    if (d.storage_total) {
                        this.set(
                            a,
                            'storage.usedPercent',
                            Math.round((Number(d.storage_used) / Number(d.storage_total)) * 100),
                        );
                    }
                }
                break;
        }
        return a;
    }

    private print(a: Write[], m: any, d: any, now: number) {
        const state = String(m.state);
        const tid = d.taskid ? String(d.taskid) : this.taskId;
        if (tid && tid !== this.taskId && state !== 'finished' && state !== 'stoped') {
            this.jobBegin(a, tid, d.display_filename ?? d.filename ?? '', now);
        }
        if (d.display_filename || d.filename) {
            this.file = String(d.display_filename ?? d.filename).replace(/\.gcode$/i, '');
            this.set(a, 'job.file', this.file);
        }
        if (d.source_info?.models) {
            this.set(a, 'job.models', d.source_info.models.map((x: any) => x.name).join(', '));
        }
        if (d.source_info?.plate_index != null) {
            this.set(a, 'job.plate', Number(d.source_info.plate_index));
        }
        this.set(a, 'statusRaw', `print/${m.action}/${state}`);
        if (STATUS[state]) {
            this.set(a, 'status', STATUS[state]);
        }
        if (state === 'downloading') {
            this.set(a, 'job.downloadProgress', num(d.progress));
        }
        if (JOB_VALUES_VALID.has(state)) {
            this.jobValues(a, d);
        }
        if (m.action === 'pause' && m.code != null) {
            this.set(a, 'job.pauseCode', Number(m.code));
            this.set(a, 'job.pauseReason', m.code === 10401 ? 'user' : String(m.msg ?? 'error'));
        }
        if (state === 'resumed') {
            this.set(a, 'job.pauseCode', 0);
            this.set(a, 'job.pauseReason', '');
        }
        if (RESULT[state]) {
            this.jobEnd(a, RESULT[state], now);
        }
    }

    private jobBegin(a: Write[], taskId: string, file: string, now = Date.now()) {
        if (taskId === this.taskId) {
            return;
        }
        this.taskId = taskId;
        this.jobStart = iso(now);
        this.mm = 0;
        this.remainingAtStart = this.slots.map(s => s.remaining);
        this.set(a, 'job.taskId', taskId);
        this.set(a, 'job.start', this.jobStart);
        this.set(a, 'job.end', '');
        this.set(a, 'job.pauseCode', 0);
        this.set(a, 'job.pauseReason', '');
        this.set(a, 'job.models', '');
        this.set(a, 'job.filamentMm', 0);
        this.set(a, 'job.filamentG', 0);
        if (file) {
            this.set(a, 'job.file', file.replace(/\.gcode$/i, ''));
        }
        this.set(a, 'event.finished', false);
    }

    private jobValues(a: Write[], d: any) {
        this.set(a, 'job.progress', num(d.progress));
        this.set(a, 'job.remainingTime', num(d.remain_time));
        this.set(a, 'job.elapsedTime', num(d.print_time));
        this.set(a, 'job.layer', num(d.curr_layer));
        this.set(a, 'job.layerTotal', num(d.total_layers));
        if (num(d.supplies_usage) !== null) {
            this.mm = Number(d.supplies_usage);
            this.set(a, 'job.filamentMm', this.mm);
            this.set(a, 'job.filamentG', Math.round(this.mm * gramsPerMm(this.mainMaterial()) * 10) / 10);
        }
    }

    private mainMaterial(): string {
        if (this.plan?.taskId === this.taskId) {
            const i = this.plan.grams.indexOf(Math.max(...this.plan.grams));
            return this.slots[i]?.material || this.plan.material.split(';')[0] || 'PLA';
        }
        const active = Number(this.values.get('ace.activeSlot') ?? 0) - 1;
        return this.slots[active]?.material || 'PLA';
    }

    private jobEnd(a: Write[], result: Usage['result'], now: number) {
        const end = iso(now);
        this.set(a, 'job.end', end);
        this.set(a, 'busy', false);
        if (result === 'finished') {
            this.set(a, 'event.finished', true);
            this.set(a, 'job.remainingTime', 0);
        }
        if (!this.taskId || this.history.some(v => v.taskId === this.taskId)) {
            return;
        }
        const u = this.usage(result, end);
        if (u) {
            this.history = [u, ...this.history].slice(0, 30);
            this.set(a, 'usage.last', JSON.stringify(u));
            this.set(a, 'usage.history', JSON.stringify(this.history));
        }
    }

    /* Usage per slot: finished → slicer plan; aborted → printed mm × g/mm, split by the planned shares.
       Without a plan everything goes to the active slot. */
    private usage(result: Usage['result'], end: string): Usage | null {
        const plan = this.plan?.taskId === this.taskId ? this.plan.grams : null;
        const actual = this.mm * gramsPerMm(this.mainMaterial());
        let grams: number[];
        let planned: number[];
        let source: Usage['source'];
        if (plan && plan.some(g => g > 0)) {
            const sum = plan.reduce((s, g) => s + g, 0);
            const factor = result === 'finished' ? 1 : Math.min(1, actual / sum);
            grams = plan.map(g => g * factor);
            planned = plan;
            source = result === 'finished' ? 'plan' : 'mm';
        } else {
            const active = Number(this.values.get('ace.activeSlot') ?? 0) - 1;
            if (active < 0 || !actual) {
                return null;
            }
            grams = this.slots.map((_, i) => (i === active ? actual : 0));
            planned = grams.map(() => 0);
            source = 'mm';
        }
        const slots: SlotUsage[] = [];
        grams.forEach((g, i) => {
            if (g < 0.5) {
                return;
            }
            const s = this.slots[i] ?? { color: '', material: '', sku: '', remaining: null, manual: false };
            slots.push({
                slot: i + 1,
                grams: Math.round(g * 10) / 10,
                planned: Math.round((planned[i] ?? 0) * 10) / 10,
                color: s.color,
                material: s.material,
                sku: s.sku,
                manual: s.manual,
                remainingBefore: this.remainingAtStart[i] ?? null,
                remainingAfter: s.remaining,
            });
        });
        if (!slots.length) {
            return null;
        }
        return {
            taskId: this.taskId,
            file: this.file,
            result,
            start: this.jobStart,
            end,
            mm: this.mm,
            source,
            slots,
        };
    }

    private temperatures(a: Write[], d: any) {
        this.set(a, 'temperature.nozzle', num(d.curr_nozzle_temp), 1);
        this.set(a, 'temperature.nozzleTarget', num(d.target_nozzle_temp));
        this.set(a, 'temperature.bed', num(d.curr_hotbed_temp), 1);
        this.set(a, 'temperature.bedTarget', num(d.target_hotbed_temp));
    }

    /* fromRest: /v2/printer/info reports multi_color_box.temp and .humidity as fixed values (seen: 30–34 °C and 22 %
       while the ACE dried at 65 °C with 15–17 %, unchanged while the printer cooled down) — only MQTT reports the real
       values. Take the REST values only as long as there is no value at all yet. */
    private ace(a: Write[], b: any, fromRest = false) {
        const restOnlyIfEmpty = (id: string) => !fromRest || !this.values.has(id);
        if ('temp' in b && restOnlyIfEmpty('ace.temperature')) {
            this.set(a, 'ace.temperature', num(b.temp));
        }
        if ('humidity' in b && restOnlyIfEmpty('ace.humidity')) {
            this.set(a, 'ace.humidity', num(b.humidity));
        }
        if ('loaded_slot' in b) {
            this.set(a, 'ace.activeSlot', Number(b.loaded_slot) + 1); // 0 = none
        }
        if ('auto_feed' in b) {
            this.set(a, 'ace.autoFeed', b.auto_feed === 1);
        }
        const t = b.drying_status;
        if (t) {
            this.set(a, 'ace.drying.active', t.status === 1);
            this.set(a, 'ace.drying.targetTemperature', num(t.target_temp));
            this.set(a, 'ace.drying.duration', num(t.duration));
            this.set(a, 'ace.drying.remainingTime', num(t.remain_time));
            if (t.humidity != null && restOnlyIfEmpty('ace.humidity')) {
                this.set(a, 'ace.humidity', num(t.humidity));
            }
        }
        for (const s of Array.isArray(b.slots) ? b.slots : []) {
            const i = Number(s.index);
            if (!(i >= 0 && i < 16)) {
                continue;
            }
            const old = this.slots[i] ?? { color: '', material: '', sku: '', remaining: null, manual: false };
            /* edit_status 1 = entered by hand at the printer (spool without RFID): the SKU is a leftover and
               consumables_percent is 0, which is not a measurement, so the remaining amount stays empty */
            const manual = 'edit_status' in s ? s.edit_status === 1 : old.manual;
            const percent = 'consumables_percent' in s ? num(s.consumables_percent) : old.remaining;
            const slot = {
                color: 'color' in s ? hex(s.color) : old.color,
                material: s.type ?? old.material,
                sku: manual ? '' : (s.sku ?? old.sku),
                remaining: manual && !percent ? null : percent,
                manual,
            };
            this.slots[i] = slot;
            const p = `ace.slot${i + 1}`;
            this.set(a, `${p}.color`, slot.color);
            this.set(a, `${p}.material`, slot.material);
            this.set(a, `${p}.sku`, slot.sku);
            this.set(a, `${p}.remaining`, slot.remaining);
            this.set(a, `${p}.manual`, slot.manual);
            if ('status' in s) {
                this.set(a, `${p}.status`, num(s.status));
            }
        }
        if (Array.isArray(b.slots) && b.slots.length) {
            this.set(a, 'ace.slots', JSON.stringify(this.slots.map((s, i) => ({ slot: i + 1, ...s }))));
        }
    }
}
