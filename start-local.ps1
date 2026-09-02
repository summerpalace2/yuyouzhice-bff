[CmdletBinding()]
param(
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$JavaRoot = 'D:\scenic-guide\ai'
$Config = Join-Path $JavaRoot '.env'
$Template = Join-Path $JavaRoot '.env.example'
$LogRoot = Join-Path $env:TEMP 'yuyouzhice-local-logs'
$JavaLog = Join-Path $LogRoot 'java-runtime.log'
$JavaErrorLog = Join-Path $LogRoot 'java-runtime.error.log'
$NodeLog = Join-Path $LogRoot 'bff-runtime.stdout.log'
$NodeErrorLog = Join-Path $LogRoot 'bff-runtime.stderr.log'

if (-not (Test-Path -LiteralPath $Config)) {
    & (Join-Path $Root 'init-local-config.ps1') -JavaRoot $JavaRoot
}
if (-not (Test-Path -LiteralPath $Config)) {
    throw ("Canonical environment file is missing: {0}" -f $Config)
}

function Get-EnvValue {
    param([string]$Name)
    $item = Get-Item -Path ("Env:{0}" -f $Name) -ErrorAction SilentlyContinue
    if ($null -eq $item) { return '' }
    return [string]$item.Value
}

function Clear-CanonicalProcessEnv {
    if (-not (Test-Path -LiteralPath $Template)) { return }
    foreach ($sourceLine in [System.IO.File]::ReadAllLines($Template)) {
        # Clear active names and commented compatibility aliases so an inherited
        # process variable cannot silently bypass the canonical .env file.
        $line = $sourceLine.Trim()
        $match = [regex]::Match($line, '^(?:#\s*)?(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=')
        if ($match.Success) {
            Remove-Item -Path ("Env:{0}" -f $match.Groups[1].Value) -ErrorAction SilentlyContinue
        }
    }
}

function Import-CanonicalEnv {
    param([string]$Path)
    foreach ($sourceLine in [System.IO.File]::ReadAllLines($Path)) {
        $line = $sourceLine.Trim()
        if ([string]::IsNullOrWhiteSpace($line) -or $line.StartsWith('#')) { continue }
        $match = [regex]::Match($line, '^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$')
        if (-not $match.Success) { continue }
        $name = $match.Groups[1].Value
        $value = $match.Groups[2].Value.Trim()
        if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
            $value = $value.Substring(1, $value.Length - 2)
        } else {
            $value = $value -replace '\s+#.*$', ''
            $value = $value.Trim()
        }
        Set-Item -Path ("Env:{0}" -f $name) -Value $value
    }
}

$NodeEnvironmentNames = @(
    'CORE_BACKEND_URL',
    'YUYOUZHICE_JAVA_CORE_URL',
    'YUYOUZHICE_JAVA_TIMEOUT_MS',
    'PORT',
    'YUYOUZHICE_SESSION_TTL_MS',
    'YUYOUZHICE_TOKEN_TTL_MS',
    'YUYOUZHICE_DATA_FILE',
    'YUYOUZHICE_MEMORY',
    'YUYOUZHICE_WEB_ORIGINS',
    'YUYOUZHICE_AUTH_SECRET',
    'YUYOUZHICE_LOG_FILE',
    'YUYOUZHICE_REVOKE_STORE',
    'YUYOUZHICE_REDIS_URL',
    'YUYOUZHICE_REDIS_HOST',
    'YUYOUZHICE_REDIS_PORT',
    'YUYOUZHICE_REDIS_PASSWORD',
    'YUYOUZHICE_REDIS_DATABASE',
    'YUYOUZHICE_REDIS_SSL',
    'YUYOUZHICE_REDIS_TIMEOUT_MS',
    'YUYOUZHICE_REDIS_KEY_PREFIX',
    'REDIS_HOST',
    'REDIS_PORT',
    'REDIS_PASSWORD',
    'REDIS_DATABASE',
    'REDIS_SSL',
    'REDIS_TIMEOUT_MS',
    'AMAP_WEB_JS_KEY',
    'AMAP_WEB_JS_SECURITY_CODE',
    'AMAP_JS_KEY',
    'AMAP_JS_SECURITY_KEY',
    'YUYOUZHICE_TEST_FIXTURES',
    'YUYOUZHICE_TEST_SESSION_COMPAT',
    'YUYOUZHICE_JAVA_TEST_STUB',
    'YUYOUZHICE_TEST_ADMIN_EMAIL',
    'YUYOUZHICE_TEST_ADMIN_PASSWORD'
)

