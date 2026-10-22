# Fallback static file server built on System.Net.Sockets.TcpListener.
# Used when HttpListener cannot bind without elevation.
param(
    [int]$Port = 4173,
    [string]$Root = $PSScriptRoot
)

$ErrorActionPreference = 'Stop'
$listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $Port)
$listener.Start()
Write-Host "Serving $Root at http://localhost:$Port/  (Ctrl+C to stop)"

$mime = @{
    '.html' = 'text/html; charset=utf-8'
    '.css'  = 'text/css; charset=utf-8'
    '.js'   = 'text/javascript; charset=utf-8'
    '.mjs'  = 'text/javascript; charset=utf-8'
    '.json' = 'application/json; charset=utf-8'
    '.svg'  = 'image/svg+xml'
    '.png'  = 'image/png'
    '.jpg'  = 'image/jpeg'
    '.jpeg' = 'image/jpeg'
    '.webp' = 'image/webp'
    '.ico'  = 'image/x-icon'
    '.woff' = 'font/woff'
    '.woff2'= 'font/woff2'
    '.txt'  = 'text/plain; charset=utf-8'
}

$client = New-Object System.Net.Sockets.TcpClient

while ($true) {
    $client = $listener.AcceptTcpClient()
    $stream = $client.GetStream()
    $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::ASCII, $false, 1024, $true)

    $requestLine = $reader.ReadLine()
    if (-not $requestLine) { $client.Close(); continue }

    $parts  = $requestLine.Split(' ')
    $method = $parts[0]
    $path   = $parts[1]
    while ($reader.ReadLine()) { }

    $relative = [System.Uri]::UnescapeDataString(($path -split '\?')[0])
    if ($relative.EndsWith('/')) { $relative += 'index.html' }

    $target = Join-Path $Root $relative.TrimStart('/').Replace('/', '\')
    $full   = [System.IO.Path]::GetFullPath($target)
    $base   = [System.IO.Path]::GetFullPath($Root)

    $status = '200 OK'
    $ctype  = 'application/octet-stream'
    $bytes  = [byte[]]@()

    if (-not $full.StartsWith($base, [System.StringComparison]::OrdinalIgnoreCase)) {
        $status = '403 Forbidden'
    } elseif (-not (Test-Path -LiteralPath $full -PathType Leaf)) {
        $status = '404 Not Found'
        $bytes  = [System.Text.Encoding]::UTF8.GetBytes('404 Not Found')
        $ctype  = 'text/plain; charset=utf-8'
    } else {
        $ext = [System.IO.Path]::GetExtension($full).ToLowerInvariant()
        if ($mime.ContainsKey($ext)) { $ctype = $mime[$ext] }
        $bytes = [System.IO.File]::ReadAllBytes($full)
    }

    $header = "HTTP/1.1 $status`r`nContent-Type: $ctype`r`nContent-Length: $($bytes.Length)`r`nCache-Control: no-store`r`nConnection: close`r`n`r`n"
    $headBytes = [System.Text.Encoding]::ASCII.GetBytes($header)
    $stream.Write($headBytes, 0, $headBytes.Length)
    if ($bytes.Length -gt 0) { $stream.Write($bytes, 0, $bytes.Length) }
    $stream.Flush()
    $client.Close()
}
