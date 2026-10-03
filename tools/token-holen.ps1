<#
  Zugangs-Token fuer den ioBroker-Adapter "anycubic-cloud" ermitteln (Windows, PowerShell).

  Kurz:
    1. Anycubic Slicer Next starten und mit dem eigenen Konto anmelden (der Drucker muss dort erscheinen).
    2. Dieses Skript ausfuehren:
         Rechtsklick auf die Datei  ->  "Mit PowerShell ausfuehren"
       oder in einem PowerShell-Fenster:
         powershell -ExecutionPolicy Bypass -File .\token-holen.ps1
    3. Der Token liegt danach in der Zwischenablage. In ioBroker bei der Instanz "anycubic-cloud"
       ins Feld "Slicer-Token" einfuegen und speichern.

  Was das Skript macht:
    - Zuerst liest es die Slicer-Konfigurationsdatei. Aeltere Slicer-Versionen speichern den Token dort
      im Klartext -> dann ist man sofort fertig.
    - Neuere Versionen verschluesseln die Datei. Dann braucht es einmalig eine Abbilddatei des Slicers:
         Task-Manager oeffnen  ->  Reiter "Details"  ->  Eintrag "AnycubicSlicerNext.exe"
         ->  Rechtsklick  ->  "Abbilddatei erstellen".
         Der Task-Manager nennt am Ende den Pfad (meist unter %TEMP%, Datei "AnycubicSlicerNext.DMP").
      Das Skript sucht diese .DMP-Datei automatisch (oder man gibt sie mit  -Dump <Pfad>  an) und
      filtert den Token heraus. Gelesen wird nur die Datei; es wird kein laufender Prozess angefasst.

  Der Token wird nie angezeigt, nur sein Ablaufdatum. Er gilt rund 90 Tage; danach den Slicer neu
  anmelden und dieses Skript erneut ausfuehren.

  Optionen:
    -Dump <Pfad>    eine bestimmte Abbilddatei verwenden, statt automatisch zu suchen
    -Datei <Pfad>   den Token zusaetzlich in eine Textdatei schreiben (z. B. zum Uebertragen per SSH)
#>
param(
    [string]$Dump,
    [string]$Datei
)

$ErrorActionPreference = "Stop"

# --- JWT-Nutzlast (mittlerer Teil) lesen, ohne die Signatur zu pruefen -------------------------------
function Get-Nutzlast([string]$jwt) {
    $teile = $jwt.Split(".")
    if ($teile.Count -ne 3) { return $null }
    $b = $teile[1].Replace("-", "+").Replace("_", "/")
    switch ($b.Length % 4) { 2 { $b += "==" } 3 { $b += "=" } 1 { return $null } }
    try { return [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($b)) | ConvertFrom-Json }
    catch { return $null }
}

# --- Ist das ein gueltiger Slicer-Token? ------------------------------------------------------------
function Test-SlicerToken([string]$jwt) {
    $n = Get-Nutzlast $jwt
    if (-not $n) { return $null }
    if ("$($n.iss)" -notmatch "makeronline") { return $null }      # von der Anycubic-Anmeldung ausgestellt
    if ($n.tokenType -and "$($n.tokenType)" -ne "access-token") { return $null }
    if ($jwt.Split(".")[2].Length -lt 300) { return $null }   # vollstaendige Signatur
    if (-not $n.exp) { return $null }
    $ablauf = [DateTimeOffset]::FromUnixTimeSeconds([long]$n.exp).LocalDateTime
    if ($ablauf -lt (Get-Date)) { return $null }
    return [pscustomobject]@{ Token = $jwt; Ablauf = $ablauf }
}

# --- Aus einem Text alle Token-Kandidaten ziehen und pruefen ----------------------------------------
function Get-TokenAusText([string]$text) {
    $treffer = [regex]::Matches($text, "eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+")
    $gueltig = foreach ($m in $treffer) { Test-SlicerToken $m.Value }
    # bei mehreren den mit dem spaetesten Ablauf
    $gueltig | Sort-Object Ablauf -Descending | Select-Object -First 1
}

