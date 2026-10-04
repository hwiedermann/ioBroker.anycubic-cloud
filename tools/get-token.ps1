<#
  Gets the access token for the ioBroker adapter "anycubic-cloud" (Windows, PowerShell).

  In short:
    1. Start Anycubic Slicer Next and log in with your account (the printer must show up there).
    2. Run this script:
         right-click the file  ->  "Run with PowerShell"
       or in a PowerShell window:
         powershell -ExecutionPolicy Bypass -File .\get-token.ps1
    3. The token is now on the clipboard. Paste it into the "Slicer token" field of the
       anycubic-cloud instance in ioBroker and save.

  What the script does:
    - It first reads the slicer configuration file. Older slicer versions store the token there in
      plain text, then you are done.
    - Newer versions encrypt that file. Then a dump file of the slicer is needed once:
         Task Manager  ->  "Details" tab  ->  "AnycubicSlicerNext.exe"
         ->  right-click  ->  "Create dump file".
         Task Manager shows the path at the end (usually under %TEMP%, file "AnycubicSlicerNext.DMP").
      The script finds this .DMP file automatically (or pass it with  -Dump <path>) and extracts the
      token. Only the file is read; no running process is touched.

  The token is never displayed, only its expiry date. It is valid for about 90 days; after that, log in
  to the slicer again and run this script again.

  Options:
    -Dump <path>      use a specific dump file instead of searching for one
    -OutFile <path>   additionally write the token to a text file (e.g. to transfer it via SSH)
#>
param(
    [string]$Dump,
    [string]$OutFile
)

$ErrorActionPreference = "Stop"

# --- read the JWT payload (middle part) without verifying the signature ------------------------------
function Get-Payload([string]$jwt) {
    $parts = $jwt.Split(".")
    if ($parts.Count -ne 3) { return $null }
    $b = $parts[1].Replace("-", "+").Replace("_", "/")
    switch ($b.Length % 4) { 2 { $b += "==" } 3 { $b += "=" } 1 { return $null } }
    try { return [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($b)) | ConvertFrom-Json }
    catch { return $null }
}

# --- is this a valid slicer token? ----------------------------------------------------------------
function Test-SlicerToken([string]$jwt) {
    $p = Get-Payload $jwt
    if (-not $p) { return $null }
    if ("$($p.iss)" -notmatch "makeronline") { return $null }      # issued by the Anycubic login
    if ($p.tokenType -and "$($p.tokenType)" -ne "access-token") { return $null }
    if ($jwt.Split(".")[2].Length -lt 300) { return $null }   # complete signature
    if (-not $p.exp) { return $null }
    $expiry = [DateTimeOffset]::FromUnixTimeSeconds([long]$p.exp).LocalDateTime
    if ($expiry -lt (Get-Date)) { return $null }
    return [pscustomobject]@{ Token = $jwt; Expiry = $expiry }
}

# --- extract all token candidates from a text and validate them -----------------------------------
function Get-TokenFromText([string]$text) {
    $hits = [regex]::Matches($text, "eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+")
    $valid = foreach ($m in $hits) { Test-SlicerToken $m.Value }
    # if there are several, take the one that expires last
    $valid | Sort-Object Expiry -Descending | Select-Object -First 1
}

function Complete($found, [string]$source) {
    Set-Clipboard -Value $found.Token
    Write-Host ""
    Write-Host "Token found ($source)." -ForegroundColor Green
    Write-Host ("Valid until {0:yyyy-MM-dd} ({1} days)." -f $found.Expiry, [int]($found.Expiry - (Get-Date)).TotalDays)
    Write-Host "It is on the clipboard now -> paste it into the 'Slicer token' field in ioBroker." -ForegroundColor Cyan
    if ($OutFile) {
        [IO.File]::WriteAllText($OutFile, $found.Token)
        Write-Host "Also saved to: $OutFile"
    }
    exit 0
}

# ====================================================================================================
# 1) readable slicer configuration (older versions)
$conf = Join-Path $env:APPDATA "AnycubicSlicerNext\AnycubicSlicerNext.conf"
if (Test-Path $conf) {
    try {
        $j = Get-Content $conf -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($j.anycubic_cloud.access_token) {
            $found = Test-SlicerToken ([string]$j.anycubic_cloud.access_token)
            if ($found) { Complete $found "slicer configuration" }
        }
    } catch { }   # encrypted or unreadable -> continue with the dump file
}

# ====================================================================================================
# 2) dump file of the slicer (newer, encrypting versions)
if (-not $Dump) {
    $places = @($env:TEMP, [Environment]::GetFolderPath("Desktop"), "$env:USERPROFILE\Downloads")
    $Dump = Get-ChildItem -Path $places -Filter "AnycubicSlicerNext*.DMP" -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName
}

if (-not $Dump -or -not (Test-Path $Dump)) {
    Write-Host ""
    Write-Host "No dump file found." -ForegroundColor Yellow
    Write-Host "How to create one (once, only your own slicer):" -ForegroundColor Yellow
    Write-Host "  1. Anycubic Slicer Next is running and logged in."
    Write-Host "  2. Open Task Manager (Ctrl+Shift+Esc)  ->  'Details' tab."
    Write-Host "  3. 'AnycubicSlicerNext.exe'  ->  right-click  ->  'Create dump file'."
    Write-Host "  4. Note the path shown and run this script again"
    Write-Host "     (or:  powershell -ExecutionPolicy Bypass -File .\get-token.ps1 -Dump <path>)."
    exit 1
}

Write-Host "Reading dump file: $Dump"
$bytes = [IO.File]::ReadAllBytes($Dump)

# as Latin1 (1 byte = 1 character) -> finds tokens stored as ASCII
$latin1 = [Text.Encoding]::GetEncoding(28591).GetString($bytes)
$found = Get-TokenFromText $latin1

# not found -> the token may be stored as UTF-16 (null bytes between the characters): remove them
if (-not $found) {
    $found = Get-TokenFromText ($latin1 -replace "`0", "")
}

if ($found) { Complete $found "dump file" }

Write-Host ""
Write-Host "No valid token found in the dump file." -ForegroundColor Red
Write-Host "Make sure the slicer was logged in when the dump file was created," -ForegroundColor Red
Write-Host "and create a fresh dump file." -ForegroundColor Red
exit 1