function Capture-NodeEnvironment {
    $values = @{}
    foreach ($name in $NodeEnvironmentNames) {
        $item = Get-Item -Path ("Env:{0}" -f $name) -ErrorAction SilentlyContinue
        if ($null -ne $item) { $values[$name] = [string]$item.Value }
    }
    return $values
}

function Apply-NodeEnvironment {
    param([hashtable]$Values)
    Clear-CanonicalProcessEnv
    foreach ($entry in $Values.GetEnumerator()) {
        Set-Item -Path ("Env:{0}" -f $entry.Key) -Value ([string]$entry.Value)
    }
}

function Configured {
    param([string]$Name)
    $value = Get-EnvValue -Name $Name
    return ((-not [string]::IsNullOrWhiteSpace($value)) -and ($value -notmatch '^(?:CHANGE_ME|your_|replace_)'))
}

function ConfiguredAny {
    param([string[]]$Names)
    foreach ($name in $Names) {
        if (Configured -Name $name) { return $true }
    }
    return $false
}

function Show-Status {
    param(
        [string]$Label,
        [string]$State
    )
    Write-Host ("{0,-24} {1}" -f $Label, $State)
}

function Show-Section {
    param([string]$Name)
    Write-Host ''
    Write-Host ("[{0}]" -f $Name)
}

function Wait-ForPort {
    param([int]$Port, [int]$TimeoutSeconds = 45)
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        try {
            if ((Test-NetConnection -ComputerName 127.0.0.1 -Port $Port -WarningAction SilentlyContinue).TcpTestSucceeded) { return $true }
        } catch { }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $deadline)
    return $false
}

Clear-CanonicalProcessEnv
Import-CanonicalEnv -Path $Config
$nodeEnvironment = Capture-NodeEnvironment
# The one-click local runtime must retain BFF -> Java Planner mappings across
# a Node restart. YUYOUZHICE_MEMORY=1 remains available to isolated tests, but
# is never appropriate for the user-facing :3000 service.
$nodeEnvironment['YUYOUZHICE_MEMORY'] = '0'
$nodeEnvironment['YUYOUZHICE_LOG_FILE'] = (Join-Path $LogRoot 'bff-runtime.log')
$env:SCENIC_GUIDE_JAVA_DIR = $JavaRoot
New-Item -ItemType Directory -Path $LogRoot -Force | Out-Null
Write-Host ('Runtime logs: ' + $LogRoot)

Write-Host 'Local configuration status (values are never printed):'
Write-Host ('Canonical source: ' + $Config)

Show-Section -Name 'CORE'
$jwtReady = Configured -Name 'JWT_SECRET'
$authReady = Configured -Name 'YUYOUZHICE_AUTH_SECRET'
Show-Status -Label 'AUTH SECRETS' -State $(if ($jwtReady -and $authReady) { 'READY' } else { 'MISSING' })
Show-Status -Label 'CORE BACKEND' -State $(if (Configured -Name 'CORE_BACKEND_URL') { 'CONFIGURED' } else { 'DEFAULT localhost:8080' })

Show-Section -Name 'AI'
$aiConfigured = ConfiguredAny -Names @('DEEPSEEK_API_KEY', 'DASHSCOPE_API_KEY', 'BAILIAN_API_KEY')
Show-Status -Label 'PROVIDER' -State $(if ($aiConfigured) { 'CONFIGURED' } else { 'DISABLED' })

Show-Section -Name 'MAP'
Show-Status -Label 'AMAP WEB SERVICE' -State $(if (Configured -Name 'AMAP_WEB_SERVICE_KEY') { 'CONFIGURED' } else { 'DISABLED' })
Show-Status -Label 'AMAP WEB JS' -State $(if (Configured -Name 'AMAP_WEB_JS_KEY') { 'CONFIGURED' } else { 'DISABLED' })

Show-Section -Name 'RAG'
$embeddingConfigured = ConfiguredAny -Names @('YUYOUZHICE_EMBEDDING_API_KEY', 'DASHSCOPE_API_KEY', 'BAILIAN_API_KEY')
$qdrantConfigured = (Configured -Name 'QDRANT_URL') -or (Configured -Name 'QDRANT_API_KEY') -or ((Configured -Name 'QDRANT_HOST') -and ((Get-EnvValue -Name 'QDRANT_HOST') -ne 'localhost'))
Show-Status -Label 'EMBEDDING' -State $(if ($embeddingConfigured) { 'CONFIGURED' } else { 'DISABLED' })
Show-Status -Label 'QDRANT' -State $(if ($qdrantConfigured) { 'CONFIGURED' } else { 'DISABLED' })

