Set-Location $PSScriptRoot
npm ci 2>&1 | Out-File -FilePath "$PSScriptRoot\install_log.txt" -Encoding utf8
Write-Host "Done. Exit code: $LASTEXITCODE"
