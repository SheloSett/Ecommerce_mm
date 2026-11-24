// Imprimir la etiqueta de envío en la térmica con un clic (igual que "Propiedades de impresora →
// Herramientas → Acción → Enviar archivo a impresora", que es lo que se hacía a mano con los .zpl).
//
// El navegador no le puede hablar a la impresora, así que en cada PC se instala una vez un ayudante:
//   - un script de PowerShell en %LOCALAPPDATA%\IGWT\imprimir-etiqueta.ps1, y
//   - el link "igwt-etiqueta:" registrado en Windows para ese usuario (HKCU, sin administrador).
// El botón baja el .zpl a Descargas y abre igwt-etiqueta:imprimir?archivo=<nombre>; Windows corre el
// script, que espera el archivo, controla que sea ZPL, lo manda en crudo (RAW) a la cola de la impresora
// y lo borra. El instalador (.cmd) se arma acá mismo con el script adentro.
import { labelToZpl } from "./zplLabel.js";

export const PROTOCOL = "igwt-etiqueta";
export const DEFAULT_PRINTER = "Colecta y FLEX 10 x15";
// Nombre del atajo en "Enviar a" y en el escritorio (para mandar las etiquetas de Mercado Libre)
export const SHORTCUT_NAME = "Impresora de etiquetas";

