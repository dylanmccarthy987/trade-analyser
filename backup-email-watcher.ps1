$backupJson = "C:\Users\dylan.mccarthy\Documents\Trade Analyser Tool\AutoBackups\trade-analyser-backup.json"
$sendScript = "C:\Users\dylan.mccarthy\Documents\Trade Analyser Tool\send-backup.ps1"
$pollSecs   = 5

if (-not (Test-Path $backupJson)) {
    Write-Host "WARNING: $backupJson not found yet — click 'Write backup now' in the app first."
    $lastWrite = [datetime]::MinValue
} else {
    $lastWrite = (Get-Item $backupJson).LastWriteTime
}

Write-Host "Watching for backup changes. Press Ctrl+C to stop."
Write-Host "---"

while ($true) {
    Start-Sleep -Seconds $pollSecs
    try {
        if (Test-Path $backupJson) {
            $current = (Get-Item $backupJson).LastWriteTime
            if ($current -ne $lastWrite) {
                $lastWrite = $current
                Start-Sleep -Seconds 2
                Write-Host "$(Get-Date -Format 'HH:mm:ss')  Backup written — sending email..."
                & powershell -NoProfile -ExecutionPolicy Bypass -File $sendScript
            }
        }
    } catch {
        Write-Host "ERROR: $_"
    }
}
