/* One-time migration from the German state IDs of 0.2.x to the English IDs of 0.3.0.
   The filament usage history and the job memo are carried over with translated keys, all other
   values are refilled from the cloud. Afterwards the old objects are deleted. */
import type { JobMemo, Plan, Usage } from './printer-model.ts';

/* old IDs relative to a printer device */
const OLD_CHANNELS = [
    'statistik',
    'speicher',
    'temp',
    'luefter',
    'ki',
    'meldung',
    'ereignis',
    'verbrauch',
    'ace.trocknen',
];
const OLD_STATES = [
    'modell',
    'belegt',
    'zustand',
    'zustandRoh',
    'licht',
    'lichtHelligkeit',
    'job.datei',
    'job.modelle',
    'job.platte',
    'job.ladenProzent',
    'job.fortschritt',
    'job.restzeit',
    'job.laufzeit',
    'job.schicht',
    'job.schichten',
    'job.filamentPlanG',
    'job.ende',
    'job.pauseGrund',
    'job.merker',
    'ace.temp',
    'ace.feuchte',
    'ace.aktiverSlot',
];
const OLD_SLOT_STATE = /^ace\.slot\d+\.(farbe|restProzent|manuell)$/;
const OLD_INFO = ['info.letzteMeldung', 'info.tokenWarnung', 'info.tokenAblauf', 'info.tokenTage', 'info.meldungen'];

const RESULT: Record<string, Usage['result']> = { fertig: 'finished', abgebrochen: 'stopped', fehler: 'error' };

export function isOld(rel: string): boolean {
    return (
        OLD_STATES.includes(rel) ||
        OLD_SLOT_STATE.test(rel) ||
        OLD_CHANNELS.some(c => rel === c || rel.startsWith(`${c}.`))
    );
}

export function usageFromOld(v: any): Usage {
    return {
        taskId: String(v.taskid ?? ''),
        file: v.datei ?? '',
        result: RESULT[v.ergebnis] ?? v.ergebnis,
        start: v.start ?? null,
        end: v.ende ?? '',
        mm: Number(v.mm) || 0,
        source: v.quelle,
        slots: (v.slots ?? []).map((s: any) => ({
            slot: s.slot,
            grams: s.gramm,
            planned: s.geplant,
            color: s.farbe ?? '',
            material: s.material ?? '',
            sku: s.sku ?? '',
            manual: !!s.manuell,
            remainingBefore: s.restVorher ?? null,
            remainingAfter: s.restNachher ?? null,
        })),
    };
}

export function memoFromOld(m: any): { plan: Plan | null; job?: JobMemo } {
    return {
        plan: m?.plan
            ? { taskId: String(m.plan.taskid), grams: m.plan.gramm ?? [], material: m.plan.material ?? '' }
            : null,
        job: m?.job
            ? { taskId: String(m.job.taskid ?? ''), start: m.job.start ?? null, remaining: m.job.rest ?? [] }
            : undefined,
    };
}

export interface Migrated {
    memo?: { plan: Plan | null; job?: JobMemo };
    last?: Usage;
    history?: Usage[];
}

type Adapter = {
    namespace: string;
    getAdapterObjectsAsync(): Promise<Record<string, ioBroker.Object>>;
    getStateAsync(id: string): ioBroker.GetStatePromise;
    delObjectAsync(id: string): Promise<void>;
    log: ioBroker.Logger;
};

const parse = async (a: Adapter, id: string): Promise<any> => {
    try {
        const s = await a.getStateAsync(id);
        return s?.val ? JSON.parse(String(s.val)) : null;
    } catch {
        return null;
    }
};

/* Reads the values worth keeping per printer, then deletes all old objects. Returns an empty map if nothing is old. */
export async function migrate(a: Adapter): Promise<Map<string, Migrated>> {
    const result = new Map<string, Migrated>();
    const prefix = `${a.namespace}.`;
    const all = Object.values(await a.getAdapterObjectsAsync());
    const devices = all.filter(o => o.type === 'device').map(o => o._id.slice(prefix.length));
    const doomed: string[] = [];
    for (const o of all) {
        const id = o._id.slice(prefix.length);
        if (OLD_INFO.includes(id)) {
            doomed.push(id);
            continue;
        }
        const dev = devices.find(d => id.startsWith(`${d}.`));
        if (dev && isOld(id.slice(dev.length + 1))) {
            doomed.push(id);
        }
    }
    if (!doomed.length) {
        return result;
    }
    for (const dev of devices) {
        const memo = await parse(a, `${dev}.job.merker`);
        const last = await parse(a, `${dev}.verbrauch.letzter`);
        const history = await parse(a, `${dev}.verbrauch.verlauf`);
        result.set(dev, {
            memo: memo ? memoFromOld(memo) : undefined,
            last: last ? usageFromOld(last) : undefined,
            history: Array.isArray(history) ? history.map(usageFromOld) : undefined,
        });
    }
    /* states first, channels last */
    doomed.sort((x, y) => y.split('.').length - x.split('.').length);
    for (const id of doomed) {
        await a.delObjectAsync(id).catch(e => a.log.debug(`migration: could not delete ${id}: ${e.message}`));
    }
    a.log.info(`Migrated to the English state IDs of 0.3.0, removed ${doomed.length} old objects`);
    return result;
}
