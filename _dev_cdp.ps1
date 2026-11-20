param(
  [string]$Expr,
  [string]$ExprFile = "",
  [string]$Method = "",
  [string]$ParamsJson = "{}",
  [string]$ParamsFile = "",
  [int]$Port = 9222
)
$ErrorActionPreference = "Stop"
if ($ExprFile) { $Expr = Get-Content $ExprFile -Raw -Encoding UTF8 }
if ($ParamsFile) { $ParamsJson = Get-Content $ParamsFile -Raw -Encoding UTF8 }
$targets = Invoke-RestMethod "http://127.0.0.1:$Port/json"
$page = $targets | Where-Object { $_.type -eq "page" } | Select-Object -First 1
if (-not $page) { throw "no CDP page target" }
$ws = New-Object System.Net.WebSockets.ClientWebSocket
$ct = [System.Threading.CancellationToken]::None
$ws.ConnectAsync([Uri]$page.webSocketDebuggerUrl, $ct).Wait()

function Send-Payload([string]$json) {
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
  $seg = New-Object System.ArraySegment[byte] -ArgumentList @(,$bytes)
  $ws.SendAsync($seg, [System.Net.WebSockets.WebSocketMessageType]::Text, $true, $ct).Wait()
}

if ($Method) {
  $params = $ParamsJson | ConvertFrom-Json
  $payload = @{ id = 1; method = $Method; params = $params } | ConvertTo-Json -Depth 12 -Compress
} else {
  $payload = @{ id = 1; method = "Runtime.evaluate"; params = @{ expression = $Expr; returnByValue = $true; awaitPromise = $true } } | ConvertTo-Json -Depth 12 -Compress
}
Send-Payload $payload

$buffer = New-Object byte[] 1048576
while ($true) {
  $sb = New-Object System.Text.StringBuilder
  do {
    $seg = New-Object System.ArraySegment[byte] -ArgumentList @(,$buffer)
    $result = $ws.ReceiveAsync($seg, $ct).Result
    $sb.Append([System.Text.Encoding]::UTF8.GetString($buffer, 0, $result.Count)) | Out-Null
  } while (-not $result.EndOfMessage)
  $text = $sb.ToString()
  $obj = $text | ConvertFrom-Json
  if ($obj.id -eq 1) { $text; break }
}
$ws.Dispose()
