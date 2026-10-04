# ioBroker.anycubic-cloud

[English documentation](../../README.md)

## Beschreibung

Liest den Zustand von Anycubic-3D-Druckern und der Filamentbox ACE Pro aus der Anycubic-Cloud: Druckauftrag,
Temperaturen, Lüfter, ACE-Slots und den Filamentverbrauch je Slot. Der Adapter liest nur und schickt keine
Befehle an den Drucker.

Getestet mit Kobra S1 und ACE 2 Pro. Andere Modelle, die mit der Anycubic-App laufen, sollten ebenfalls
funktionieren; Rückmeldungen sind willkommen.

> [!WARNING]
> Inoffiziell. Anycubic hat keine offene Schnittstelle. Der Adapter nutzt dieselben Cloud-Aufrufe wie
> Anycubic Slicer Next und lädt die App-Kennungen und Zertifikate zur Laufzeit aus dem Open-Source-Projekt
> [anycubic-cloud-api](https://pypi.org/project/anycubic-cloud-api/). Ändert Anycubic die Cloud, kann der
> Adapter ausfallen.

Der Drucker muss mit der Anycubic-Cloud verbunden sein. Im reinen LAN-Modus ist er nicht erreichbar.

## Installation

Der Adapter ist noch nicht im ioBroker-Repository. Installation von npm:

```bash
iobroker url iobroker.anycubic-cloud
```

Voraussetzungen: Node.js ab 22.18, js-controller ab 6.0.11, Admin ab 7.6.20.

## Konfiguration

| Einstellung | Bedeutung |
| --- | --- |
| Slicer-Token | Zugangs-Token von Anycubic Slicer Next, siehe unten |
| REST-Abgleich | Abstand des vollständigen Abgleichs über REST in Minuten (Standard 10) |
| Token-Warnung | Tage vor Ablauf, ab denen `info.tokenExpiring` gesetzt wird (Standard 14) |

### Token ermitteln

Anycubic bietet keine Anmeldung mit Benutzername und Passwort über die API. Der Adapter nutzt den
Zugangs-Token, den Anycubic Slicer Next nach der Anmeldung speichert. Er gilt etwa 90 Tage.

Unter Windows erledigt das Skript [`tools/get-token.ps1`](https://github.com/hwiedermann/ioBroker.anycubic-cloud/blob/main/tools/get-token.ps1)
die Arbeit. Es ist nicht Teil des npm-Pakets, also von GitHub herunterladen.

1. Anycubic Slicer Next starten und anmelden.
2. `powershell -ExecutionPolicy Bypass -File .\get-token.ps1` ausführen.
3. Das Skript liest die Slicer-Konfiguration. Neuere Slicer-Versionen verschlüsseln sie; dann fragt das
   Skript nach einer Abbilddatei: Task-Manager, Reiter „Details“, Rechtsklick auf `AnycubicSlicerNext.exe`,
   „Abbilddatei erstellen“. Danach das Skript erneut starten, es findet die Datei in `%TEMP%`.
4. Der Token liegt in der Zwischenablage. In die Instanz-Einstellungen einfügen.

Das Skript liest nur Dateien und schickt nichts ins Netz. Es ist nicht signiert, Windows fragt deshalb
eventuell nach (`Unblock-File .\get-token.ps1` oder „Weitere Informationen, Trotzdem ausführen“).

Ohne Skript: Ältere Slicer-Versionen speichern den Token im Klartext in
`%APPDATA%\AnycubicSlicerNext\AnycubicSlicerNext.conf` (`anycubic_cloud.access_token`). In einer
Abbilddatei ist der Token eine lange Zeichenkette, die mit `eyJ` beginnt und zwei Punkte enthält.

## Datenpunkte

Ein Gerät je Drucker, benannt nach seiner Cloud-ID.

| Datenpunkt | Bedeutung |
| --- | --- |
| `status` | idle, downloading, checking, leveling, heating, printing, paused, resuming, finished, stopping, stopped, error |
| `online`, `busy`, `model`, `firmware`, `firmwareUpdate` | Druckerdaten |
| `light`, `lightBrightness` | Innenbeleuchtung |
| `job.*` | Datei, Fortschritt, Rest- und Laufzeit, Schichten, Filament (mm, g, geplant), Start, Ende, Pause-Grund |
| `temperature.*` | Düse und Bett, Ist und Soll |
| `fan.*` | Bauteil-, Hilfs- und ACE-Lüfter |
| `ace.*` | Temperatur, Feuchte, aktiver Slot, Trocknen |
| `ace.slotN.*` | Farbe, Material, SKU, Restmenge in %. `manual` ist true bei Rollen, die am Drucker von Hand eingetragen wurden (ohne RFID); sie haben keinen Restwert. |
| `usage.last`, `usage.history` | Filamentverbrauch je Slot für den letzten Druck und die letzten 30 Drucke (JSON) |
| `event.finished` | true, wenn ein Druck fertig ist, false beim nächsten Start |
| `message.*` | Letzte Fehler- oder Hinweismeldung des Druckers |
| `info.tokenExpiry`, `info.tokenDaysLeft`, `info.tokenExpiring` | Ablauf des Tokens |

Temperaturen schickt der Drucker oft nur, solange App oder Slicer geöffnet sind; sonst aktualisiert sie der
REST-Abgleich.

### Nicht unterstützt

- Steuern des Druckers (Pause, Abbruch, Licht, Trocknen). Über die Cloud möglich, aber noch nicht umgesetzt.
- Kamerabilder. Die Cloud liefert nur einen Livestream, keine Standbilder.

### Umstieg von 0.2.x

Ab 0.3.0 sind alle Datenpunkte und Werte englisch, zum Beispiel `zustand` → `status`, `druckt` → `printing`,
`temp.duese` → `temperature.nozzle`. Beim ersten Start löscht der Adapter die alten Objekte und übernimmt den
Filamentverbrauch. Aufzeichnungen von History, SQL oder InfluxDB bleiben an den alten Datenpunkten. Skripte
und Visualisierungen müssen angepasst werden.
