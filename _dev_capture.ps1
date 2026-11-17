param(
  [string]$Out = "D:\Tools\Todos\_shots\tauri.png",
  [int]$Pad = 24
)
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinCapture {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
"@
[WinCapture]::SetProcessDPIAware() | Out-Null
$proc = Get-Process desktop-todo -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $proc) { throw "desktop-todo window not found" }
$rect = New-Object WinCapture+RECT
[WinCapture]::GetWindowRect($proc.MainWindowHandle, [ref]$rect) | Out-Null
$x = [Math]::Max(0, $rect.Left - $Pad)
$y = [Math]::Max(0, $rect.Top - $Pad)
$w = ($rect.Right - $rect.Left) + $Pad * 2
$h = ($rect.Bottom - $rect.Top) + $Pad * 2
$screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$w = [Math]::Min($w, $screen.Width - $x)
$h = [Math]::Min($h, $screen.Height - $y)
$bmp = New-Object System.Drawing.Bitmap($w, $h)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($x, $y, 0, 0, (New-Object System.Drawing.Size($w, $h)))
$g.Dispose()
New-Item -ItemType Directory -Force (Split-Path $Out) | Out-Null
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
"window: $($rect.Left),$($rect.Top) $($rect.Right - $rect.Left)x$($rect.Bottom - $rect.Top) -> $Out"