function Fertig($fund, [string]$quelle) {
    Set-Clipboard -Value $fund.Token
    Write-Host ""
    Write-Host "Token gefunden ($quelle)." -ForegroundColor Green
    Write-Host ("Gueltig bis {0:dd.MM.yyyy} ({1} Tage)." -f $fund.Ablauf, [int]($fund.Ablauf - (Get-Date)).TotalDays)
    Write-Host "Er liegt jetzt in der Zwischenablage -> in ioBroker ins Feld 'Slicer-Token' einfuegen." -ForegroundColor Cyan
    if ($Datei) {
        [IO.File]::WriteAllText($Datei, $fund.Token)
        Write-Host "Zusaetzlich gespeichert: $Datei"
    }
    exit 0
}

# ====================================================================================================
# 1) Lesbare Slicer-Konfiguration (aeltere Versionen)
$conf = Join-Path $env:APPDATA "AnycubicSlicerNext\AnycubicSlicerNext.conf"
if (Test-Path $conf) {
    try {
        $j = Get-Content $conf -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($j.anycubic_cloud.access_token) {
            $fund = Test-SlicerToken ([string]$j.anycubic_cloud.access_token)
            if ($fund) { Fertig $fund "Slicer-Konfiguration" }
        }
    } catch { }   # verschluesselt oder nicht lesbar -> weiter mit der Abbilddatei
}

# ====================================================================================================
# 2) Abbilddatei des Slicers (neuere, verschluesselnde Versionen)
if (-not $Dump) {
    $orte = @($env:TEMP, [Environment]::GetFolderPath("Desktop"), "$env:USERPROFILE\Downloads")
    $Dump = Get-ChildItem -Path $orte -Filter "AnycubicSlicerNext*.DMP" -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName
}

if (-not $Dump -or -not (Test-Path $Dump)) {
    Write-Host ""
    Write-Host "Keine Abbilddatei gefunden." -ForegroundColor Yellow
    Write-Host "So wird eine erstellt (einmalig, nur der eigene Slicer):" -ForegroundColor Yellow
    Write-Host "  1. Anycubic Slicer Next laeuft und ist angemeldet."
    Write-Host "  2. Task-Manager oeffnen (Strg+Umschalt+Esc)  ->  Reiter 'Details'."
    Write-Host "  3. Eintrag 'AnycubicSlicerNext.exe'  ->  Rechtsklick  ->  'Abbilddatei erstellen'."
    Write-Host "  4. Den im Hinweis genannten Pfad merken und dieses Skript erneut starten"
    Write-Host "     (oder:  powershell -ExecutionPolicy Bypass -File .\token-holen.ps1 -Dump <Pfad>)."
    exit 1
}

Write-Host "Lese Abbilddatei: $Dump"
$bytes = [IO.File]::ReadAllBytes($Dump)

# Als Latin1 (1 Byte = 1 Zeichen) -> faengt Token, die als ASCII gespeichert sind.
$latin1 = [Text.Encoding]::GetEncoding(28591).GetString($bytes)
$fund = Get-TokenAusText $latin1

# Fehlschlag -> Token war evtl. als UTF-16 abgelegt (Nullbytes zwischen den Zeichen): Nullbytes entfernen.
if (-not $fund) {
    $fund = Get-TokenAusText ($latin1 -replace "`0", "")
}

if ($fund) { Fertig $fund "Abbilddatei" }

Write-Host ""
Write-Host "In der Abbilddatei wurde kein gueltiger Token gefunden." -ForegroundColor Red
Write-Host "Bitte sicherstellen, dass der Slicer beim Erstellen der Abbilddatei angemeldet war," -ForegroundColor Red
Write-Host "und die Abbilddatei frisch erstellen." -ForegroundColor Red
exit 1
