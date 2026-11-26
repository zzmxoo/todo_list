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
$page = $targets | Where-Object { $_.type -eq "page" -and $_.url -match 'index\.html' } | Select-Object -First 1
if (-not $page) { $page = $targets | Where-Object { $_.type -eq "page" } | Select-Object -First 1 }
if (-not $page) { throw "no CDP page target" }

# 所有等待都要有上限：页面卡死时不能永久挂起，否则用户强杀会留下
# 未清理的回归备份，下一次运行又会被备份守卫拦下。
$connectTimeoutMs = 10000
# 整个 UI 回归在一个 Runtime.evaluate 里执行，正常需要 2-3 分钟；
# 超时只用于兜底页面卡死，不能短到把正常回归掐断。
$receiveTimeoutMs = 300000
$overallDeadline = (Get-Date).AddSeconds(600)

$ws = New-Object System.Net.WebSockets.ClientWebSocket
$ct = [System.Threading.CancellationToken]::None
try {
  if (-not $ws.ConnectAsync([Uri]$page.webSocketDebuggerUrl, $ct).Wait($connectTimeoutMs)) {
    throw "CDP connect timeout after ${connectTimeoutMs}ms"
  }

  function Send-Payload([string]$json) {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    $seg = New-Object System.ArraySegment[byte] -ArgumentList @(,$bytes)
    if (-not $ws.SendAsync($seg, [System.Net.WebSockets.WebSocketMessageType]::Text, $true, $ct).Wait($connectTimeoutMs)) {
      throw "CDP send timeout after ${connectTimeoutMs}ms"
    }
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
    if ((Get-Date) -gt $overallDeadline) { throw "CDP overall timeout (600s)" }
    $sb = New-Object System.Text.StringBuilder
    do {
      if ((Get-Date) -gt $overallDeadline) { throw "CDP overall timeout (600s)" }
      $seg = New-Object System.ArraySegment[byte] -ArgumentList @(,$buffer)
      $task = $ws.ReceiveAsync($seg, $ct)
      if (-not $task.Wait($receiveTimeoutMs)) {
        throw "CDP receive timeout after ${receiveTimeoutMs}ms"
      }
      $result = $task.Result
      $sb.Append([System.Text.Encoding]::UTF8.GetString($buffer, 0, $result.Count)) | Out-Null
    } while (-not $result.EndOfMessage)
    $text = $sb.ToString()
    $obj = $text | ConvertFrom-Json
    if ($obj.id -eq 1) { $text; break }
  }
}
finally {
  $ws.Dispose()
}
