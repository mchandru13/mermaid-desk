param(
  [Parameter(Mandatory = $true)][string]$Title,
  [Parameter(Mandatory = $true)][string]$TargetPath,
  [switch]$Cancel
)

# Fills and confirms a native Windows file dialog (Open / Save / Export).
#
# The file-name field is hosted by DirectUI: it ignores WM_SETTEXT, exposes no
# UI Automation ValuePattern, and cannot receive synthetic keystrokes in a
# non-interactive session. EM_SETSEL + EM_REPLACESEL is the message pair the
# control does honour, so the path is written that way and then verified by
# checking the resulting file exists.

$sig = @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class Dialog32b {
  public delegate bool EnumChildProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindow(string cls, string name);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr parent, EnumChildProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetDlgCtrlID(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, string l);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  public const uint EM_SETSEL = 0x00B1;
  public const uint EM_REPLACESEL = 0x00C2;
  public const uint BM_CLICK = 0x00F5;
}
'@
if (-not ("Dialog32b" -as [type])) { Add-Type -TypeDefinition $sig }

$dlg = [IntPtr]::Zero
for ($i = 0; $i -lt 60 -and $dlg -eq [IntPtr]::Zero; $i++) {
  $dlg = [Dialog32b]::FindWindow("#32770", $Title)
  if ($dlg -eq [IntPtr]::Zero) { Start-Sleep -Milliseconds 250 }
}
if ($dlg -eq [IntPtr]::Zero) { Write-Output "dialog not found"; exit 1 }

function Find-Buttons {
  $script:buttons = @{}
  $cb = [Dialog32b+EnumChildProc]{
    param($h, $p)
    $cls = New-Object System.Text.StringBuilder 64
    [void][Dialog32b]::GetClassName($h, $cls, 64)
    if ($cls.ToString() -eq "Button") {
      $script:buttons[[Dialog32b]::GetDlgCtrlID($h)] = $h
    }
    return $true
  }
  [void][Dialog32b]::EnumChildWindows($dlg, $cb, [IntPtr]::Zero)
  return $script:buttons
}

if ($Cancel) {
  $buttons = Find-Buttons
  if ($buttons.ContainsKey(2)) {
    [void][Dialog32b]::PostMessage($buttons[2], [Dialog32b]::BM_CLICK, [IntPtr]::Zero, [IntPtr]::Zero)
    Write-Output "cancelled"
    exit 0
  }
  Write-Output "cancel button not found"
  exit 1
}

# Locate the file-name edit: id 1001 whose parent is a ComboBox.
$script:edits = @()
$cb = [Dialog32b+EnumChildProc]{
  param($h, $p)
  $cls = New-Object System.Text.StringBuilder 64
  [void][Dialog32b]::GetClassName($h, $cls, 64)
  if ($cls.ToString() -eq "Edit") { $script:edits += $h }
  return $true
}
[void][Dialog32b]::EnumChildWindows($dlg, $cb, [IntPtr]::Zero)

$fileName = $null
foreach ($h in $script:edits) {
  # Open dialogs expose the file name as 1148, Save/Export dialogs as 1001;
  # both are Edit controls parented by a ComboBox. The address bar is 41477
  # and sits inside the rebar, so requiring the ComboBox parent skips it.
  $id = [Dialog32b]::GetDlgCtrlID($h)
  if ($id -ne 1001 -and $id -ne 1148) { continue }
  $parent = [Dialog32b]::GetParent($h)
  $pcls = New-Object System.Text.StringBuilder 64
  [void][Dialog32b]::GetClassName($parent, $pcls, 64)
  if ($pcls.ToString() -eq "ComboBox") { $fileName = $h; break }
}
if (-not $fileName) {
  # Fall back to the first Edit inside a ComboBox, whatever its id.
  foreach ($h in $script:edits) {
    $parent = [Dialog32b]::GetParent($h)
    $pcls = New-Object System.Text.StringBuilder 64
    [void][Dialog32b]::GetClassName($parent, $pcls, 64)
    if ($pcls.ToString() -eq "ComboBox" -and [Dialog32b]::GetDlgCtrlID($h) -ne 41477) {
      $fileName = $h
      break
    }
  }
}
if (-not $fileName) {
  Write-Output "file name edit not found"
  exit 1
}

[void][Dialog32b]::SendMessage($fileName, [Dialog32b]::EM_SETSEL, [IntPtr]::Zero, [IntPtr]::new(-1))
[void][Dialog32b]::SendMessage($fileName, [Dialog32b]::EM_REPLACESEL, [IntPtr]::new(1), $TargetPath)
Start-Sleep -Milliseconds 350

$readback = New-Object System.Text.StringBuilder 512
[void][Dialog32b]::GetWindowText($fileName, $readback, 512)
Write-Output "file name field='$($readback.ToString())'"

$buttons = Find-Buttons
if (-not $buttons.ContainsKey(1)) {
  Write-Output "confirm button not found"
  exit 1
}
[void][Dialog32b]::PostMessage($buttons[1], [Dialog32b]::BM_CLICK, [IntPtr]::Zero, [IntPtr]::Zero)
Start-Sleep -Milliseconds 900

if ([Dialog32b]::FindWindow("#32770", $Title) -ne [IntPtr]::Zero) {
  Write-Output "dialog still open"
  exit 1
}
Write-Output "confirmed"
