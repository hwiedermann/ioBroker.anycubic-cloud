# ioBroker.anycubic-cloud

[![NPM version](https://img.shields.io/npm/v/iobroker.anycubic-cloud.svg)](https://www.npmjs.com/package/iobroker.anycubic-cloud)
[![Downloads](https://img.shields.io/npm/dm/iobroker.anycubic-cloud.svg)](https://www.npmjs.com/package/iobroker.anycubic-cloud)
[![Test and Release](https://github.com/hwiedermann/ioBroker.anycubic-cloud/actions/workflows/test-and-release.yml/badge.svg)](https://github.com/hwiedermann/ioBroker.anycubic-cloud/actions/workflows/test-and-release.yml)

ioBroker adapter for Anycubic printers (tested with **Kobra S1 + ACE 2 Pro**) via the
**Anycubic cloud**. The adapter is **read-only**: it mirrors the printer state in ioBroker and sends
**no** commands to the printer. There is deliberately neither `publish` nor `sendOrder` in the code.

Manufacturer/device: [Anycubic Kobra S1](https://www.anycubic.com/products/kobra-s1-combo) · [Anycubic](https://www.anycubic.com)

> ⚠️ **Beta, unofficial, at your own risk.** Anycubic offers no public API; the adapter uses the same
> cloud calls as the slicer and, to do so, accesses Anycubic's app credentials and certificates at
> runtime. If Anycubic changes something, the adapter may stop working or access may be blocked. So
> far tested with **one** device only (Kobra S1 + ACE 2 Pro, one firmware, one account). No warranty,
> no affiliation with Anycubic.

> 🇩🇪 Eine deutsche Fassung dieser Anleitung liegt unter [docs/de/README.md](docs/de/README.md).

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

- **State** (`zustand`): idle, downloading, checking, leveling, heating, printing, paused, resuming, finished, stopping, stopped, error (German labels in the object values)
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
  optional, switchable write module with confirmation. For now, however, controlling via the slicer
  or the Anycubic app is the more sensible way — more immediate feedback and no detour through a write
  access from home automation.

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

The repository contains the helper script **[`tools/token-holen.ps1`](https://github.com/hwiedermann/ioBroker.anycubic-cloud/blob/main/tools/token-holen.ps1)** (PowerShell). It is **not** part of the
installed adapter package — download it from GitHub (open the link → "Download raw file").

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

The script is **not signed** (no code signature is offered). Windows may therefore block it at first:

- **Execution policy:** the call above already contains `-ExecutionPolicy Bypass`; this overrides the
  policy for this single run only.
- **"From the internet" mark:** allow it in Explorer under **Properties → "Unblock"**, or in
  PowerShell: `Unblock-File .\token-holen.ps1`.
- **SmartScreen:** if a blue "Windows protected your PC" window appears, click **"More info → Run
  anyway"**.
- **Antivirus false positive:** because the script searches a memory dump file and puts something on
  the clipboard, some scanners flag it. The source is short and included openly. If you do not trust
  the script, use the **manual method** below, which needs no script at all.

### By hand (without the script)

- **Older slicers:** open `%APPDATA%\AnycubicSlicerNext\AnycubicSlicerNext.conf` and copy the value
  `anycubic_cloud.access_token`.
- **Newer slicers (encrypted):** create a dump file as above and search it for a long string that
  starts with `eyJ` and contains two dots (a JWT).

## Installation

This adapter is not (yet) in the ioBroker repository. Install from npm or GitHub:

```bash
iobroker url iobroker.anycubic-cloud
```

Requirements: Node.js >= 22, js-controller >= 6, Admin >= 7.6.17.

## Development

- `src/` — adapter sources (TypeScript). `src/lib/druckerbild.ts` contains the pure mapping of cloud
  messages to data points, without an ioBroker dependency.
- App credentials and MQTT certificates are **not** in the repo; they are read at runtime from the
  pinned PyPI package `anycubic-cloud-api` (verified via SHA-256).

## Changelog
<!--
    Placeholder for the next version (at the beginning of the line):
    ### **WORK IN PROGRESS**
-->
### **WORK IN PROGRESS**

- License text moved to COPYING (unchanged GPL-3.0); LICENSE now holds the copyright and license notice
- Token field in the admin is now a multi-line text field, so browsers no longer offer to generate or save a password for it (the token is still stored encrypted)

### 0.2.2 (2026-10-03)

* Token helper script moved to `tools/` (no longer part of the npm package); README and admin page link to the guide on GitHub
* CI: integration test runs on Node 22/24/26 on Linux, Windows and macOS; releases via the official ioBroker deploy action with trusted publishing

### 0.2.1 (2026-10-03)

* Repository compliance: metadata, translations for all required languages, official CI workflow, English-only README with German docs under `docs/de/`, ESLint config
* Releases are published via GitHub Actions with npm provenance (trusted publishing)

### 0.2.0 (2026-10-03)

* First public beta: robust reconnect with backoff, plain-text status (`info.status`), dead-man watchdog, token-expiry warning (`info.tokenWarnung`), single-flight REST resync

### 0.1.0

* Initial read-only version: printer status, print job and ACE (filament usage per slot) over the Anycubic cloud

[Older changelogs can be found there](CHANGELOG_OLD.md)

## License

Copyright (c) 2026 Hendrik <iobroker@hwiedermann.de>

This adapter is licensed under **GPL-3.0-or-later**; see [LICENSE](LICENSE) for the license notice
and [COPYING](COPYING) for the full license text. It builds on findings from the
[`anycubic-cloud-api`](https://pypi.org/project/anycubic-cloud-api/) project (GPL-3.0).
