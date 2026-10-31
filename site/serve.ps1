$root = $PSScriptRoot
$l = New-Object System.Net.HttpListener
$l.Prefixes.Add("http://localhost:8765/")
$l.Start()
Write-Output "Serving $root on http://localhost:8765/"
$types = @{ ".html"="text/html; charset=utf-8"; ".webp"="image/webp"; ".js"="text/javascript"; ".css"="text/css" }
while ($l.IsListening) {
  $c = $l.GetContext()
  $p = $c.Request.Url.AbsolutePath.TrimStart('/')
  if ($p -eq "") { $p = "index.html" }
  $f = Join-Path $root $p
  if (Test-Path $f -PathType Leaf) {
    $b = [IO.File]::ReadAllBytes($f)
    $ext = [IO.Path]::GetExtension($f)
    if ($types.ContainsKey($ext)) { $c.Response.ContentType = $types[$ext] }
    $c.Response.OutputStream.Write($b, 0, $b.Length)
  } else { $c.Response.StatusCode = 404 }
  $c.Response.Close()
}