Show-Section -Name 'OPTIONAL'
$dbState = if ((Get-EnvValue -Name 'KNOWLEDGE_DB_TYPE').ToLowerInvariant() -eq 'postgres' -or (ConfiguredAny -Names @('KNOWLEDGE_DB_URL', 'DATABASE_URL', 'POSTGRES_URL', 'POSTGRES_CONNECTION_STRING', 'POSTGRES_JDBC_URL', 'POSTGRES_URI', 'POSTGRES_HOST'))) { 'POSTGRES CONFIGURED' } else { 'SQLITE DEFAULT' }
Show-Status -Label 'DATABASE' -State $dbState
$redisMode = (Get-EnvValue -Name 'YUYOUZHICE_REVOKE_STORE').ToLowerInvariant()
$redisConfigured = $redisMode -eq 'redis' -and (ConfiguredAny -Names @('YUYOUZHICE_REDIS_URL', 'YUYOUZHICE_REDIS_HOST', 'REDIS_HOST'))
Show-Status -Label 'REDIS' -State $(if ($redisMode -ne 'redis') { 'DISABLED' } elseif ($redisConfigured) { 'CONFIGURED' } else { 'REQUESTED / MISSING' })
$adminMode = (Get-EnvValue -Name 'ADMIN_BOOTSTRAP_MODE').ToLowerInvariant()
Show-Status -Label 'ADMIN BOOTSTRAP' -State $(if ([string]::IsNullOrWhiteSpace($adminMode) -or $adminMode -eq 'disabled') { 'DISABLED' } elseif ((ConfiguredAny -Names @('ADMIN_BOOTSTRAP_USERNAME', 'ADMIN_BOOTSTRAP_PASSWORD'))) { 'CONFIGURED' } else { 'REQUESTED / MISSING' })

if (-not ($jwtReady -and $authReady)) {
    Write-Host ''
    Write-Host 'Core authentication configuration is incomplete; Java and Node were not started.'
    exit 1
}

$javaStarted = $false
$nodeStarted = $false
if ((Test-Path -LiteralPath $JavaRoot) -and (Test-Path -LiteralPath (Join-Path $JavaRoot 'mvnw.cmd'))) {
    if (Wait-ForPort -Port 8080 -TimeoutSeconds 1) {
        Write-Host 'Java Core Backend :8080     ALREADY READY (reuse existing process)'
    } else {
        Start-Process -FilePath (Join-Path $JavaRoot 'mvnw.cmd') -ArgumentList @('spring-boot:run') -WorkingDirectory $JavaRoot -RedirectStandardOutput $JavaLog -RedirectStandardError $JavaErrorLog -WindowStyle Hidden | Out-Null
    }
    $javaStarted = $true
}
if (Test-Path -LiteralPath (Join-Path $Root 'server\index.mjs')) {
    if (Wait-ForPort -Port 3000 -TimeoutSeconds 1) {
        Write-Host 'Web BFF :3000               ALREADY READY (reuse existing process)'
    } else {
        # Java has already received its full canonical environment. Reduce the
        # parent environment before creating Node so the BFF inherits only its
        # explicit runtime allowlist; no temporary secret file is created.
        Apply-NodeEnvironment -Values $nodeEnvironment
        Write-Host 'Node BFF environment: allowlist only (values are never printed)'
        Start-Process -FilePath 'node.exe' -ArgumentList @('server/index.mjs') -WorkingDirectory $Root -RedirectStandardOutput $NodeLog -RedirectStandardError $NodeErrorLog -WindowStyle Hidden | Out-Null
    }
    $nodeStarted = $true
}

$javaReady = $javaStarted -and (Wait-ForPort -Port 8080 -TimeoutSeconds 180)
$nodeReady = $nodeStarted -and (Wait-ForPort -Port 3000 -TimeoutSeconds 45)

Write-Host ''
Write-Host ('Java Core Backend :8080     ' + $(if ($javaReady) { 'READY' } else { 'FAILED' }))
Write-Host ('Web BFF :3000               ' + $(if ($nodeReady) { 'READY' } else { 'FAILED' }))

if (-not $NoBrowser -and $nodeReady) {
    Start-Process 'http://localhost:3000'
}
if (-not ($javaReady -and $nodeReady)) { exit 1 }
