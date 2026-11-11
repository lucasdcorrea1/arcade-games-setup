'use strict';

// The volume, as on the cabinet (adz-home.py): SELECT held + S turns it down, SELECT + L up.
// It is Windows' own volume (every sound: the notebook's speakers, a JBL over Bluetooth...): the
// volume keys are pressed for it, so Windows shows its own bar too. One PowerShell stays open and
// presses them, so each step is instant.

const { spawn } = require('child_process');

const STEP_PRESSES = 2;   // each Windows key press is 2%: a step is 4%
let ps = null;

function shell() {
  if (ps && !ps.killed && ps.exitCode === null) return ps;
  const script = `
Add-Type -Namespace Adz -Name Keys -MemberDefinition '[DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, System.UIntPtr extra);'
function Press([byte]$vk, [int]$n) { for ($i = 0; $i -lt $n; $i++) { [Adz.Keys]::keybd_event($vk, 0, 1, [System.UIntPtr]::Zero); [Adz.Keys]::keybd_event($vk, 0, 3, [System.UIntPtr]::Zero) } }
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($line -eq $null) { break }
  if ($line -eq 'down') { Press 0xAE ${STEP_PRESSES} }
  elseif ($line -eq 'up') { Press 0xAF ${STEP_PRESSES} }
  elseif ($line -eq 'mute') { Press 0xAD 1 }
}`;
  ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'] });
  ps.on('exit', () => { ps = null; });
  ps.stdin.on('error', () => { ps = null; });
  return ps;
}

function step(way) {
  if (process.platform !== 'win32') return;
  const p = shell();
  p.stdin.write((way < 0 ? 'down' : way > 0 ? 'up' : 'mute') + '\n');
}

module.exports = { step, warm: () => { if (process.platform === 'win32') shell(); }, stop: () => { if (ps) ps.kill(); } };
