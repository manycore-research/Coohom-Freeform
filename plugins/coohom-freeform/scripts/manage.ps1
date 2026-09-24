param([Parameter(ValueFromRemainingArguments = $true)][string[]]$ManagementArgs)
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = [Console]::OutputEncoding
try {
    if (-not $ManagementArgs -or $ManagementArgs.Count -eq 0) { $ManagementArgs = @('status') }
    if ([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture -ne [System.Runtime.InteropServices.Architecture]::X64) { throw 'Supported systems: Windows x64 and macOS ARM64.' }
    $action = $ManagementArgs[0]
    if ($action -notin @('status', 'doctor', 'upgrade', 'retry', 'resume-current', 'cleanup', 'uninstall')) { throw 'Unknown management action.' }
    $cacheBase = $env:COOHOM_FREEFORM_CACHE
    if (-not $cacheBase) { $cacheBase = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Coohom\Freeform\marketplace' }
    $cacheBase = [System.IO.Path]::GetFullPath($cacheBase)
    $row = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'node-runtime.tsv') | Where-Object { $_.StartsWith("version`t") }
    $version = ($row -split "`t")[1]
    if ($version -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid Node runtime policy.' }
    $nodeRoot = Join-Path $cacheBase "node\node-v$version-win-x64"
    $node = Join-Path $nodeRoot 'node.exe'
    $npm = Join-Path $nodeRoot 'node_modules\npm\bin\npm-cli.js'
    $nodeFailure = Join-Path $cacheBase "node\win-x64-$version.failure.json"
    if (-not (Test-Path -LiteralPath $node)) {
        if ($action -eq 'status') {
            $result = [ordered]@{ validation = 'runtime-missing'; nodeAvailable = $false; currentTaskConnected = $false }
            if (Test-Path -LiteralPath $nodeFailure) { $result.nodePreparation = Get-Content -LiteralPath $nodeFailure -Raw | ConvertFrom-Json }
            if ($ManagementArgs -contains '--json') { $result | ConvertTo-Json -Compress }
            else { Write-Output 'Node runtime is missing. Status did not download or change any files.' }
            exit 0
        }
        if ($action -ne 'upgrade' -and $action -ne 'retry') { throw 'Node runtime is missing. Status and diagnostics do not download it; run an explicit upgrade to prepare it.' }
        $prepareAction = if ($action -eq 'retry') { 'node-retry' } else { 'node-info' }
        & (Join-Path $PSScriptRoot 'bootstrap.ps1') freeform $prepareAction | Out-Null
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
        $env:COOHOM_NODE_PREPARED = '1'
    }
    $platformRow = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'node-runtime.tsv') | Where-Object { $_.StartsWith("win32-x64`t") }
    $checksum = ($platformRow -split "`t")[2]
    $marker = Join-Path $nodeRoot '.coohom-sha256'
    if ($checksum -notmatch '^[a-f0-9]{64}$' -or -not (Test-Path -LiteralPath $marker) -or -not (Test-Path -LiteralPath $npm) -or [IO.File]::ReadAllText($marker).Trim() -cne $checksum) { throw 'The cached Node runtime is incomplete. Inspect it before explicit repair.' }
    Remove-Item Env:NODE_OPTIONS -ErrorAction SilentlyContinue
    Remove-Item Env:NODE_PATH -ErrorAction SilentlyContinue
    & $node (Join-Path $PSScriptRoot 'manage.mjs') (Split-Path $PSScriptRoot -Parent) $cacheBase $npm @ManagementArgs
    exit $LASTEXITCODE
} catch {
    if ($ManagementArgs -contains '--json') { @{ status = 'failed'; reason = $_.Exception.Message } | ConvertTo-Json -Compress }
    else { [Console]::Error.WriteLine('[coohom-freeform] ' + $_.Exception.Message) }
    exit 1
}
