/* MQTT login to the Anycubic cloud in slicer mode, after anycubic-cloud-api models/auth.py
   (get_mqtt_login_info, get_mqtt_client_id, get_mqtt_token_slicer) and api/mqtt.py (_mqtt_build_ssl_context,
   subscriptions). The certificates come from the PyPI package, see credentials.ts. */
import { constants, createHash, publicEncrypt, X509Certificate } from 'node:crypto';

const md5 = (s: string) => createHash('md5').update(s, 'utf8').digest('hex');
export const TOPIC_PREFIX = 'anycubic/anycubicCloud/v1';

export interface Certificates {
    ca: Buffer;
    cert: Buffer;
    key: Buffer;
}

export function certificatesFrom(files: Map<string, Buffer>): Certificates {
    const get = (n: string) => {
        const path = [...files.keys()].find(k => k.endsWith(`anycubic_cloud_api/resources/${n}`));
        if (!path) {
            throw new Error(`${n} missing in package`);
        }
        return files.get(path)!;
    };
    return {
        ca: get('anycubic_mqqt_tls_ca.crt'),
        cert: get('anycubic_mqqt_tls_client.crt'),
        key: get('anycubic_mqqt_tls_client.key'),
    };
}

/* clientId = MD5(email + "pcf"); password = user token encrypted with the CA key (RSA PKCS#1 v1.5), base64;
   username = "user|pcf|<email>|MD5(clientId + password + clientId)" */
export function mqttLogin(userToken: string, email: string, ca: Buffer) {
    const clientId = md5(`${email}pcf`);
    const password = publicEncrypt(
        {
            key: new X509Certificate(ca).publicKey,
            padding: constants.RSA_PKCS1_PADDING,
        },
        Buffer.from(userToken, 'utf8'),
    ).toString('base64');
    const username = `user|pcf|${email}|${md5(clientId + password + clientId)}`;
    return { clientId, username, password };
}

export function subscriptions(printers: { machine_type: string | number; key: string }[], userId: number): string[] {
    const t: string[] = [];
    for (const p of printers) {
        t.push(`${TOPIC_PREFIX}/printer/app/${p.machine_type}/${p.key}/#`);
        t.push(`${TOPIC_PREFIX}/+/public/${p.machine_type}/${p.key}/#`);
    }
    const root = `${TOPIC_PREFIX}/server/app/${userId}/${md5(String(userId))}`;
    t.push(`${root}/slice/report`, `${root}/fdmslice/report`);
    return t;
}
