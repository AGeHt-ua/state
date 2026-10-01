# Збереження секретів сервера в Cloudflare. Запускається з set-secrets.cmd (подвійний клік).
# Значення вводиться у звичайний рядок (Ctrl+V або права кнопка миші); пробіли й переноси по краях відкидаються.
# Секрети передаються через тимчасовий JSON-файл (wrangler secret bulk), який одразу видаляється.
$env:Path = "C:\Program Files\nodejs;" + $env:Path
Set-Location $PSScriptRoot

$items = @(
  @{ Name = "DISCORD_CLIENT_SECRET";  Title = "Client Secret Discord (discord.com/developers -> OAuth2 -> Reset Secret -> Copy)"; Check = '^[A-Za-z0-9_-]{20,64}$' },
  @{ Name = "DISCORD_NOTIFY_WEBHOOK"; Title = "URL вебхука каналу ДОКУМЕНТІВ"; Check = '^https://(discord|discordapp)\.com/api/webhooks/\d+/[A-Za-z0-9_-]+$' },
  @{ Name = "DISCORD_ALERT_WEBHOOK";  Title = "URL вебхука каналу АДМІН-ТРИВОГ"; Check = '^https://(discord|discordapp)\.com/api/webhooks/\d+/[A-Za-z0-9_-]+$' }
)
$secrets = @{}
$i = 0
foreach ($it in $items) {
  $i++
  Write-Host ""
  Write-Host "=== $i/3  $($it.Title)" -ForegroundColor Yellow
  while ($true) {
    $value = (Read-Host "Вставте і натисніть Enter (порожньо - пропустити)").Trim()
    if (-not $value) { Write-Host "Пропущено." -ForegroundColor DarkGray; break }
    if ($value -match $it.Check) { $secrets[$it.Name] = $value; Write-Host ("Прийнято ({0} символів)." -f $value.Length) -ForegroundColor Green; break }
    Write-Host "Не схоже на правильне значення. Скопіюйте ще раз кнопкою Copy і вставте." -ForegroundColor Red
  }
}
if ($secrets.Count -eq 0) { Read-Host "Нічого не введено. Enter - закрити"; exit }

$tmp = Join-Path $env:TEMP ("state-secrets-" + [guid]::NewGuid() + ".json")
try {
  [System.IO.File]::WriteAllText($tmp, ($secrets | ConvertTo-Json -Compress), (New-Object System.Text.UTF8Encoding $false))
  Write-Host ""
  Write-Host "Зберігаю в Cloudflare..." -ForegroundColor Yellow
  npx --yes wrangler@latest secret bulk $tmp
} finally {
  Remove-Item $tmp -Force -ErrorAction SilentlyContinue
}
Write-Host ""
Write-Host "Готово. Напишіть Claude: перевіряй" -ForegroundColor Green
Read-Host "Натисніть Enter, щоб закрити"
