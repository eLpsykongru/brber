# Daily copy of the live database while the project is on Supabase Free, which keeps no backups.
# Run: npm run backup. Needs the PostgreSQL 17 command line tools, and SUPABASE_DB_URL in .env
# (Dashboard > Connect > Session pooler; the direct host is IPv6-only on Free).
# ponytail: database only. Photos live in Storage and are not copied: they can be re-uploaded, the ledger can't.
# Restore into a fresh project (enable the same extensions first):
#   pg_restore --no-owner -n public -d <url> <file>
#   pg_restore --no-owner --data-only -n auth -t users -t identities -d <url> <file>
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot

$line = Select-String -Path "$root\.env" -Pattern '^SUPABASE_DB_URL=(.+)$'
if (-not $line) { throw 'Add SUPABASE_DB_URL to .env (see .env.example)' }
$url = $line.Matches[0].Groups[1].Value.Trim().Trim('"')

# Neither the EDB installer nor the unzipped binaries put pg_dump on PATH.
$pgDump = (Get-Command pg_dump -ErrorAction SilentlyContinue).Source
if (-not $pgDump) {
  $pgDump = Get-ChildItem 'C:\Program Files\PostgreSQL\*\bin\pg_dump.exe', "$env:LOCALAPPDATA\Programs\PostgreSQL\*\bin\pg_dump.exe" -ErrorAction SilentlyContinue |
    Sort-Object { $_.Directory.Parent.Name -as [int] } | Select-Object -Last 1 -ExpandProperty FullName
}
if (-not $pgDump) { throw 'pg_dump not found: install the PostgreSQL 17 command line tools' }

$dir = New-Item -ItemType Directory -Force "$root\backups"
$file = Join-Path $dir "sterncut-$(Get-Date -Format yyyy-MM-dd).dump"

# Sessions and tokens are skipped: secrets nobody needs back, everyone just signs in again.
& $pgDump $url --format=custom --schema=public --schema=auth `
  --exclude-table-data 'auth.(sessions|refresh_tokens|flow_state|one_time_tokens|audit_log_entries)' `
  "--file=$file.part"
if ($LASTEXITCODE -ne 0) {
  Remove-Item "$file.part" -ErrorAction SilentlyContinue
  throw "pg_dump failed (exit $LASTEXITCODE): nothing was saved"
}
Move-Item -Force "$file.part" $file

# Keep the last 30.
Get-ChildItem "$dir\sterncut-*.dump" | Sort-Object Name -Descending | Select-Object -Skip 30 | Remove-Item
"Saved $file ($([math]::Ceiling((Get-Item $file).Length / 1KB)) KB)"
