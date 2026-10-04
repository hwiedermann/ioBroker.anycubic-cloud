/* Anycubic cloud addresses (international), taken from anycubic-cloud-api 0.4.33 (Nino6689, GPL-3.0):
   const/const.py, const/mqtt.py, const/api_endpoints.py.
   The app credentials are deliberately not here; they are loaded at runtime, see credentials.ts. */
export const API_ROOT = 'https://cloud-universe.anycubic.com/p/p/workbench/api';
export const MQTT_HOST = 'mqtt-universe.anycubic.com';
export const MQTT_PORT = 8883;
export const DEVICE_TYPE = 'pcf'; // Slicer Next
export const RATE_LIMIT_MARKERS = ['请求过于频繁', 'too frequent'];

export const ENDPOINT = {
    tokenExchange: ['POST', '/v3/public/loginWithAccessToken'],
    user: ['GET', '/user/profile/userInfo'],
    printers: ['GET', '/work/printer/getPrinters'],
    printerInfo: ['GET', '/v2/printer/info'], // ?id=
    projects: ['GET', '/work/project/getProjects'], // ?page=&limit=
    projectInfo: ['GET', '/v2/project/info'], // ?id=
} as const;