// Script que corre en la PC. Dos formas de usarlo:
//   - el link del panel (igwt-etiqueta:imprimir?archivo=<nombre>): toma ese .zpl de Descargas, lo manda y lo borra;
//   - archivos ("Enviar a → Impresora de etiquetas", o arrastrarlos sobre el ícono del escritorio): manda cada
//     uno que sea ZPL (empieza con ^XA), por ejemplo las etiquetas de Mercado Libre, y no los borra.
export const PRINT_SCRIPT = String.raw`# IGWT Store: manda etiquetas ZPL a la impresora térmica.
# - Link del panel: igwt-etiqueta:imprimir?archivo=<nombre> (toma ese .zpl de Descargas y lo borra).
# - Archivos: "Enviar a -> Impresora de etiquetas" o arrastrarlos sobre el ícono del escritorio
#   (manda cada archivo ZPL, por ejemplo las etiquetas de Mercado Libre; no los borra).
# Instalado desde el panel (Etiqueta de envío → "Instalar impresión directa"). Para otra impresora, cambiar $Printer.
param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Items)
$ErrorActionPreference = "Stop"
$Printer = "${DEFAULT_PRINTER}"
if ($env:IGWT_PRINTER) { $Printer = $env:IGWT_PRINTER }   # solo para probar

Add-Type -AssemblyName System.Windows.Forms
function Fail([string]$msg) {
  if ($env:IGWT_NO_UI) { Write-Output "ERROR: $msg" } else { [void][System.Windows.Forms.MessageBox]::Show($msg, "IGWT Store - Etiqueta", 0, 48) }
  exit 1
}

# ¿Es ZPL? Empieza con ^XA (salteando BOM y espacios)
function Test-Zpl([byte[]]$bytes) {
  $head = [Text.Encoding]::UTF8.GetString($bytes, 0, [Math]::Min(64, $bytes.Length)).TrimStart([char]0xFEFF, [char]32, [char]13, [char]10, [char]9)
  return $head.StartsWith('^XA')
}

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class IgwtRawPrint {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DOCINFO { public string pDocName; public string pOutputFile; public string pDataType; }
  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool OpenPrinter(string name, out IntPtr h, IntPtr d);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)] static extern int StartDocPrinter(IntPtr h, int level, DOCINFO di);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool WritePrinter(IntPtr h, byte[] b, int n, out int w);
  public static string Send(string printer, byte[] data, string doc) {
    IntPtr h;
    if (!OpenPrinter(printer, out h, IntPtr.Zero)) return "No encontré la impresora '" + printer + "' en esta PC.";
    try {
      DOCINFO di = new DOCINFO(); di.pDocName = doc; di.pDataType = "RAW";
      if (StartDocPrinter(h, 1, di) == 0) return "La impresora no aceptó el trabajo (error " + Marshal.GetLastWin32Error() + ").";
      StartPagePrinter(h);
      int w; bool ok = WritePrinter(h, data, data.Length, out w);
      EndPagePrinter(h); EndDocPrinter(h);
      return (ok && w == data.Length) ? null : "No se pudo mandar la etiqueta (error " + Marshal.GetLastWin32Error() + ").";
    } finally { ClosePrinter(h); }
  }
}
"@
$Url = ""
if ($Items -and $Items.Count -gt 0 -and $Items[0] -like "igwt-etiqueta:*") { $Url = $Items[0] }

if (-not $Url) {
  # Archivos elegidos con "Enviar a" o arrastrados sobre el ícono
  $paths = @($Items | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) })
  if ($paths.Count -eq 0) { Fail "No llegó ningún archivo. Elegí la etiqueta con clic derecho → Enviar a → Impresora de etiquetas, o arrastrala sobre el ícono del escritorio." }
  $sent = 0
  $skipped = @()
  foreach ($p in $paths) {
    $fi = Get-Item -LiteralPath $p
    if ($fi.Length -gt 5MB) { $skipped += "$($fi.Name) (demasiado grande)"; continue }
    $bytes = [IO.File]::ReadAllBytes($fi.FullName)
    if ($bytes.Length -lt 10 -or -not (Test-Zpl $bytes)) { $skipped += "$($fi.Name) (no es una etiqueta ZPL)"; continue }
    $err = [IgwtRawPrint]::Send($Printer, $bytes, $fi.Name)
    if ($err) { Fail $err }
    $sent++
  }
  if ($skipped.Count -gt 0) { Fail ("Se mandaron $sent. No se mandaron:" + [Environment]::NewLine + ($skipped -join [Environment]::NewLine)) }
  if ($env:IGWT_NO_UI) { Write-Output "OK $sent" }
  exit 0
}

# Link del panel: archivo=<nombre> (solo el nombre: nada de carpetas)
$name = ""
if ($Url -match '[?&]archivo=([^&]*)') { $name = [IO.Path]::GetFileName([Uri]::UnescapeDataString($Matches[1].Replace('+', ' '))) }

$dl = (Get-ItemProperty "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders")."{374DE290-123F-4565-9164-39C4925E467B}"
if (-not $dl) { $dl = Join-Path $env:USERPROFILE "Downloads" }
$dl = [Environment]::ExpandEnvironmentVariables($dl)
if ($env:IGWT_DL) { $dl = $env:IGWT_DL }   # solo para probar

# El navegador la está bajando: esperar hasta 20 s
$file = $null
for ($i = 0; $i -lt 40 -and -not $file; $i++) {
  if ($name -and (Test-Path -LiteralPath (Join-Path $dl $name))) {
    $file = Get-Item -LiteralPath (Join-Path $dl $name)
  } elseif (-not $name) {
    $file = Get-ChildItem -LiteralPath $dl -Filter "Etiqueta*.zpl" -ErrorAction SilentlyContinue |
      Where-Object { $_.LastWriteTime -gt (Get-Date).AddMinutes(-2) } | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  }
  if (-not $file) { Start-Sleep -Milliseconds 500 }
}
if (-not $file) { Fail "No encontré la etiqueta en Descargas ($dl). Si Chrome pregunta dónde guardar cada archivo, desactivalo en Configuración → Descargas." }
if ($file.Name -notlike "Etiqueta*.zpl") { Fail "Ese archivo no es una etiqueta: $($file.Name)" }
Start-Sleep -Milliseconds 300
$bytes = [IO.File]::ReadAllBytes($file.FullName)
if ($bytes.Length -lt 10 -or -not (Test-Zpl $bytes)) { Fail "El archivo no es una etiqueta ZPL: $($file.Name)" }
$err = [IgwtRawPrint]::Send($Printer, $bytes, $file.Name)
if ($err) { Fail $err }
Remove-Item -LiteralPath $file.FullName -ErrorAction SilentlyContinue
if ($env:IGWT_NO_UI) { Write-Output "OK" }
`;

// UTF-8 con BOM: Windows PowerShell 5.1 lee sin BOM como ANSI y rompe las tildes de los mensajes
function utf8WithBom(text) {
  const body = new TextEncoder().encode(text.replace(/\r?\n/g, "\r\n"));
  const out = new Uint8Array(body.length + 3);
  out.set([0xef, 0xbb, 0xbf]);
  out.set(body, 3);
  return out;
}

function base64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return typeof btoa === "function" ? btoa(s) : Buffer.from(s, "binary").toString("base64");
}

