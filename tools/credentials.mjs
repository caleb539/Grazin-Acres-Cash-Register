// Windows Credential Manager access (generic credentials) via PowerShell +
// advapi32. No extra installs. Secrets are passed over stdout/stdin pipes
// only, never in command-line arguments.

import { spawnSync } from 'node:child_process';

const CRED_CS = `
using System; using System.Runtime.InteropServices; using System.Text;
public static class GACred {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct CREDENTIAL {
    public int Flags; public int Type; public string TargetName; public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public int CredentialBlobSize; public IntPtr CredentialBlob; public int Persist;
    public int AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName;
  }
  [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool CredReadW(string t, int type, int flags, out IntPtr c);
  [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool CredWriteW(ref CREDENTIAL c, int flags);
  [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool CredDeleteW(string t, int type, int flags);
  [DllImport("advapi32.dll")] static extern void CredFree(IntPtr p);
  public static string Read(string t) {
    IntPtr p; if (!CredReadW(t, 1, 0, out p)) return null;
    try { var c = (CREDENTIAL)Marshal.PtrToStructure(p, typeof(CREDENTIAL)); return Marshal.PtrToStringUni(c.CredentialBlob, c.CredentialBlobSize / 2); }
    finally { CredFree(p); }
  }
  public static void Write(string t, string user, string secret) {
    var b = Encoding.Unicode.GetBytes(secret);
    var c = new CREDENTIAL(); c.Type = 1; c.TargetName = t; c.UserName = user; c.Persist = 2;
    c.CredentialBlobSize = b.Length; c.CredentialBlob = Marshal.AllocHGlobal(b.Length);
    try { Marshal.Copy(b, 0, c.CredentialBlob, b.Length); if (!CredWriteW(ref c, 0)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error()); }
    finally { Marshal.FreeHGlobal(c.CredentialBlob); }
  }
  public static bool Delete(string t) { return CredDeleteW(t, 1, 0); }
}`;

const quote = (s) => `'${String(s).replace(/'/g, "''")}'`;

function powershell(script, { interactive = false } = {}) {
  if (process.platform !== 'win32') throw new Error('Windows Credential Manager is only available on Windows.');
  const full = `$ErrorActionPreference = 'Stop'\nAdd-Type -TypeDefinition @'\n${CRED_CS}\n'@\n${script}`;
  const encoded = Buffer.from(full, 'utf16le').toString('base64');
  // -NonInteractive would make Read-Host fail, so only use it for background reads.
  const flags = interactive ? ['-NoProfile'] : ['-NoProfile', '-NonInteractive'];
  return spawnSync('powershell.exe', [...flags, '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
    encoding: 'utf8',
    stdio: interactive ? ['inherit', 'inherit', 'inherit'] : ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
}

/** Returns the stored secret, or null if there is none. */
export function readSecret(target) {
  const r = powershell(`$k = [GACred]::Read(${quote(target)}); if ($k) { [Console]::Out.Write($k) } else { exit 3 }`);
  if (r.status === 3) return null;
  if (r.status !== 0) throw new Error(`Could not read Windows Credential Manager: ${(r.stderr || '').trim().split('\n')[0]}`);
  return r.stdout.trim();
}

/** Prompts the person at the keyboard (input hidden) and stores the result. Returns true if stored. */
export function promptAndStoreSecret(target, label) {
  const r = powershell(
    `$s = Read-Host -AsSecureString ${quote(label)}\n` +
    `$k = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)).Trim()\n` +
    `if (-not $k) { Write-Error 'Nothing entered' }\n` +
    `[GACred]::Write(${quote(target)}, 'register', $k)\nWrite-Host 'Stored in Windows Credential Manager.'`,
    { interactive: true },
  );
  return r.status === 0;
}

export function deleteSecret(target) {
  const r = powershell(`if ([GACred]::Delete(${quote(target)})) { 'deleted' } else { 'none' }`);
  return (r.stdout || '').trim() === 'deleted';
}
