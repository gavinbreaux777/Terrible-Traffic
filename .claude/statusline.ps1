# Claude Code status line: model, cwd, and live context usage.
# Receives session JSON on stdin; reads the transcript to find the most recent
# assistant turn's token usage (input + cache create + cache read = context in use).
$ErrorActionPreference = 'SilentlyContinue'

$raw = [Console]::In.ReadToEnd()
try { $data = $raw | ConvertFrom-Json } catch { Write-Output 'ctx: ?'; return }

$model = $data.model.display_name
if (-not $model) { $model = 'Claude' }

$dir = $data.workspace.current_dir
if (-not $dir) { $dir = $data.cwd }
$leaf = if ($dir) { Split-Path $dir -Leaf } else { '' }

# Walk the transcript backwards for the latest usage block.
$used = $null
$tp = $data.transcript_path
if ($tp -and (Test-Path $tp)) {
  $lines = Get-Content $tp
  for ($i = $lines.Count - 1; $i -ge 0; $i--) {
    if ($lines[$i] -notmatch '"usage"') { continue }
    try { $entry = $lines[$i] | ConvertFrom-Json } catch { continue }
    $u = $entry.message.usage
    if ($null -ne $u -and ($null -ne $u.input_tokens -or $null -ne $u.cache_read_input_tokens)) {
      $used = [int]$u.input_tokens + [int]$u.cache_creation_input_tokens + [int]$u.cache_read_input_tokens
      break
    }
  }
}

$limit = 200000
if ($data.exceeds_200k_tokens -eq $true) { $limit = 1000000 }

if ($null -ne $used) {
  $pct = [math]::Round(($used / $limit) * 100, 1)
  $k = [math]::Round($used / 1000, 1)
  $ctx = "ctx ${k}k/$([math]::Round($limit/1000))k (${pct}%)"
} else {
  $ctx = 'ctx --'
}

Write-Output "$model | $leaf | $ctx"
