# Older changes
## 0.3.0 (2026-10-04)

- (hwiedermann) BREAKING: State IDs and values are now English, e.g. `zustand` is now `status` and `temp.duese` is now `temperature.nozzle`. Old objects are deleted on the first start, the filament usage history is carried over. History, SQL or InfluxDB data stays with the old IDs. Adapt scripts and visualizations.
- (hwiedermann) Compact mode supported
- (hwiedermann) Token field in the admin is a text area, so browsers no longer offer to generate a password
- (hwiedermann) Token script renamed to `tools/get-token.ps1` and translated to English
- (hwiedermann) License text moved to COPYING, LICENSE holds the copyright notice

## 0.2.2 (2026-10-03)

- (hwiedermann) Token helper script moved to `tools/` and no longer part of the npm package
- (hwiedermann) CI: integration tests on Node 22/24/26 on Linux, Windows and macOS, releases with trusted publishing

## 0.2.1 (2026-10-03)

- (hwiedermann) Repository checker findings fixed: metadata, translations, CI workflow, English README
- (hwiedermann) Releases are published with npm provenance

## 0.2.0 (2026-10-03)

- (hwiedermann) First public beta: reconnect with backoff, plain text status, watchdog, token expiry warning

## 0.1.0

- (hwiedermann) Initial release
