/* Adressen der Anycubic-Cloud (international). Nach anycubic-cloud-api 0.4.33 (Nino6689, GPL-3.0),
   const/const.py, const/mqtt.py, const/api_endpoints.py.
   App-Kennungen (App-ID, Secret, Version) stehen bewusst NICHT hier — die kommen zur Laufzeit
   aus kennungen.ts, siehe dort. */
export const API_ROOT = "https://cloud-universe.anycubic.com/p/p/workbench/api";
export const MQTT_HOST = "mqtt-universe.anycubic.com";
export const MQTT_PORT = 8883;
export const GERAETETYP = "pcf";                       // Slicer Next
export const RATE_LIMIT_MARKER = ["请求过于频繁", "too frequent"];

export const ENDPUNKT = {
  tokenTausch: ["POST", "/v3/public/loginWithAccessToken"],
  benutzer: ["GET", "/user/profile/userInfo"],
  drucker: ["GET", "/work/printer/getPrinters"],
  druckerInfo: ["GET", "/v2/printer/info"],            // ?id=
  projekte: ["GET", "/work/project/getProjects"],      // ?page=&limit=
  projektInfo: ["GET", "/v2/project/info"],            // ?id=
} as const;
