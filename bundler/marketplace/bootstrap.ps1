param([Parameter(Mandatory = $true)][ValidateSet('freeform', 'lux3d')][string]$Service,
    [ValidateSet('status', 'install', 'retry', 'versions', 'node-info', 'node-retry')][string]$Action, [string]$FreeformVersion, [string]$Lux3dVersion)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = [Console]::OutputEncoding
$nodeLock = $null
$stage = $null
$preparingNode = $false
try {
    if ([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture -ne [System.Runtime.InteropServices.Architecture]::X64) { throw 'This marketplace supports Windows x64 and macOS ARM64.' }
    if ($Action -eq 'status') { & (Join-Path $PSScriptRoot 'manage.ps1') status --json; exit $LASTEXITCODE }
    $rows = @(Get-Content -LiteralPath (Join-Path $PSScriptRoot 'node-runtime.tsv'))
    $version = ($rows | Where-Object { $_.StartsWith("version`t") }) -split "`t"
    $policy = ($rows | Where-Object { $_.StartsWith("win32-x64`t") }) -split "`t"
    if ($version.Count -ne 2 -or $version[1] -notmatch '^\d+\.\d+\.\d+$' -or $policy.Count -ne 3 -or $policy[2] -notmatch '^[a-f0-9]{64}$') {
        throw 'Invalid bundled Node policy.'
    }
    $nodeVersion = $version[1]
    $archiveName = "node-v$nodeVersion-win-x64.zip"
    if ($policy[1] -cne $archiveName) { throw 'Node archive does not match the supported platform.' }
    $cacheBase = $env:COOHOM_FREEFORM_CACHE
    if (-not $cacheBase) { $cacheBase = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Coohom\Freeform\marketplace' }
    $cacheBase = [System.IO.Path]::GetFullPath($cacheBase)
    $nodeParent = Join-Path $cacheBase 'node'
    [System.IO.Directory]::CreateDirectory($nodeParent) | Out-Null
    $nodeRoot = Join-Path $nodeParent "node-v$nodeVersion-win-x64"
    $node = Join-Path $nodeRoot 'node.exe'
    $npmCli = Join-Path $nodeRoot 'node_modules\npm\bin\npm-cli.js'
    $marker = Join-Path $nodeRoot '.coohom-sha256'
    $lockPath = Join-Path $nodeParent "win-x64-$nodeVersion.lock"
    $failurePath = Join-Path $nodeParent "win-x64-$nodeVersion.failure.json"
    $deadline = [DateTime]::UtcNow.AddSeconds(240)
    while (-not $nodeLock) {
        try { $nodeLock = [System.IO.File]::Open($lockPath, 'OpenOrCreate', 'ReadWrite', 'None') }
        catch [System.IO.IOException] {
            if ([DateTime]::UtcNow -gt $deadline) { throw 'Timed out waiting for the Node preparation lock. Retry after the other Coohom startup finishes.' }
            Start-Sleep -Milliseconds 250
        }
    }
    if ($Action -eq 'retry' -or $Action -eq 'node-retry') { Remove-Item -LiteralPath $failurePath -Force -ErrorAction SilentlyContinue }
    if (Test-Path -LiteralPath $failurePath) { throw 'Previous Node preparation failed or was interrupted. Choose retry or stop; ordinary startup does not download again.' }
    if (-not (Test-Path -LiteralPath $nodeRoot)) {
        $preparingNode = $true
        [IO.File]::WriteAllText($failurePath, '{"status":"interrupted","stage":"node"}')
        [Console]::Error.WriteLine("[coohom-freeform] Preparing Node $nodeVersion; first startup requires internet access.")
        $stage = Join-Path $nodeParent ('.download-' + [Guid]::NewGuid().ToString('N'))
        [System.IO.Directory]::CreateDirectory($stage) | Out-Null
        $archive = Join-Path $stage $archiveName
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -UseBasicParsing -Uri "https://nodejs.org/dist/v$nodeVersion/$archiveName" -OutFile $archive -TimeoutSec 180
        if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -cne $policy[2]) { throw 'Node archive SHA256 mismatch; downloaded files will not be executed.' }
        $tar = Join-Path ([Environment]::SystemDirectory) 'tar.exe'
        if (-not (Test-Path -LiteralPath $tar)) { throw 'Windows system tar.exe is required to unpack Node. Use a supported Windows installation with the system tar utility.' }
        # Native tar can lose Unicode in argv on non-UTF-8 Windows systems.
        # The inherited working directory preserves it; archive names are ASCII.
        Push-Location -LiteralPath $stage
        try {
            & $tar -xf $archiveName -C . | Out-Null
            if ($LASTEXITCODE -ne 0) { throw 'Node archive extraction failed.' }
        } finally { Pop-Location }
        $expanded = Join-Path $stage "node-v$nodeVersion-win-x64"
        if (-not (Test-Path -LiteralPath (Join-Path $expanded 'node.exe')) -or -not (Test-Path -LiteralPath (Join-Path $expanded 'node_modules\npm\bin\npm-cli.js'))) { throw 'Incomplete Node archive.' }
        [System.IO.File]::WriteAllText((Join-Path $expanded '.coohom-sha256'), $policy[2])
        Move-Item -LiteralPath $expanded -Destination $nodeRoot
        Remove-Item -LiteralPath $failurePath -Force
        $preparingNode = $false
    }
    if (-not (Test-Path -LiteralPath $node) -or -not (Test-Path -LiteralPath $npmCli) -or -not (Test-Path -LiteralPath $marker) -or [System.IO.File]::ReadAllText($marker).Trim() -cne $policy[2]) {
        throw 'The Coohom Node cache is incomplete. Close Coohom tasks and follow the cache repair instructions.'
    }
    $nodeLock.Dispose()
    $nodeLock = $null
    if ($stage) {
        if ([System.IO.Path]::GetDirectoryName([System.IO.Path]::GetFullPath($stage)) -ne $nodeParent) { throw 'Unexpected download cleanup path.' }
        Remove-Item -LiteralPath $stage -Recurse -Force
        $stage = $null
    }
    Remove-Item Env:NODE_OPTIONS -ErrorAction SilentlyContinue
    Remove-Item Env:NODE_PATH -ErrorAction SilentlyContinue
    if ($Action -eq 'node-info' -or $Action -eq 'node-retry') {
        [ordered]@{ nodeExecutable = $node; npmCliPath = $npmCli } | ConvertTo-Json -Compress
        exit 0
    }
    $mcpArgs = @($Service, $cacheBase, $npmCli)
    if ($Action -eq 'retry' -and -not (Test-Path -LiteralPath (Join-Path $cacheBase 'mcp-state\mcp-install-state.json'))) { $Action = 'install' }
    if ($Action) { $mcpArgs += $Action }
    if ($FreeformVersion) { $mcpArgs += $FreeformVersion }
    if ($Lux3dVersion) { $mcpArgs += $Lux3dVersion }
    & $node (Join-Path $PSScriptRoot 'marketplace.mjs') @mcpArgs
    exit $LASTEXITCODE
} catch {
    if ($preparingNode) { [IO.File]::WriteAllText($failurePath, (@{ status = 'failed'; stage = 'node'; failedAt = [DateTime]::UtcNow.ToString('o'); reason = 'Node download, checksum verification or extraction failed. Explicit retry required.' } | ConvertTo-Json -Compress)) }
    [Console]::Error.WriteLine('[coohom-freeform] ' + $_.Exception.Message)
    exit 1
} finally {
    if ($nodeLock) { $nodeLock.Dispose() }
    if ($stage -and [System.IO.Path]::GetDirectoryName([System.IO.Path]::GetFullPath($stage)) -eq $nodeParent -and (Test-Path -LiteralPath $stage)) {
        Remove-Item -LiteralPath $stage -Recurse -Force
    }
}