// Instalador para correr una vez en cada PC (doble clic). Sin acentos: la consola de Windows los muestra mal.
// protocol / dirName: otros nombres solo para probar el instalador sin pisar el real.
export function installerCmd({ protocol = PROTOCOL, dirName = "IGWT", shortcutName = SHORTCUT_NAME } = {}) {
  const b64 = base64(utf8WithBom(PRINT_SCRIPT));
  // En pedazos de 4000 (múltiplo de 4: cada uno se decodifica solo): una línea de cmd no puede pasar de
  // 8191 caracteres y el script entero en una sola línea ya llegaba a 8133.
  const target = `$env:LOCALAPPDATA + '\\${dirName}\\imprimir-etiqueta.ps1'`;
  const writeLines = b64.match(/.{1,4000}/g).flatMap((chunk, i) => [
    i === 0
      ? `powershell -NoProfile -ExecutionPolicy Bypass -Command "[IO.File]::WriteAllBytes(${target}, [Convert]::FromBase64String('${chunk}'))"`
      : `powershell -NoProfile -ExecutionPolicy Bypass -Command "$f = [IO.File]::Open(${target}, 'Append'); $b = [Convert]::FromBase64String('${chunk}'); $f.Write($b, 0, $b.Length); $f.Close()"`,
    "if errorlevel 1 goto error",
  ]);
  return [
    "@echo off",
    "setlocal",
    "echo Instalando la impresion directa de etiquetas de IGWT Store en esta PC...",
    `set "IGWTDIR=%LOCALAPPDATA%\\${dirName}"`,
    `if not exist "%IGWTDIR%" mkdir "%IGWTDIR%"`,
    ...writeLines,
    `reg add "HKCU\\Software\\Classes\\${protocol}" /ve /d "URL:IGWT Etiquetas" /f >nul`,
    `reg add "HKCU\\Software\\Classes\\${protocol}" /v "URL Protocol" /d "" /f >nul`,
    `reg add "HKCU\\Software\\Classes\\${protocol}\\shell\\open\\command" /ve /d "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \\"%IGWTDIR%\\imprimir-etiqueta.ps1\\" \\"%%1\\"" /f >nul`,
    `if errorlevel 1 goto error`,
    // Atajos para mandar archivos ZPL sueltos (las etiquetas de Mercado Libre): "Enviar a → Impresora de
    // etiquetas" y un ícono en el escritorio para arrastrarlos encima. Si falla, lo del panel igual queda.
    `powershell -NoProfile -ExecutionPolicy Bypass -Command "$ps1 = Join-Path $env:LOCALAPPDATA '${dirName}\\imprimir-etiqueta.ps1'; $w = New-Object -ComObject WScript.Shell; foreach ($d in @([Environment]::GetFolderPath('SendTo'), [Environment]::GetFolderPath('Desktop'))) { $s = $w.CreateShortcut((Join-Path $d '${shortcutName}.lnk')); $s.TargetPath = 'powershell.exe'; $s.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \\"' + $ps1 + '\\"'; $s.IconLocation = 'shell32.dll,16'; $s.Description = 'Manda etiquetas ZPL a la impresora termica'; $s.Save() }"`,
    "echo.",
    "echo Listo. Ya se puede usar el boton Termica en la etiqueta de envio del panel.",
    "echo La primera vez Chrome pregunta si abrir el link: tildar \"Permitir siempre\" y aceptar.",
    "echo.",
    `echo Para las etiquetas de Mercado Libre: clic derecho en el archivo, Enviar a, ${shortcutName}.`,
    `echo O arrastrarlas sobre el icono "${shortcutName}" del escritorio.`,
    "echo.",
    "pause",
    "exit /b 0",
    ":error",
    "echo.",
    "echo No se pudo instalar. Avisale a quien te paso el panel.",
    "pause",
    "exit /b 1",
    "",
  ].join("\r\n");
}

function download(content, fileName, type = "text/plain") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function downloadInstaller() {
  download(installerCmd(), "Instalar impresion de etiquetas IGWT.cmd", "application/octet-stream");
}

// Nombre único (con la hora) para que el ayudante tome justo este archivo y no uno viejo
export function zplFileName(label, now = new Date()) {
  const name = (label.recipientName || "etiqueta").replace(/[\\/:*?"<>|&%#]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 50) || "etiqueta";
  const hhmmss = [now.getHours(), now.getMinutes(), now.getSeconds()].map((n) => String(n).padStart(2, "0")).join("");
  return `Etiqueta ${name} ${hhmmss}.zpl`;
}

// Baja el .zpl y le pide al ayudante de la PC que lo mande a la impresora.
export function printOnThermal(label, opts = {}) {
  const fileName = zplFileName(label);
  download(labelToZpl(label, opts), fileName);
  setTimeout(() => {
    window.location.href = `${PROTOCOL}:imprimir?archivo=${encodeURIComponent(fileName)}`;
  }, 600);
  return fileName;
}
