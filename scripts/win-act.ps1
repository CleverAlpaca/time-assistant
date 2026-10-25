param([string]$ProcName = "electron", [int]$ProcId = 0)
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class W {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, UIntPtr e);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
}
'@
$proc = if ($ProcId -gt 0) { Get-Process -Id $ProcId } else { Get-Process $ProcName -ErrorAction Stop | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1 }
if (-not $proc) { Write-Output "NO_PROC"; exit 1 }
$h = $proc.MainWindowHandle
# ALT 键技巧：先按一下 ALT 使 SetForegroundWindow 被允许
[W]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)
[W]::SetForegroundWindow($h) | Out-Null
[W]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 500
$r = New-Object W+RECT
[W]::GetWindowRect($h, [ref]$r) | Out-Null
Write-Output "rect: $($r.L),$($r.T),$($r.R),$($r.B)"
