# ioBroker.anycubic-cloud (Deutsch)

> 🇬🇧 The primary documentation is in English: [README.md](../../README.md).

ioBroker-Adapter für Anycubic-Drucker (getestet mit **Kobra S1 + ACE 2 Pro**) über die
**Anycubic-Cloud**. Der Adapter ist **rein lesend**: Er bildet den Druckerzustand in ioBroker ab und
schickt **keine** Befehle an den Drucker. Im Code gibt es bewusst weder `publish` noch `sendOrder`.

Hersteller/Gerät: [Anycubic Kobra S1](https://www.anycubic.com/products/kobra-s1-combo) · [Anycubic](https://www.anycubic.com)

> ⚠️ **Beta, inoffiziell, auf eigenes Risiko.** Anycubic bietet keine offene Schnittstelle; der
> Adapter nutzt denselben Weg wie der Slicer und greift dafür zur Laufzeit auf Kennungen und
> Zertifikate von Anycubic zu. Ändert Anycubic etwas, kann der Adapter ausfallen oder der Zugang
> gesperrt werden. Bisher nur mit **einem** Gerät getestet (Kobra S1 + ACE 2 Pro). Keine Gewähr,
> keine Verbindung zu Anycubic.

## Voraussetzung: Cloud-Modus

Der Drucker muss mit der **Anycubic-Cloud verbunden** sein — so wie bei der Nutzung über die
Anycubic-App oder den angemeldeten Slicer. Der Adapter spricht **ausschließlich mit der Cloud**, nicht
direkt mit dem Drucker im Heimnetz. Im **reinen LAN-/Offline-Modus** funktioniert der Adapter
**nicht**. Geprüft mit dem **Kobra S1**; andere Modelle verhalten sich vermutlich ebenso, das ist aber
nicht getestet.

## Was er liefert

Pro Drucker unter `anycubic-cloud.0.<id>`:

- **Zustand** (`zustand`): frei, lädt, prüft, nivelliert, heizt, druckt, pausiert, setzt_fort, fertig, bricht_ab, abgebrochen, fehler
- **Druckauftrag** (`job.*`): Datei, Fortschritt %, Restzeit, Laufzeit, Schicht/Schichten, Filament (mm und g), Start/Ende, Pausegrund
- **Temperaturen** (`temp.*`) und **Lüfter** (`luefter.*`)
- **ACE** (`ace.*`): Temperatur, Feuchte, geladener Slot, Trocknung; je Slot Farbe, Material, SKU und Restmenge. Slots ohne RFID werden als `manuell` markiert, ihr Prozentwert bleibt leer.
- **Filamentverbrauch je Slot** (`verbrauch.letzter`, `verbrauch.verlauf`): nach jedem Druck, bei Abbruch hochgerechnet.
- **Meldungen/Ereignisse** (`meldung.*`, `ereignis.fertig`) sowie `info.connection` und die Resttage des Tokens.

## Was (noch) nicht geht

- **Steuerung des Druckers (Pause, Fortsetzen, Stopp, Licht, ACE-Trocknen):** über die Cloud
  technisch möglich (`sendOrder`), aber **noch nicht enthalten**. Derzeit ist das Steuern über Slicer
  oder App der sinnvollere Weg.
- **Videobild / Kamera-Einzelbild:** Die Cloud liefert **keine Einzelbilder**, nur einen kurzlebigen
  WebRTC-Live-Stream. Ein stehendes Kamerabild als Datenpunkt ist darüber **nicht möglich** — das ist
  eine Grenze der Cloud, kein „noch nicht".

## Verläufe / Historie

- Der Adapter führt selbst einen kurzen Verlauf: `verbrauch.verlauf` (letzte 30 Drucke je Slot).
- **Zeitreihen** (Temperatur, Fortschritt, Füllstand) übernehmen wie bei jedem State die Adapter
  **History / SQL / InfluxDB**.

## Einrichtung

1. Adapter installieren und eine Instanz anlegen.
2. **Zugangs-Token** aus Anycubic Slicer Next besorgen (siehe englische Anleitung) und im Feld
   **„Slicer-Token"** eintragen.
3. Speichern. Der Adapter meldet sich an, findet den Drucker und füllt den Objektbaum.

Die ausführliche Token-Anleitung (Hilfsskript [`tools/token-holen.ps1`](https://github.com/hwiedermann/ioBroker.anycubic-cloud/blob/main/tools/token-holen.ps1) — liegt nur im GitHub-Repo, nicht im installierten Adapter; nur Windows x64 getestet, sowie
der manuelle Weg) steht in der englischen [README.md](../../README.md).

## Lizenz

Copyright (c) 2026 Hendrik <iobroker@hwiedermann.de>

Lizenziert unter **GPL-3.0-or-later**; der Lizenzhinweis steht in
[LICENSE](../../LICENSE), der vollständige Lizenztext in [COPYING](../../COPYING). Baut auf Erkenntnissen aus dem Projekt
[`anycubic-cloud-api`](https://pypi.org/project/anycubic-cloud-api/) (GPL-3.0) auf.
