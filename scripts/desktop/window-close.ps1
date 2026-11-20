param([string]$WindowTitleContains = "MermaidDesk")

$signature = @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class Close32 {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
  public const uint WM_CLOSE = 0x0010;
}
'@
if (-not ("Close32" -as [type])) { Add-Type -TypeDefinition $signature }

$script:target = [IntPtr]::Zero
$callback = [Close32+EnumWindowsProc]{
  param($hWnd, $lParam)
  if ([Close32]::IsWindowVisible($hWnd)) {
    $title = New-Object System.Text.StringBuilder 512
    [void][Close32]::GetWindowText($hWnd, $title, 512)
    $class = New-Object System.Text.StringBuilder 128
    [void][Close32]::GetClassName($hWnd, $class, 128)
    if ($title.ToString() -like "*$WindowTitleContains*" -and $class.ToString() -eq "Tauri Window") {
      $script:target = $hWnd
      return $false
    }
  }
  return $true
}
[void][Close32]::EnumWindows($callback, [IntPtr]::Zero)

if ($script:target -eq [IntPtr]::Zero) {
  Write-Output "window not found"
  exit 1
}
[void][Close32]::PostMessage($script:target, [Close32]::WM_CLOSE, [IntPtr]::Zero, [IntPtr]::Zero)
Start-Sleep -Milliseconds 500
Write-Output "close requested"
