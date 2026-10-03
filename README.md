# ioBroker.anycubic-cloud

ioBroker-Adapter für Anycubic-Drucker (getestet mit **Kobra S1 + ACE 2 Pro**) über die
**Anycubic-Cloud**. Der Adapter ist **rein lesend**: Er bildet den Druckerzustand in ioBroker ab
und schickt **keine** Befehle an den Drucker (kein Starten, Pausieren, Stoppen). Im Code gibt es
bewusst weder `publish` noch `sendOrder`.

> Inoffiziell. Anycubic bietet keine öffentliche Schnittstelle; der Adapter nutzt dieselben
> Cloud-Aufrufe wie der Slicer. Ändert Anycubic etwas, kann der Adapter ausfallen.

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
