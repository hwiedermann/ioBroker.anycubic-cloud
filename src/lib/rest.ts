/* REST access to the Anycubic cloud: token exchange and read-only requests.
   After anycubic-cloud-api api/base.py (_fetch_ext_resp, _get_user_token_with_access_token). */
import { setTimeout as delay } from 'node:timers/promises';
import { API_ROOT, ENDPOINT, RATE_LIMIT_MARKERS } from './constants.ts';
import { signedHeaders, type Credentials } from './signature.ts';

type Endpoint = (typeof ENDPOINT)[keyof typeof ENDPOINT];
export interface Response<T = any> {
    code?: number;
    msg?: string;
    data: T;
}

export class AnycubicRest {
    userToken?: string;
    private credentials: Credentials;
    private accessToken: string;
    constructor(credentials: Credentials, accessToken: string) {
        this.credentials = credentials;
        this.accessToken = accessToken;
    }

    async request<T = any>(
        [method, path]: Endpoint,
        opt: {
            query?: Record<string, string | number>;
            body?: unknown;
            withToken?: boolean;
        } = {},
    ): Promise<Response<T>> {
        const url = new URL(API_ROOT + path);
        for (const [k, v] of Object.entries(opt.query ?? {})) {
            url.searchParams.set(k, String(v));
        }
        const r = await fetch(url, {
            method,
            headers: signedHeaders(this.credentials, opt.withToken === false ? undefined : this.userToken),
            body: method === 'POST' ? JSON.stringify(opt.body ?? {}) : undefined,
        });
        const text = await r.text();
        try {
            return JSON.parse(text);
        } catch {
            throw new Error(`${path}: HTTP ${r.status}, no JSON response (${text.slice(0, 80)})`);
        }
    }

    /* Slicer access_token → user token. A second exchange within ~3 s is rate limited, so wait 6 s, at most 3 times */
    async login(): Promise<void> {
        for (let attempt = 0; attempt < 4; attempt++) {
            const a = await this.request<{ token: string }>(ENDPOINT.tokenExchange, {
                body: { device_type: 'pcf', access_token: this.accessToken },
                withToken: false,
            });
            if (a?.data?.token) {
                this.userToken = a.data.token;
                return;
            }
            if (RATE_LIMIT_MARKERS.some(m => String(a?.msg).includes(m))) {
                await delay(6000);
                continue;
            }
            throw new Error(`token exchange rejected: ${a?.msg ?? 'no message'} (code ${a?.code})`);
        }
        throw new Error('token exchange: rate limit persists');
    }
}
