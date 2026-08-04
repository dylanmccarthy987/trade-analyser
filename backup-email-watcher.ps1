$backupJson = "C:\Users\dylan.mccarthy\Documents\Trade Analyser Tool\AutoBackups\trade-analyser-backup.json"
$sendScript = "C:\Users\dylan.mccarthy\Documents\Trade Analyser Tool\send-backup.ps1"
$logFile    = "C:\Users\dylan.mccarthy\Documents\Trade Analyser Tool\backup-email-watcher.log"
$pollSecs   = 5

function Log($msg) {
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $msg"
    Add-Content -Path $logFile -Value $line
}

Log "Watcher started"
$lastWrite = if (Test-Path $backupJson) { (Get-Item $backupJson).LastWriteTime } else { [datetime]::MinValue }
Log "Watching: $backupJson"

while ($true) {
    Start-Sleep -Seconds $pollSecs
    try {
        if (Test-Path $backupJson) {
            $current = (Get-Item $backupJson).LastWriteTime
            if ($current -ne $lastWrite) {
                $lastWrite = $current
                Start-Sleep -Seconds 2
                Log "Backup changed - sending email..."
                powershell -NoProfile -ExecutionPolicy Bypass -File $sendScript >> $logFile 2>&1
                Log "Email script done"
            }
        }
    } catch {
        Log "ERROR: $($_.Exception.Message)"
    }
}
