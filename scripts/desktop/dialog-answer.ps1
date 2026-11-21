param(
  [Parameter(Mandatory = $true)][string]$Title,
  [Parameter(Mandatory = $true)][ValidateSet("Yes", "No", "Cancel")][string]$Button
)

# Answers a native message dialog created by tauri-plugin-dialog / rfd.
#
# rfd renders these as TaskDialogs on modern Windows: the buttons are DirectUI
# elements with no window class and no control id, so the BM_CLICK approach used
# by dialog-fill.ps1 cannot reach them. UI Automation can, and it also lets the
# button be found by its accessible name ("Yes" / "No").

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$sig = @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class Win32b {
  public delegate bool EnumWindowsProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr h, out int pid);
}
'@
if (-not ("Win32b" -as [type])) { Add-Type -TypeDefinition $sig }

function Get-AppPid {
  # Advisory only. The dialog window is the real discriminator (see
  # Find-Window); this is used to fail loudly when the caller named a process
  # that does not own the dialog. Returns 0 when nothing is running.
  if ($env:MERMAIDDESK_PID) {
    $explicit = 0
    if ([int]::TryParse($env:MERMAIDDESK_PID, [ref]$explicit) -and $explicit -gt 0) {
      return $explicit
    }
  }
  $proc = Get-Process -Name "mermaid-desk" -ErrorAction SilentlyContinue |
    Sort-Object StartTime -Descending |
    Select-Object -First 1
  if ($null -ne $proc) { return $proc.Id }
  return 0
}

$appPid = Get-AppPid

function Find-Window {
  # A visible window with this exact title. When a pid is known the window must
  # belong to it too, so a stale instance cannot be mistaken for the app under
  # test. The pid check is a cross-check, not a substitute for matching the
  # window: with the single-instance plugin the dialog always belongs to the
  # process that was already running, which is not necessarily the newest one.
  $script:hit = [IntPtr]::Zero
  $cb = [Win32b+EnumWindowsProc]{
    param($h, $p)
    if (-not [Win32b]::IsWindowVisible($h)) { return $true }
    $b = New-Object System.Text.StringBuilder 512
    [void][Win32b]::GetWindowText($h, $b, 512)
    if ($b.ToString() -ne $Title) { return $true }
    if ($appPid -gt 0) {
      $windowPid = 0
      [void][Win32b]::GetWindowThreadProcessId($h, [ref]$windowPid)
      if ($windowPid -ne $appPid) { return $true }
    }
    $script:hit = $h
    return $false
  }
  [void][Win32b]::EnumWindows($cb, [IntPtr]::Zero)
  return $script:hit
}

$handle = [IntPtr]::Zero
for ($i = 0; $i -lt 60 -and $handle -eq [IntPtr]::Zero; $i++) {
  $handle = Find-Window
  if ($handle -eq [IntPtr]::Zero) { Start-Sleep -Milliseconds 250 }
}
if ($handle -eq [IntPtr]::Zero) { Write-Output "dialog not found"; exit 1 }

$ownerPid = 0
[void][Win32b]::GetWindowThreadProcessId($handle, [ref]$ownerPid)
Write-Output "dialog pid=$ownerPid (app pid=$appPid)"

$root = [System.Windows.Automation.AutomationElement]::FromHandle($handle)
if ($null -eq $root) { Write-Output "no automation element"; exit 1 }

# Report every text node so a mismatched prompt fails loudly.
$all = $root.FindAll(
  [System.Windows.Automation.TreeScope]::Descendants,
  [System.Windows.Automation.Condition]::TrueCondition
)
$texts = @()
foreach ($el in $all) {
  try {
    $n = $el.Current.Name
    if ($n) { $texts += $n }
  } catch { }
}
Write-Output "texts='$($texts -join ' | ')'"

$condition = New-Object System.Windows.Automation.PropertyCondition(
  [System.Windows.Automation.AutomationElement]::NameProperty,
  $Button
)
$target = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)
if ($null -eq $target) {
  Write-Output "button '$Button' not found; saw: $($texts -join ', ')"
  exit 1
}

# These TaskDialog buttons are DirectUI panes with no action pattern at all, so
# the click is sent to their centre in screen coordinates. The window is raised
# first because a synthetic click at a stale position would press whatever moved
# underneath it.
$sigClick = @'
using System;
using System.Runtime.InteropServices;
public static class Click32c {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, int x, int y, uint d, IntPtr e);
  public const uint LEFTDOWN = 0x0002;
  public const uint LEFTUP = 0x0004;
  public const int SW_RESTORE = 9;
}
'@
if (-not ("Click32c" -as [type])) { Add-Type -TypeDefinition $sigClick }

$rect = $target.Current.BoundingRectangle
if ($rect.Width -le 0 -or $rect.Height -le 0) {
  Write-Output "button '$Button' has no clickable rect"
  exit 1
}
$cx = [int]($rect.X + $rect.Width / 2)
$cy = [int]($rect.Y + $rect.Height / 2)

[void][Click32c]::ShowWindow($handle, [Click32c]::SW_RESTORE)
[void][Click32c]::SetForegroundWindow($handle)
Start-Sleep -Milliseconds 250
[void][Click32c]::SetCursorPos($cx, $cy)
Start-Sleep -Milliseconds 120
[Click32c]::mouse_event([Click32c]::LEFTDOWN, 0, 0, 0, [IntPtr]::Zero)
Start-Sleep -Milliseconds 60
[Click32c]::mouse_event([Click32c]::LEFTUP, 0, 0, 0, [IntPtr]::Zero)
Write-Output "clicked '$Button' at $cx,$cy"
Start-Sleep -Milliseconds 900

if ((Find-Window) -ne [IntPtr]::Zero) {
  # A TaskDialog may close asynchronously; give it one more moment.
  Start-Sleep -Milliseconds 900
  if ((Find-Window) -ne [IntPtr]::Zero) {
    Write-Output "dialog still open"
    exit 1
  }
}
Write-Output "answered $Button"
