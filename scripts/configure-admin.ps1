[CmdletBinding()]
param(
    [string]$JavaRoot = 'D:\scenic-guide\ai'
)

$ErrorActionPreference = 'Stop'
$configPath = Join-Path $JavaRoot '.env'

if (-not (Test-Path -LiteralPath $configPath)) {
    throw "Canonical Java configuration was not found: $configPath"
}

function Convert-SecureStringToPlainText {
    param([System.Security.SecureString]$Value)
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
    try {
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    }
}

$username = (Read-Host '管理员账号（建议使用邮箱）').Trim().ToLowerInvariant()
if ([string]::IsNullOrWhiteSpace($username)) {
    throw '管理员账号不能为空。'
}

$passwordSecure = Read-Host '管理员密码（至少 12 位）' -AsSecureString
$confirmSecure = Read-Host '再次输入管理员密码' -AsSecureString
$password = Convert-SecureStringToPlainText -Value $passwordSecure
$confirmation = Convert-SecureStringToPlainText -Value $confirmSecure

if ($password.Length -lt 12) {
    throw '管理员密码至少需要 12 位。'
}
if ($password -cne $confirmation) {
    throw '两次输入的管理员密码不一致。'
}

$updates = [ordered]@{
    # provision explicitly creates the requested account even when the DB
    # already contains an administrator; it never overwrites an existing user.
    ADMIN_BOOTSTRAP_MODE = 'provision'
    ADMIN_BOOTSTRAP_USERNAME = $username
    ADMIN_BOOTSTRAP_PASSWORD = $password
}
$seen = @{}
$output = [System.Collections.Generic.List[string]]::new()

foreach ($line in [System.IO.File]::ReadAllLines($configPath)) {
    $match = [regex]::Match($line, '^\s*(ADMIN_BOOTSTRAP_MODE|ADMIN_BOOTSTRAP_USERNAME|ADMIN_BOOTSTRAP_PASSWORD)\s*=')
    if ($match.Success) {
        $key = $match.Groups[1].Value
        $output.Add("$key=$($updates[$key])")
        $seen[$key] = $true
    } else {
        $output.Add($line)
    }
}

foreach ($key in $updates.Keys) {
    if (-not $seen.ContainsKey($key)) {
        $output.Add("$key=$($updates[$key])")
    }
}

[System.IO.File]::WriteAllLines($configPath, $output.ToArray(), [System.Text.UTF8Encoding]::new($false))

# Drop plaintext values from the script variables as soon as the file write is complete.
$password = $null
$confirmation = $null

Write-Host "管理员初始化配置已写入服务端文件：$configPath"
Write-Host '请启动 Java Core Backend；首次成功启动后，建议将 ADMIN_BOOTSTRAP_MODE 改回 disabled 并重启。'
Write-Host '凭据不会打印到终端，也不会写入前端。'
