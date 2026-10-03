/* MQTT-Anmeldung an der Anycubic-Cloud im Slicer-Modus.
   Nach anycubic-cloud-api, models/auth.py (get_mqtt_login_info, get_mqtt_client_id, get_mqtt_token_slicer)
   und api/mqtt.py (_mqtt_build_ssl_context, Abos). Zertifikate kommen aus dem PyPI-Paket (kennungen.ts). */
import { constants, createHash, publicEncrypt, X509Certificate } from 'node:crypto';

const md5 = (s: string) => createHash('md5').update(s, 'utf8').digest('hex');
export const TOPIC_PREFIX = 'anycubic/anycubicCloud/v1';

/**
 *
 */
export interface Zertifikate {
    ca: Buffer;
    cert: Buffer;
    key: Buffer;
}

/**
 *
 */
export function zertifikateAus(dateien: Map<string, Buffer>): Zertifikate {
    const hol = (n: string) => {
        const pfad = [...dateien.keys()].find(k => k.endsWith(`anycubic_cloud_api/resources/${n}`));
        if (!pfad) {
            throw new Error(`${n} nicht im Paket`);
        }
        return dateien.get(pfad)!;
    };
    return {
        ca: hol('anycubic_mqqt_tls_ca.crt'),
        cert: hol('anycubic_mqqt_tls_client.crt'),
        key: hol('anycubic_mqqt_tls_client.key'),
    };
}

/* Client-ID = MD5(E-Mail + "pcf"); Passwort = User-Token RSA-PKCS1v15 mit dem CA-Schlüssel, Base64;
   Benutzer = "user|pcf|<E-Mail>|MD5(clientId + passwort + clientId)" */
/**
 *
 */
export function mqttLogin(userToken: string, email: string, ca: Buffer) {
    const clientId = md5(`${email}pcf`);
    const passwort = publicEncrypt(
        {
            key: new X509Certificate(ca).publicKey,
            padding: constants.RSA_PKCS1_PADDING,
        },
        Buffer.from(userToken, 'utf8'),
    ).toString('base64');
    const benutzer = `user|pcf|${email}|${md5(clientId + passwort + clientId)}`;
    return { clientId, benutzer, passwort };
}

/**
 *
 */
export function abos(
    druckerListe: {
        /**
         *
         */
        machine_type: string | number;
        /**
         *
         */
        key: string;
    }[],
    userId: number,
): string[] {
    const t: string[] = [];
    for (const d of druckerListe) {
        t.push(`${TOPIC_PREFIX}/printer/app/${d.machine_type}/${d.key}/#`);
        t.push(`${TOPIC_PREFIX}/+/public/${d.machine_type}/${d.key}/#`);
    }
    const root = `${TOPIC_PREFIX}/server/app/${userId}/${md5(String(userId))}`;
    t.push(`${root}/slice/report`, `${root}/fdmslice/report`);
    return t;
}
