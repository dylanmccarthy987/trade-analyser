$src       = "C:\Users\dylan.mccarthy\Documents\Trade Analyser Tool\CSV Fills\Master CSV Fills.CSV"
$backupDir = "C:\Users\dylan.mccarthy\Documents\Trade Analyser Tool\Backup Fills"
$keepCount = 30
$pollSecs  = 10

Write-Host "Starting backup watcher..."

if (-not (Test-Path $src)) {
    Write-Host "ERROR: Source file not found: $src"
    Read-Host "Press Enter to exit"
    exit 1
}

if (-not (Test-Path $backupDir)) {
    Write-Host "Creating backup directory: $backupDir"
    New-Item -ItemType Directory -Path $backupDir | Out-Null
}

$lastWrite = (Get-Item $src).LastWriteTime
Write-Host "Watching: $src"
Write-Host "Backup to: $backupDir"
Write-Host "Last write time: $lastWrite"
Write-Host "Polling every $pollSecs seconds. Press Ctrl+C to stop."
Write-Host "---"

while ($true) {
    Start-Sleep -Seconds $pollSecs
    try {
        $current = (Get-Item $src).LastWriteTime
        if ($current -ne $lastWrite) {
            $lastWrite = $current
            Start-Sleep -Seconds 2
            $stamp = Get-Date -Format 'yyyy-MM-dd_HH-mm-ss'
            $dest  = Join-Path $backupDir "Master CSV Fills_$stamp.CSV"
            Copy-Item -Path $src -Destination $dest -Force
            Write-Host "$(Get-Date -Format 'HH:mm:ss')  Backed up -> $dest"

            Get-ChildItem -Path $backupDir -Filter 'Master CSV Fills_*.CSV' |
                Sort-Object LastWriteTime -Descending |
                Select-Object -Skip $keepCount |
                Remove-Item -Force
        }
    } catch {
        Write-Host "ERROR: $_"
    }
}
