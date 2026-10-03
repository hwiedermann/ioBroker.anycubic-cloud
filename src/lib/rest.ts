/* REST-Zugriff auf die Anycubic-Cloud: Token-Tausch und lesende Abfragen.
   Nach anycubic-cloud-api, api/base.py (_fetch_ext_resp, _get_user_token_with_access_token). */
import { API_ROOT, ENDPUNKT, RATE_LIMIT_MARKER } from './konstanten.ts';
import { kopfzeilen, type Kennungen } from './signatur.ts';
import { setTimeout as delay } from 'node:timers/promises';

type Endpunkt = (typeof ENDPUNKT)[keyof typeof ENDPUNKT];
export interface Antwort<T = any> {
    /**
     *
     */
    code?: number;
    /**
     *
     */
    msg?: string;
    /**
     *
     */
    data: T;
}

export class AnycubicRest {
    userToken?: string;
    private kennungen: Kennungen;
    private accessToken: string;
    constructor(kennungen: Kennungen, accessToken: string) {
        this.kennungen = kennungen;
        this.accessToken = accessToken;
    }

    async aufruf<T = any>(
        [methode, pfad]: Endpunkt,
        opt: {
            query?: Record<string, string | number>;
            body?: unknown;
            mitToken?: boolean;
        } = {},
    ): Promise<Antwort<T>> {
        const url = new URL(API_ROOT + pfad);
        for (const [k, v] of Object.entries(opt.query ?? {})) {
            url.searchParams.set(k, String(v));
        }
        const r = await fetch(url, {
            method: methode,
            headers: kopfzeilen(this.kennungen, opt.mitToken === false ? undefined : this.userToken),
            body: methode === 'POST' ? JSON.stringify(opt.body ?? {}) : undefined,
        });
        const text = await r.text();
        try {
            return JSON.parse(text);
        } catch {
            throw new Error(`${pfad}: HTTP ${r.status}, keine JSON-Antwort (${text.slice(0, 80)})`);
        }
    }

    /* Slicer-access_token → User-Token. Rate-Limit: zweiter Tausch binnen ~3 s wird abgelehnt → 6 s warten, max. 3× */
    async anmelden(): Promise<void> {
        for (let versuch = 0; versuch < 4; versuch++) {
            const a = await this.aufruf<{
                token: string;
            }>(ENDPUNKT.tokenTausch, {
                body: { device_type: 'pcf', access_token: this.accessToken },
                mitToken: false,
            });
            if (a?.data?.token) {
                this.userToken = a.data.token;
                return;
            }
            if (RATE_LIMIT_MARKER.some(m => String(a?.msg).includes(m))) {
                await delay(6000);
                continue;
            }
            throw new Error(`Token-Tausch abgelehnt: ${a?.msg ?? 'keine Meldung'} (code ${a?.code})`);
        }
        throw new Error('Token-Tausch: Rate-Limit hält an');
    }
}
