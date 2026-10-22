# Minimal dependency-free static file server for the PDF tools app.
#
# Starting the app never fails:
#   1. it binds the requested port, walking forward to the next free one;
#   2. HttpListener is preferred, with a raw-socket fallback on every port;
#   3. if the requested port already serves this app, it reports the address
#      and exits instead of failing on a busy port;
#   4. as a last resort Windows is asked to assign any free port.
#
# Usage:  powershell -ExecutionPolicy Bypass -File .\serve.ps1 [-Port 4173]

param(
    [int]$Port = 4173,
    [string]$Root = $PSScriptRoot,
    [int]$Attempts = 40,
    [switch]$ForceTcp
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $Root -PathType Container)) {
    $Root = $PSScriptRoot
}
$Root = (Resolve-Path -LiteralPath $Root).Path

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
    '.gif'  = 'image/gif'
    '.ico'  = 'image/x-icon'
    '.woff' = 'font/woff'
    '.woff2'= 'font/woff2'
    '.ttf'  = 'font/ttf'
    '.txt'  = 'text/plain; charset=utf-8'
    '.map'  = 'application/json; charset=utf-8'
    '.wasm' = 'application/wasm'
}

# Does this port already serve our app? Probes are slow for closed ports, so
# this is only called after a bind attempt has already failed.
function Test-AppAt {
    param([int]$Candidate)
    try {
        $response = Invoke-WebRequest -Uri "http://localhost:$Candidate/" -UseBasicParsing -TimeoutSec 2
        return ($response.StatusCode -eq 200 -and $response.Content -match 'PDF Tools')
    } catch {
        return $false
    }
}

# Try HttpListener first (proper HTTP semantics), then a raw socket.
function Try-Bind {
    param([int]$Candidate)

    if (-not $ForceTcp) {
        try {
            $http = New-Object System.Net.HttpListener
            $http.Prefixes.Add("http://localhost:$Candidate/")
            $http.Start()
            return @{ Listener = $http; Mode = 'http' }
        } catch {
            if ($http) { try { $http.Close() } catch { } }
        }
    }

    try {
        $tcp = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $Candidate)
        $tcp.Start()
        return @{ Listener = $tcp; Mode = 'tcp' }
    } catch {
        if ($tcp) { try { $tcp.Stop() } catch { } }
    }

    return $null
}

$listener = $null
$servePort = $null
$mode = $null

$bound = Try-Bind $Port
if ($bound) {
    $listener = $bound.Listener
    $mode = $bound.Mode
    $servePort = $Port
} else {
    # The requested port is taken. If it is already serving this app, say so.
    if (Test-AppAt $Port) {
        Write-Host "PDF Tools is already running at http://localhost:$Port/" -ForegroundColor Green
        return
    }

    for ($offset = 1; $offset -le $Attempts; $offset++) {
        $candidate = $Port + $offset
        $bound = Try-Bind $candidate
        if ($bound) {
            $listener = $bound.Listener
            $mode = $bound.Mode
            $servePort = $candidate
            break
        }
    }
}

if (-not $listener) {
    # Last resort: let Windows pick any free port.
    try {
        $tcp = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, 0)
        $tcp.Start()
        $listener = $tcp
        $mode = 'tcp'
        $servePort = $tcp.LocalEndpoint.Port
    } catch {
        Write-Host "Could not open a listening socket on any port." -ForegroundColor Red
        Write-Host "Close whatever is using the ports, or pass a different -Port value." -ForegroundColor Red
        return
    }
}

$url = "http://localhost:$servePort/"
Write-Host "Serving $Root at $url  (Ctrl+C to stop)" -ForegroundColor Green
Write-Host "Open $url in your browser." -ForegroundColor Gray

if ($mode -eq 'http') {
    while ($listener.IsListening) {
        try {
            $context = $listener.GetContext()
        } catch {
            break
        }

        try {
            $request  = $context.Request
            $response = $context.Response
            $relative = [System.Uri]::UnescapeDataString($request.Url.AbsolutePath)
            if ($relative.EndsWith('/')) { $relative += 'index.html' }

            $target = Join-Path $Root $relative.TrimStart('/').Replace('/', '\')
            $full   = [System.IO.Path]::GetFullPath($target)
            $base   = [System.IO.Path]::GetFullPath($Root)

            if (-not $full.StartsWith($base, [System.StringComparison]::OrdinalIgnoreCase)) {
                $response.StatusCode = 403
                $response.Close()
                continue
            }

            if (-not (Test-Path -LiteralPath $full -PathType Leaf)) {
                $response.StatusCode = 404
                $response.ContentType = 'text/plain; charset=utf-8'
                $bytes = [System.Text.Encoding]::UTF8.GetBytes('404 Not Found')
                $response.ContentLength64 = $bytes.Length
                $response.OutputStream.Write($bytes, 0, $bytes.Length)
                $response.Close()
                continue
            }

            $ext = [System.IO.Path]::GetExtension($full).ToLowerInvariant()
            if ($mime.ContainsKey($ext)) { $response.ContentType = $mime[$ext] }
            $response.AddHeader('Cache-Control', 'no-store')

            $bytes = [System.IO.File]::ReadAllBytes($full)
            $response.ContentLength64 = $bytes.Length
            if ($request.HttpMethod -ne 'HEAD') {
                $response.OutputStream.Write($bytes, 0, $bytes.Length)
            }
            $response.Close()
        } catch {
            try { $context.Response.Close() } catch { }
        }
    }

    $listener.Stop()
    return
}

while ($true) {
    $client = $null
    try {
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
        if ($bytes.Length -gt 0 -and $method -ne 'HEAD') {
            $stream.Write($bytes, 0, $bytes.Length)
        }
        $stream.Flush()
        $client.Close()
    } catch {
        if ($client) { try { $client.Close() } catch { } }
    }
}
