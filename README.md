# ioBroker.anycubic-cloud

*Deutsch (unten: [English](#english))*

ioBroker-Adapter für Anycubic-Drucker (getestet mit **Kobra S1 + ACE 2 Pro**) über die
**Anycubic-Cloud**. Der Adapter ist **rein lesend**: Er bildet den Druckerzustand in ioBroker ab
und schickt **keine** Befehle an den Drucker. Im Code gibt es bewusst weder `publish` noch `sendOrder`.

Hersteller/Gerät: [Anycubic Kobra S1](https://www.anycubic.com/products/kobra-s1-combo) · [Anycubic](https://www.anycubic.com)

> ⚠️ **Beta, inoffiziell, auf eigenes Risiko.** Anycubic bietet keine öffentliche Schnittstelle;
> der Adapter nutzt dieselben Cloud-Aufrufe wie der Slicer und greift dafür zur Laufzeit auf
> App-Kennungen und Zertifikate von Anycubic zu. Ändert Anycubic etwas, kann der Adapter ausfallen
> oder der Zugang gesperrt werden. Bisher nur mit **einem** Gerät (Kobra S1 + ACE 2 Pro, eine
> Firmware, ein Konto) getestet. Keine Gewähr, keine Verbindung zu Anycubic.

## Voraussetzung: Cloud-Modus

Der Drucker muss mit der **Anycubic-Cloud verbunden** sein — so wie bei der Nutzung über die
Anycubic-App oder den angemeldeten Slicer. Der Adapter spricht **ausschließlich mit der Cloud**,
nicht direkt mit dem Drucker im Heimnetz.

Im **reinen LAN-/Offline-Modus** des Druckers (lokal, ohne Cloud) funktioniert der Adapter **nicht** —
dort ist der Drucker über die Cloud nicht erreichbar. Geprüft ist das mit dem **Kobra S1**; bei ihm
schließt der LAN-Modus die Cloud- und App-Nutzung aus. Andere Anycubic-Modelle verhalten sich
vermutlich ebenso, das ist aber **nicht getestet**.

## Was er liefert

Pro Drucker unter `anycubic-cloud.0.<id>`:

- **Zustand** (`zustand`): frei · lädt · prüft · nivelliert · heizt · druckt · pausiert · setzt_fort · fertig · bricht_ab · abgebrochen · fehler
- **Druckauftrag** (`job.*`): Datei, Fortschritt %, Restzeit, Laufzeit, Schicht/Schichten, Filament (mm und g), Start/Ende, Pausegrund
- **Temperaturen** (`temp.*`) und **Lüfter** (`luefter.*`)
- **ACE** (`ace.*`): Temperatur, Feuchte, geladener Slot, Trocknung; je Slot Farbe, Material, SKU und Restmenge. Slots ohne RFID (von Hand am Drucker eingetragen) werden als `manuell` markiert, ihr Prozentwert bleibt leer.
- **Filamentverbrauch je Slot** (`verbrauch.letzter`, `verbrauch.verlauf`): nach jedem Druck, bei Abbruch aus dem tatsächlich Gedruckten hochgerechnet.
- **Meldungen/Ereignisse** (`meldung.*`, `ereignis.fertig`) sowie `info.connection` und die Resttage des Tokens.

> Hinweis: Temperaturen meldet der Drucker nur häufig, solange Slicer oder App zusehen. Sonst
> kommen sie selten; der Adapter gleicht zusätzlich in einem Intervall über die Cloud ab.

## Was (noch) nicht geht

Hier sind zwei Dinge zu unterscheiden: was **noch nicht gebaut** ist (aber möglich wäre) und was
**über die Cloud grundsätzlich nicht** geht.

### Noch nicht enthalten (möglich, bei Bedarf baubar)

- **Steuerung des Druckers (Pause, Fortsetzen, Stopp, Licht, ACE-Trocknen).** Über die Cloud
  technisch **möglich** (`sendOrder`), aber in dieser Version **noch nicht enthalten**. Lässt sich bei
  Bedarf als optionales, abschaltbares Schreib-Modul mit Bestätigung nachrüsten. **Derzeit ist das
  Steuern über den Slicer oder die Anycubic-App aber der sinnvollere Weg** — unmittelbareres Feedback
  und kein Umweg über einen Schreibzugriff aus der Hausautomation.

### Über die Cloud grundsätzlich nicht (kommt also auch später nicht)

- **Videobild / Kamera-Einzelbild.** Die Anycubic-Cloud liefert **keine Einzelbilder (Snapshots)** —
  nur einen kurzlebigen Live-Stream über WebRTC (Agora). Ein stehendes Kamerabild als Datenpunkt ist
  darüber **nicht möglich**; das ist eine Grenze der Cloud, nicht etwas, das noch nachkommt. (Ein
  lokales Bild gäbe es nur im LAN-Modus des Druckers, den dieser Adapter nicht nutzt.) Fürs Zusehen
  ist die Anycubic-App der direkte Weg.

## Verläufe / Historie

- Der Adapter führt **selbst** einen kurzen Verlauf: `verbrauch.verlauf` enthält die **letzten 30
  Drucke** je Slot (Gramm, Datei, Ergebnis) als JSON.
- Für **Zeitreihen** (z. B. Temperatur-, Fortschritts- oder Füllstandskurven) legt der Adapter keine
  eigene Datenbank an. Das übernehmen wie bei jedem ioBroker-State die Standard-Adapter
  **History / SQL / InfluxDB**: dort den gewünschten Datenpunkt (z. B. `temp.duese`,
  `job.fortschritt`, `ace.slotN.restProzent`) zur Aufzeichnung aktivieren.

## Einrichtung

1. Adapter installieren und eine Instanz anlegen.
2. **Zugangs-Token** aus Anycubic Slicer Next besorgen (siehe unten) und in den Instanz-Einstellungen
   ins Feld **„Slicer-Token"** eintragen.
3. Speichern. Der Adapter meldet sich an, findet den Drucker und füllt den Objektbaum.

Der Token ist an das Anycubic-Konto gebunden. Er gehört in die Instanz-Konfiguration (dort wird er
verschlüsselt gespeichert) und **nicht** in ein Repository oder Log.

## Token besorgen

Anycubic hat keine Passwort-Anmeldung über eine API (Captcha/2FA). Gebraucht wird der
**Zugangs-Token (access token)**, den Anycubic Slicer Next nach der Anmeldung lokal hält. Er gilt
rund **90 Tage**; danach den Slicer neu anmelden und den Token erneuern.

### Mit dem Hilfsskript (empfohlen)

Im Ordner `admin/` liegt **`token-holen.ps1`** (PowerShell).

**Was das Skript macht:**

1. Es liest zuerst die Slicer-Konfigurationsdatei
   `%APPDATA%\AnycubicSlicerNext\AnycubicSlicerNext.conf`. Ältere Slicer-Versionen speichern den
   Token dort im Klartext — dann ist man sofort fertig.
2. Neuere Versionen verschlüsseln diese Datei. Dann wird einmalig eine **Abbilddatei** des Slicers
   gebraucht: im **Task-Manager → Reiter „Details" → `AnycubicSlicerNext.exe` → Rechtsklick →
   „Abbilddatei erstellen"**. Der Task-Manager nennt den Pfad (meist unter `%TEMP%`). Das Skript
   sucht diese `.DMP`-Datei automatisch (oder man gibt sie mit `-Dump <Pfad>` an) und **filtert den
   Token aus dieser Datei** heraus.
3. Gefundene Kandidaten werden geprüft (Aussteller, Token-Art, Ablaufdatum); genommen wird der
   gültige mit dem spätesten Ablauf. Der Token wird **in die Zwischenablage** gelegt und **nicht
   angezeigt** — nur sein Ablaufdatum.

Das Skript **liest ausschließlich Dateien** (die Konfiguration bzw. die vom Nutzer selbst erzeugte
Abbilddatei). Es greift **nicht** auf laufenden Prozessspeicher zu, braucht keine Administratorrechte
und sendet nichts ins Netz.

**Aufruf:**

```powershell
# Slicer läuft und ist angemeldet
powershell -ExecutionPolicy Bypass -File .\token-holen.ps1
```

Optionen:

- `-Dump <Pfad>` — eine bestimmte Abbilddatei verwenden, statt automatisch zu suchen
- `-Datei <Pfad>` — den Token zusätzlich in eine Textdatei schreiben (z. B. zum Übertragen per SSH)

Danach den Token aus der Zwischenablage in die Instanz-Einstellungen einfügen.

> ⚠️ **Getestet nur unter Windows x64** (Windows 11, PowerShell 5.1 und 7). Unter anderen
> Betriebssystemen oder Architekturen wurde das Skript nicht geprüft. Der Weg selbst (lesbare
> Konfiguration bzw. Abbilddatei des Slicer-Prozesses) gilt sinngemäß auch für macOS, ist dort aber
> nicht automatisiert.

### Wenn Windows das Skript blockiert

Das Skript ist **nicht signiert** (eine Code-Signatur wird nicht angeboten). Windows kann es deshalb
zunächst blockieren. So lässt sich das umgehen — jeder Schritt ist freiwillig und nachvollziehbar:

- **Ausführungsrichtlinie:** Der Aufruf oben enthält bereits `-ExecutionPolicy Bypass`; damit wird
  die Richtlinie nur für diesen einen Lauf übergangen, dauerhaft bleibt alles wie es war.
- **„Aus dem Internet"-Markierung:** Wurde die Datei heruntergeladen, kann Windows sie sperren.
  Entweder im Datei-Explorer unter **Eigenschaften → unten „Zulassen"** freigeben, oder in
  PowerShell: `Unblock-File .\token-holen.ps1`.
- **SmartScreen:** Erscheint ein blaues Fenster „Der Computer wurde geschützt", auf **„Weitere
  Informationen → Trotzdem ausführen"** klicken.
- **Virenscanner-Fehlalarm:** Weil das Skript eine Speicherabbild-Datei durchsucht und etwas in die
  Zwischenablage legt, schlagen manche Scanner an. Der Quelltext ist kurz und liegt offen bei —
  wer mag, liest ihn vorher durch. Wer dem Skript nicht traut, nimmt den **manuellen Weg** (unten),
  der ganz ohne Skript auskommt.

### Von Hand (ohne Skript)

- **Ältere Slicer:** `%APPDATA%\AnycubicSlicerNext\AnycubicSlicerNext.conf` öffnen und den Wert
  `anycubic_cloud.access_token` herauskopieren.
- **Neuere Slicer (verschlüsselt):** Abbilddatei wie oben erstellen und darin nach einer langen
  Zeichenkette suchen, die mit `eyJ` beginnt und zwei Punkte enthält (ein JWT).

## Installation

Dieser Adapter ist (noch) nicht im ioBroker-Repository. Installation aus dem Paket:

```bash
npm run build          # TypeScript -> build/
npm pack               # erzeugt iobroker.anycubic-cloud-<version>.tgz
# Paket auf den ioBroker-Host übertragen, dann dort:
iobroker url /pfad/zu/iobroker.anycubic-cloud-<version>.tgz
iobroker add anycubic-cloud
```

Voraussetzungen: Node.js ≥ 22, js-controller ≥ 6, Admin ≥ 7.

## Entwicklung

- `src/` — Adapterquellen (TypeScript). `src/lib/druckerbild.ts` enthält die reine Abbildung von
  Cloud-Meldungen auf Datenpunkte, ohne ioBroker-Abhängigkeit.
- `werkzeuge/` — Hilfsskripte zum Ausprobieren ohne Installation:
  - `wiedergabe.ts` spielt aufgezeichnete MQTT-Meldungen durch die Abbildung (prüft sie ohne Drucker).
  - `probe-rest.ts` / `probe-mqtt.ts` lesen die Cloud direkt (nur lesend) und schreiben redigierte Ausgaben.
- App-Kennungen und MQTT-Zertifikate liegen **nicht** im Repo; sie werden zur Laufzeit aus dem fest
  gepinnten PyPI-Paket `anycubic-cloud-api` (geprüft per SHA-256) gelesen.

## Lizenz

GPL-3.0-or-later. Dieser Adapter baut auf Erkenntnissen aus dem Projekt
[`anycubic-cloud-api`](https://pypi.org/project/anycubic-cloud-api/) (GPL-3.0) auf.

---

# English

*English (German above: [Deutsch](#iobrokeranycubic-cloud))*

ioBroker adapter for Anycubic printers (tested with **Kobra S1 + ACE 2 Pro**) via the
**Anycubic cloud**. The adapter is **read-only**: it mirrors the printer state in ioBroker and sends
**no** commands to the printer. There is deliberately neither `publish` nor `sendOrder` in the code.

Manufacturer/device: [Anycubic Kobra S1](https://www.anycubic.com/products/kobra-s1-combo) · [Anycubic](https://www.anycubic.com)

> ⚠️ **Beta, unofficial, at your own risk.** Anycubic offers no public API; the adapter uses the same
> cloud calls as the slicer and, to do so, accesses Anycubic's app credentials and certificates at
> runtime. If Anycubic changes something, the adapter may stop working or access may be blocked. So
> far tested with **one** device only (Kobra S1 + ACE 2 Pro, one firmware, one account). No warranty,
> no affiliation with Anycubic.

## Requirement: cloud mode

The printer must be **connected to the Anycubic cloud** — as it is when used via the Anycubic app or
the logged-in slicer. The adapter talks **exclusively to the cloud**, not directly to the printer on
the local network.

In the printer's **pure LAN / offline mode** (local, without cloud) the adapter does **not** work —
the printer is not reachable via the cloud there. This was verified with the **Kobra S1**, where LAN
mode excludes cloud and app use. Other Anycubic models probably behave the same, but this is **not
tested**.

## What it provides

Per printer under `anycubic-cloud.0.<id>`:

- **State** (`zustand`): idle · downloading · checking · leveling · heating · printing · paused · resuming · finished · stopping · stopped · error (German labels in the object names)
- **Print job** (`job.*`): file, progress %, remaining time, elapsed time, layer/layers, filament (mm and g), start/end, pause reason
- **Temperatures** (`temp.*`) and **fans** (`luefter.*`)
- **ACE** (`ace.*`): temperature, humidity, loaded slot, drying; per slot colour, material, SKU and remaining amount. Slots without RFID (entered by hand at the printer) are marked `manuell`, their percentage stays empty.
- **Filament usage per slot** (`verbrauch.letzter`, `verbrauch.verlauf`): after each print, extrapolated from what was actually printed if aborted.
- **Messages/events** (`meldung.*`, `ereignis.fertig`) plus `info.connection` and the token's remaining days.

> Note: the printer reports temperatures frequently only while the slicer or app are watching.
> Otherwise they arrive rarely; the adapter additionally resyncs via the cloud on an interval.

## What does not (yet) work

Two things to distinguish: what is **not yet built** (but would be possible) and what is
**fundamentally not possible via the cloud**.

### Not yet included (possible, can be added on demand)

- **Controlling the printer (pause, resume, stop, light, ACE drying).** Technically **possible** via
  the cloud (`sendOrder`), but **not yet included** in this version. Can be added on demand as an
  optional, switchable write module with confirmation. **For now, however, controlling via the slicer
  or the Anycubic app is the more sensible way** — more immediate feedback and no detour through a
  write access from home automation.

### Fundamentally not possible via the cloud (so it will not come later either)

- **Video image / camera still.** The Anycubic cloud provides **no still images (snapshots)** — only
  a short-lived live stream via WebRTC (Agora). A static camera image as a data point is **not
  possible** this way; that is a limitation of the cloud, not something still to come. (A local image
  would only be available in the printer's LAN mode, which this adapter does not use.) For watching,
  the Anycubic app is the direct way.

## History / trends

- The adapter keeps a short history **itself**: `verbrauch.verlauf` holds the **last 30 prints** per
  slot (grams, file, result) as JSON.
- For **time series** (e.g. temperature, progress or fill-level curves) the adapter does not create
  its own database. As with any ioBroker state this is handled by the standard adapters
  **History / SQL / InfluxDB**: enable logging there for the desired data point (e.g. `temp.duese`,
  `job.fortschritt`, `ace.slotN.restProzent`).

## Setup

1. Install the adapter and create an instance.
2. Obtain the **access token** from Anycubic Slicer Next (see below) and enter it in the instance
   settings in the **"Slicer token"** field.
3. Save. The adapter logs in, finds the printer and fills the object tree.

The token is tied to the Anycubic account. It belongs in the instance configuration (stored
encrypted there) and **not** in a repository or log.

## Obtaining the token

Anycubic has no password login via API (captcha/2FA). What is needed is the **access token** that
Anycubic Slicer Next keeps locally after login. It is valid for about **90 days**; after that, log in
again in the slicer and renew the token.

### With the helper script (recommended)

The `admin/` folder contains **`token-holen.ps1`** (PowerShell).

**What the script does:**

1. It first reads the slicer configuration file
   `%APPDATA%\AnycubicSlicerNext\AnycubicSlicerNext.conf`. Older slicer versions store the token
   there in plain text — then you are done immediately.
2. Newer versions encrypt this file. Then a **memory dump** of the slicer is needed once: in
   **Task Manager → "Details" tab → `AnycubicSlicerNext.exe` → right-click → "Create dump file"**.
   Task Manager reports the path (usually under `%TEMP%`). The script finds this `.DMP` file
   automatically (or you pass it with `-Dump <path>`) and **extracts the token from that file**.
3. Candidates found are validated (issuer, token type, expiry); the valid one with the latest expiry
   is used. The token is placed **on the clipboard** and **not displayed** — only its expiry date.

The script **reads files only** (the configuration or the dump file created by the user). It does
**not** access running process memory, needs no administrator rights and sends nothing over the
network.

**Usage:**

```powershell
# slicer is running and logged in
powershell -ExecutionPolicy Bypass -File .\token-holen.ps1
```

Options:

- `-Dump <path>` — use a specific dump file instead of searching automatically
- `-Datei <path>` — additionally write the token to a text file (e.g. to transfer via SSH)

Then paste the token from the clipboard into the instance settings.

> ⚠️ **Tested on Windows x64 only** (Windows 11, PowerShell 5.1 and 7). It has not been verified on
> other operating systems or architectures. The approach itself (readable configuration or a dump of
> the slicer process) applies to macOS as well, but is not automated there.

### If Windows blocks the script

The script is **not signed** (no code signature is offered). Windows may therefore block it at first.
Here is how to get around that — every step is voluntary and transparent:

- **Execution policy:** the call above already contains `-ExecutionPolicy Bypass`; this overrides the
  policy for this single run only, permanently everything stays as it was.
- **"From the internet" mark:** if the file was downloaded, Windows may block it. Either allow it in
  Explorer under **Properties → "Unblock"** at the bottom, or in PowerShell:
  `Unblock-File .\token-holen.ps1`.
- **SmartScreen:** if a blue "Windows protected your PC" window appears, click **"More info → Run
  anyway"**.
- **Antivirus false positive:** because the script searches a memory dump file and puts something on
  the clipboard, some scanners flag it. The source is short and included openly — read it beforehand
  if you like. If you do not trust the script, use the **manual method** (below), which needs no
  script at all.

### By hand (without the script)

- **Older slicers:** open `%APPDATA%\AnycubicSlicerNext\AnycubicSlicerNext.conf` and copy the value
  `anycubic_cloud.access_token`.
- **Newer slicers (encrypted):** create a dump file as above and search it for a long string that
  starts with `eyJ` and contains two dots (a JWT).

## Installation

This adapter is not (yet) in the ioBroker repository. Install from the package:

```bash
npm run build          # TypeScript -> build/
npm pack               # creates iobroker.anycubic-cloud-<version>.tgz
# transfer the package to the ioBroker host, then there:
iobroker url /path/to/iobroker.anycubic-cloud-<version>.tgz
iobroker add anycubic-cloud
```

Requirements: Node.js ≥ 22, js-controller ≥ 6, Admin ≥ 7.

## Development

- `src/` — adapter sources (TypeScript). `src/lib/druckerbild.ts` contains the pure mapping of cloud
  messages to data points, without an ioBroker dependency.
- `werkzeuge/` — helper scripts to try things without installing:
  - `wiedergabe.ts` replays recorded MQTT messages through the mapping (checks it without a printer).
  - `probe-rest.ts` / `probe-mqtt.ts` read the cloud directly (read-only) and write redacted output.
- App credentials and MQTT certificates are **not** in the repo; they are read at runtime from the
  pinned PyPI package `anycubic-cloud-api` (verified via SHA-256).

## Changelog

<!--
    Placeholder for the next version (at the beginning of the line):
    ### **WORK IN PROGRESS**
-->
### 0.2.0 (2026-10-03)
* First public beta: robust reconnect with backoff, plain-text status (`info.status`), dead-man watchdog, token-expiry warning (`info.tokenWarnung`), single-flight REST resync

### 0.1.0
* Initial read-only version: printer status, print job and ACE (filament usage per slot) over the Anycubic cloud

## License

GPL-3.0-or-later. This adapter builds on findings from the
[`anycubic-cloud-api`](https://pypi.org/project/anycubic-cloud-api/) project (GPL-3.0).
