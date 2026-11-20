// Tests de la impresión directa en la térmica (utils/thermalPrint.js). Correr con: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { installerCmd, zplFileName, PRINT_SCRIPT, DEFAULT_PRINTER, PROTOCOL } from "./thermalPrint.js";

test("el nombre del .zpl no lleva caracteres que rompan el archivo o el link, y lleva la hora", () => {
  const n = zplFileName({ recipientName: 'Ana / "Gómez" & Cía?#%' }, new Date(2026, 10, 20, 9, 5, 7));
  assert.equal(n, "Etiqueta Ana Gómez Cía 090507.zpl");
  assert.match(zplFileName({}, new Date(2026, 0, 1, 23, 59, 0)), /^Etiqueta etiqueta 235900\.zpl$/);
});

test("el instalador registra el link para el usuario y deja el script con BOM", () => {
  const cmd = installerCmd();
  assert.ok(cmd.includes("reg add \"HKCU\\Software\\Classes\\" + PROTOCOL + "\" /v \"URL Protocol\" /d \"\" /f"));
  assert.ok(cmd.includes(String.raw`-File \"%IGWTDIR%\imprimir-etiqueta.ps1\" \"%%1\"`));
  assert.ok(cmd.split("\r\n").every((l) => l.length < 8000), "una línea de cmd no puede pasar de 8191");
  const b64 = [...cmd.matchAll(/FromBase64String\('([^']+)'\)/g)].map((m) => m[1]).join("");
  const bytes = Buffer.from(b64, "base64");
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  const script = bytes.subarray(3).toString("utf8");
  assert.equal(script, PRINT_SCRIPT.replace(/\r?\n/g, "\r\n"));
  assert.ok(script.includes(`$Printer = "${DEFAULT_PRINTER}"`));
});

test("el script solo toma etiquetas ZPL de Descargas y sin carpetas", () => {
  assert.ok(PRINT_SCRIPT.includes("[IO.Path]::GetFileName("));
  assert.ok(PRINT_SCRIPT.includes('-notlike "Etiqueta*.zpl"'));
  assert.ok(PRINT_SCRIPT.includes("StartsWith('^XA')"));
  assert.ok(PRINT_SCRIPT.includes('pDataType = "RAW"'));
});

test("archivos sueltos (Mercado Libre): Enviar a y el ícono del escritorio, sin borrar", () => {
  assert.ok(PRINT_SCRIPT.includes("ValueFromRemainingArguments"));
  assert.ok(PRINT_SCRIPT.includes("-PathType Leaf"));
  const filesMode = PRINT_SCRIPT.slice(PRINT_SCRIPT.indexOf("if (-not $Url) {"), PRINT_SCRIPT.indexOf("# Link del panel"));
  assert.ok(!filesMode.includes("Remove-Item"), "los archivos de Mercado Libre no se borran");
  const cmd = installerCmd();
  assert.ok(cmd.includes("GetFolderPath('SendTo')") && cmd.includes("GetFolderPath('Desktop')"));
  assert.ok(cmd.includes("Impresora de etiquetas.lnk"));
});
