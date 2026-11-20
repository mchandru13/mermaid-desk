param(
  [Parameter(Mandatory = $true)][string]$ItemText,
  [string]$WindowTitleContains = "MermaidDesk"
)

# Posts WM_COMMAND for a native menu item (matched by label) to the Tauri window.
# Used to verify that menu items reach the same handlers as keyboard shortcuts.

$signature = @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class Menu32 {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr p);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetMenu(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern int GetMenuItemCount(IntPtr hMenu);
  [DllImport("user32.dll")] public static extern IntPtr GetSubMenu(IntPtr hMenu, int nPos);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern int GetMenuString(IntPtr hMenu, uint item, StringBuilder text, int max, uint flags);
  [DllImport("user32.dll")] public static extern uint GetMenuItemID(IntPtr hMenu, int nPos);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
  public const uint MF_BYPOSITION = 0x00000400;
  public const uint WM_COMMAND = 0x0111;
}
'@
if (-not ("Menu32" -as [type])) { Add-Type -TypeDefinition $signature }

$script:target = [IntPtr]::Zero
$callback = [Menu32+EnumWindowsProc]{
  param($hWnd, $lParam)
  if ([Menu32]::IsWindowVisible($hWnd)) {
    $title = New-Object System.Text.StringBuilder 512
    [void][Menu32]::GetWindowText($hWnd, $title, 512)
    $class = New-Object System.Text.StringBuilder 128
    [void][Menu32]::GetClassName($hWnd, $class, 128)
    if ($title.ToString() -like "*$WindowTitleContains*" -and $class.ToString() -eq "Tauri Window") {
      $script:target = $hWnd
      return $false
    }
  }
  return $true
}
[void][Menu32]::EnumWindows($callback, [IntPtr]::Zero)

if ($script:target -eq [IntPtr]::Zero) { Write-Output "window not found"; exit 1 }

$menu = [Menu32]::GetMenu($script:target)
if ($menu -eq [IntPtr]::Zero) { Write-Output "menu not found"; exit 1 }

$script:foundId = -1
$script:foundLabel = ""

function Search-Menu([IntPtr]$handle, [int]$depth) {
  if ($depth -gt 3 -or $script:foundId -ge 0) { return }
  $count = [Menu32]::GetMenuItemCount($handle)
  for ($i = 0; $i -lt $count; $i++) {
    $buffer = New-Object System.Text.StringBuilder 256
    [void][Menu32]::GetMenuString($handle, [uint32]$i, $buffer, 256, [Menu32]::MF_BYPOSITION)
    $label = $buffer.ToString()
    if ($label -like "*$ItemText*" -and $script:foundId -lt 0) {
      $id = [Menu32]::GetMenuItemID($handle, $i)
      if ($id -ne 0xFFFFFFFF -and $id -ne 0) {
        $script:foundId = [int64]$id
        $script:foundLabel = $label
        return
      }
    }
    $sub = [Menu32]::GetSubMenu($handle, $i)
    if ($sub -ne [IntPtr]::Zero) { Search-Menu $sub ($depth + 1) }
  }
}

Search-Menu $menu 0
if ($script:foundId -lt 0) { Write-Output "item not found"; exit 1 }

Write-Output "invoking '$($script:foundLabel)'"
[void][Menu32]::PostMessage($script:target, [Menu32]::WM_COMMAND, [IntPtr]$script:foundId, [IntPtr]::Zero)
Start-Sleep -Milliseconds 900
Write-Output "invoked"
