# Minimal dependency-free static file server for the PDF tools app.
# Usage:  powershell -ExecutionPolicy Bypass -File .\serve.ps1 [-Port 4173]
param(
    [int]$Port = 4173,
    [string]$Root = $PSScriptRoot
)

$ErrorActionPreference = 'Stop'
$listener = New-Object System.Net.HttpListener
$prefix = "http://localhost:$Port/"
$listener.Prefixes.Add($prefix)

try {
    $listener.Start()
} catch {
    Write-Host "HttpListener failed ($($_.Exception.Message)); falling back to TcpListener."
    . (Join-Path $PSScriptRoot 'serve-tcp.ps1')
    return
}

Write-Host "Serving $Root at $prefix  (Ctrl+C to stop)"

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
    '.map'  = 'application/json; charset=utf-8'
}

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
        $response.OutputStream.Write($bytes, 0, $bytes.Length)
        $response.Close()
    } catch {
        try { $context.Response.Close() } catch { }
    }
}

$listener.Stop()
