# Raw-socket variant of serve.ps1 (no HttpListener / HTTP.sys reservation).
#
# Kept as a separate entry point for people who need to bypass HttpListener.
# All of the port searching and fallback logic lives in serve.ps1.

param(
    [int]$Port = 4173,
    [string]$Root = $PSScriptRoot,
    [int]$Attempts = 40
)

$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'serve.ps1') -Port $Port -Root $Root -Attempts $Attempts -ForceTcp
