/* Signed request headers for the Anycubic cloud in slicer mode, after anycubic-cloud-api models/auth.py
   get_auth_headers(): Xx-Signature = MD5(appId + timestamp + version + appSecret + nonce + appId). */
import { createHash, randomUUID } from 'node:crypto';
import { DEVICE_TYPE } from './constants.ts';

export interface Credentials {
    appId: string;
    appSecret: string;
    version: string;
}

const md5 = (s: string) => createHash('md5').update(s, 'utf8').digest('hex');

export function signedHeaders(c: Credentials, userToken?: string): Record<string, string> {
    const ts = String(Date.now());
    const nonce = randomUUID(); // the library uses uuid1, the server only checks the signature
    const h: Record<string, string> = {
        'Xx-Device-Type': DEVICE_TYPE,
        'Xx-Is-Cn': '1',
        'Xx-Nonce': nonce,
        'Xx-Signature': md5(`${c.appId}${ts}${c.version}${c.appSecret}${nonce}${c.appId}`),
        'Xx-Timestamp': ts,
        'Xx-Version': c.version,
        'Content-Type': 'application/json',
        'XX-LANGUAGE': 'US',
    };
    if (userToken) {
        h['XX-Token'] = userToken;
    }
    return h;
}

/* Reads the JWT payload without verifying it; only used for the expiry date */
export function jwtPayload(t: string): Record<string, unknown> {
    return JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString('utf8'));
}
