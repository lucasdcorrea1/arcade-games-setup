# Writes a gzipped Raspberry Pi image to a removable disk, then puts SSH + Wi-Fi on its boot partition.
# Started elevated by setup.js (UAC). Progress and the result go to job.statusFile as JSON.
param([Parameter(Mandatory = $true)][string]$JobFile)
$ErrorActionPreference = 'Stop'
$job = Get-Content -Raw -LiteralPath $JobFile | ConvertFrom-Json

function Write-Status($o) {
    ($o | ConvertTo-Json -Compress) | Set-Content -LiteralPath $job.statusFile -Encoding UTF8
}

# .NET Framework's FileStream refuses "\\.\PhysicalDriveN" paths; open the raw disk with CreateFile instead.
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class RawDisk {
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern SafeFileHandle CreateFile(string name, int access, int share, IntPtr security,
        int disposition, int flags, IntPtr template);
}
'@

try {
    $n = [int]$job.disk.number

    # --- the disk must still be the removable card the user picked
    $disk = Get-Disk -Number $n
    $media = [string](Get-CimInstance Win32_DiskDrive | Where-Object { [int]$_.Index -eq $n }).MediaType
    $removable = ([string]$disk.BusType -in 'USB', 'SD', 'MMC') -or ($media -like '*Removable*')
    if ($disk.IsBoot -or $disk.IsSystem -or -not $removable) {
        throw 'Esse disco não é um cartão de memória ou pendrive. Nada foi apagado.'
    }
    if ([int64]$disk.Size -ne [int64]$job.disk.size -or [string]$disk.FriendlyName -ne [string]$job.disk.name) {
        throw 'O cartão mudou desde que foi escolhido. Escolha de novo.'
    }
    if ([int64]$job.imageBytes -gt [int64]$disk.Size) {
        throw 'Esse cartão é pequeno demais para o RetroPie (use um de 8 GB ou mais).'
    }

    # --- erase: no partitions left means Windows has nothing mounted on the card while we write
    Write-Status @{ phase = 'prepare'; msg = 'Apagando o cartão…' }
    $dp = Join-Path (Split-Path $JobFile) 'clean.txt'
    "select disk $n`r`nclean`r`nrescan`r`n" | Set-Content -LiteralPath $dp -Encoding ASCII
    diskpart /s $dp | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'O Windows não deixou apagar o cartão. Ele está protegido contra gravação (trava lateral)?' }

    # --- write. The first block holds the partition table: writing it LAST keeps Windows from
    #     mounting the card halfway through (which would block the rest of the writes).
    $total = [int64]$job.imageBytes
    $block = 4MB
    $src = [IO.File]::OpenRead($job.image)
    $gz = New-Object IO.Compression.GZipStream($src, [IO.Compression.CompressionMode]::Decompress)
    # GENERIC_READ|GENERIC_WRITE, share read+write, OPEN_EXISTING, FILE_FLAG_WRITE_THROUGH
    $handle = [RawDisk]::CreateFile("\\.\PhysicalDrive$n", 0xC0000000, 3, [IntPtr]::Zero, 3, 0x80000000, [IntPtr]::Zero)
    if ($handle.IsInvalid) { throw "O Windows não liberou o cartão para gravação (erro $([Runtime.InteropServices.Marshal]::GetLastWin32Error()))." }
    $dst = New-Object IO.FileStream($handle, [IO.FileAccess]::ReadWrite, 4096)
    $first = $null
    $buf = New-Object byte[] $block
    $done = [int64]0
    $last = [DateTime]::MinValue
    while ($true) {
        $got = 0
        while ($got -lt $block) {
            $r = $gz.Read($buf, $got, $block - $got)
            if ($r -le 0) { break }
            $got += $r
        }
        if ($got -eq 0) { break }
        if ($got % 512) { $pad = 512 - ($got % 512); [Array]::Clear($buf, $got, $pad); $got += $pad }
        if ($null -eq $first) {
            $first = New-Object byte[] $got
            [Array]::Copy($buf, $first, $got)
            $dst.Seek($got, [IO.SeekOrigin]::Begin) | Out-Null
        } else {
            $dst.Write($buf, 0, $got)
        }
        $done += $got
        if (([DateTime]::Now - $last).TotalMilliseconds -ge 700) {
            Write-Status @{ phase = 'write'; done = $done; total = $total }
            $last = [DateTime]::Now
        }
        if ($got -lt $block) { break }
    }
    $dst.Seek(0, [IO.SeekOrigin]::Begin) | Out-Null
    $dst.Write($first, 0, $first.Length)
    $dst.Flush()
    $dst.Close(); $gz.Close(); $src.Close()

    # --- boot partition: SSH on, Wi-Fi from this PC
    Write-Status @{ phase = 'boot'; msg = 'Configurando Wi-Fi e acesso remoto…' }
    $boot = $null
    for ($i = 0; $i -lt 30 -and -not $boot; $i++) {
        Update-HostStorageCache
        $boot = Get-Partition -DiskNumber $n -ErrorAction SilentlyContinue | Sort-Object Offset | Select-Object -First 1
        if (-not $boot) { Start-Sleep -Seconds 1 }
    }
    if (-not $boot) { throw 'Gravei o cartão, mas o Windows não encontrou a partição de inicialização. Tire e coloque o cartão de novo e tente outra vez.' }
    if (-not $boot.DriveLetter -or $boot.DriveLetter -eq [char]0) {
        Add-PartitionAccessPath -DiskNumber $n -PartitionNumber $boot.PartitionNumber -AssignDriveLetter
        Start-Sleep -Seconds 2
        $boot = Get-Partition -DiskNumber $n -PartitionNumber $boot.PartitionNumber
    }
    $root = "$($boot.DriveLetter):\"
    $noBom = New-Object Text.UTF8Encoding($false)
    [IO.File]::WriteAllText((Join-Path $root 'ssh'), '', $noBom)
    if ($job.wpa) { [IO.File]::WriteAllText((Join-Path $root 'wpa_supplicant.conf'), [string]$job.wpa, $noBom) }

    Write-Status @{ phase = 'done'; drive = [string]$boot.DriveLetter }
} catch {
    Write-Status @{ phase = 'error'; msg = $_.Exception.Message }
    exit 1
}
