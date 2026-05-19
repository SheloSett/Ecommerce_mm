const nodemailer = require("nodemailer");
const PDFDocument = require("pdfkit");
const path = require("path");
const fs = require("fs");
const https = require("https");
const http  = require("http");
const sharp = require("sharp");

// Crea el transporte solo si las variables de entorno de SMTP están configuradas
function createTransporter() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_USER || !SMTP_PASS) return null;

  const port = parseInt(SMTP_PORT) || 587;

  return nodemailer.createTransport({
    host: SMTP_HOST || "smtp.gmail.com",
    port,
    // 465 = SSL/TLS implícito (secure: true); 587 = STARTTLS (secure: false)
    secure: port === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    // Timeouts cortos: si Render bloquea el puerto, mejor fallar rápido que colgar 60s
    connectionTimeout: 10000,
    greetingTimeout:   10000,
    socketTimeout:     10000,
  });
}

// Formatea un número como moneda ARS
function formatARS(amount) {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(amount ?? 0);
}

// Resuelve la ruta local de una imagen de producto.
// Las imágenes se guardan en la DB como "/uploads/filename.jpg" → extrae solo el filename.
function resolveImagePath(imageName) {
  if (!imageName) return null;
  const filename = path.basename(imageName); // extrae "filename.jpg" de "/uploads/filename.jpg"
  const p = path.join(__dirname, "../../uploads", filename);
  return fs.existsSync(p) ? p : null;
}

// Convierte una URL de Cloudinary a JPG compatible con pdfkit.
// pdfkit solo soporta JPG y PNG. Cloudinary puede tener f_webp en las transformaciones
// Y la extensión .webp — hay que limpiar ambas cosas para obtener un JPG válido.
function cloudinaryToPdfCompatible(url) {
  if (!url.includes("res.cloudinary.com")) return url;
  // 1. Reemplazar f_webp/f_gif/f_avif por f_jpg en los parámetros de transformación
  let result = url.replace(/\bf_(webp|gif|avif|bmp|tiff|svg)\b/gi, "f_jpg");
  // 2. Reemplazar la extensión del archivo por .jpg
  result = result.replace(/\.(webp|gif|avif|bmp|tiff|svg)(\?|$)/gi, ".jpg$2");
  return result;
}

// Descarga una imagen desde una URL HTTP/HTTPS y retorna su Buffer (o null si falla).
// Sigue redirects (Cloudinary puede redirigir) y loguea el error para diagnóstico.
function fetchImageBuffer(url, redirectsLeft = 4) {
  return new Promise((resolve) => {
    try {
      const isHttps = url.startsWith("https");
      const client  = isHttps ? https : http;
      // rejectUnauthorized:false solo para descarga de imágenes de CDN propio
      const options = isHttps ? { rejectUnauthorized: false } : {};

      const req = client.get(url, options, (res) => {
        // Seguir redirects (301/302/307/308)
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirectsLeft > 0) {
          res.resume();
          const next = res.headers.location.startsWith("http")
            ? res.headers.location
            : new URL(res.headers.location, url).href;
          resolve(fetchImageBuffer(next, redirectsLeft - 1));
          return;
        }
        if (res.statusCode !== 200) {
          console.warn(`[PDF IMG] HTTP ${res.statusCode} — ${url}`);
          res.resume();
          resolve(null);
          return;
        }
        const chunks = [];
        res.on("data",  (c) => chunks.push(c));
        res.on("end",   () => resolve(Buffer.concat(chunks)));
        res.on("error", (e) => { console.warn(`[PDF IMG] Stream error: ${e.message}`); resolve(null); });
      });

      req.on("error",   (e) => { console.warn(`[PDF IMG] Request error: ${e.message} — ${url}`); resolve(null); });
      req.setTimeout(15000, () => { console.warn(`[PDF IMG] Timeout — ${url}`); req.destroy(); resolve(null); });
    } catch (e) {
      console.warn(`[PDF IMG] Excepción: ${e.message}`);
      resolve(null);
    }
  });
}

// Devuelve el mime type de un archivo de imagen según su extensión
function imageMime(imageName) {
  const ext = path.extname(imageName).toLowerCase();
  if (ext === ".png")  return "image/png";
  if (ext === ".webp") return "image/webp";
  return "image/jpeg";
}

// Indica si pdfkit puede renderizar esta imagen (no soporta WebP)
function isPdfCompatible(imageName) {
  const ext = path.extname(imageName || "").toLowerCase();
  return ext === ".jpg" || ext === ".jpeg" || ext === ".png";
}

// Devuelve los datos bancarios desde variables de entorno (null si no están configurados).
// Soporta BANK_CVU (MercadoPago) y BANK_CBU (banco tradicional) — usa el que esté definido.
function getBankDetails() {
  const { BANK_NAME, BANK_ACCOUNT_NAME, BANK_CVU, BANK_CBU, BANK_ALIAS, BANK_ACCOUNT_NUMBER } = process.env;
  const cvu = BANK_CVU || BANK_CBU || null; // CVU de MP tiene prioridad sobre CBU bancario
  // Solo retorna el objeto si al menos hay CVU/CBU o alias configurado
  if (!cvu && !BANK_ALIAS) return null;
  return {
    banco:   BANK_NAME         || null,
    titular: BANK_ACCOUNT_NAME || null,
    cvu,                               // puede ser CVU o CBU según lo que haya
    alias:   BANK_ALIAS        || null,
    cuenta:  BANK_ACCOUNT_NUMBER || null,
  };
}

// ─── Generador de PDF ────────────────────────────────────────────────────────
// Genera un Buffer PDF con la tabla de items de la orden.
// type: "Pedido" | "Cotización"
// showBankDetails: si true, agrega un bloque con los datos bancarios al final
async function buildOrderPdf(order, type = "Pedido", showBankDetails = false) {
  // Pre-descarga de imágenes: Cloudinary no tiene archivos locales, hay que bajarlos.
  // resolveImagePath retornaba null para URLs https:// → imágenes grises en el PDF.
  const items = order.items || [];
  const imageBuffers = await Promise.all(items.map(async (item) => {
    const imgName = item.product?.images?.[0] || null;
    if (!imgName) return null;
    if (imgName.startsWith("http")) {
      // URL de Cloudinary: limpiar f_webp y extensión para que pdfkit reciba un JPG
      const url = cloudinaryToPdfCompatible(imgName);
      return fetchImageBuffer(url);
    }
    // Imagen local: leer del disco y convertir a JPG si es WebP (pdfkit no soporta WebP)
    const localPath = resolveImagePath(imgName);
    if (!localPath) return null;
    const buf = fs.readFileSync(localPath);
    if (isPdfCompatible(imgName)) return buf;
    // WebP u otro formato incompatible: convertir a JPEG con sharp
    try {
      return await sharp(buf).jpeg({ quality: 80 }).toBuffer();
    } catch (e) {
      console.warn(`[PDF IMG] Sharp error convirtiendo ${imgName}: ${e.message}`);
      return null;
    }
  }));

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const BRAND    = "#1e293b";
    const ACCENT   = "#3b82f6";
    const ROW_EVEN = "#f8fafc";
    const PAGE_W   = 595 - 100; // A4 width - margins

    // ── Header ──────────────────────────────────────────────────────────────
    doc.rect(0, 0, 595, 70).fill(BRAND);
    doc
      .fillColor("white")
      .fontSize(22)
      .font("Helvetica-Bold")
      .text("IGWT Store", 50, 20, { width: PAGE_W, align: "center" });
    doc
      .fontSize(11)
      .font("Helvetica")
      .text(`${type} #${order.id}`, 50, 46, { width: PAGE_W, align: "center" });

    doc.fillColor("black").moveDown(3);

    // ── Datos del cliente ────────────────────────────────────────────────────
    const infoY = 90;
    doc.fontSize(10).font("Helvetica-Bold").fillColor(BRAND).text("Datos del cliente:", 50, infoY);
    doc.font("Helvetica").fillColor("#334155").fontSize(9);
    doc.text(`Nombre:   ${order.customerName}`,  50, infoY + 14);
    doc.text(`Email:    ${order.customerEmail}`,  50, infoY + 26);
    if (order.customerPhone)
      doc.text(`Teléfono: ${order.customerPhone}`, 50, infoY + 38);

    const dateStr = new Date(order.createdAt || Date.now()).toLocaleDateString("es-AR");
    doc.text(`Fecha:    ${dateStr}`, 320, infoY + 14);

    // ── Tabla ────────────────────────────────────────────────────────────────
    // Columnas: # | Imagen | Producto | Precio unit. | Cant. | Subtotal
    const cols = { num: 25, img: 55, name: 185, price: 90, qty: 45, subtotal: 95 };
    const tableX = 50;
    const tableW = PAGE_W;
    const rowH   = 52;
    const headerH = 22;
    let tableY = order.customerPhone ? infoY + 62 : infoY + 50;

    // Cabecera
    doc.rect(tableX, tableY, tableW, headerH).fill(BRAND);
    doc.fillColor("white").fontSize(8).font("Helvetica-Bold");

    let cx = tableX + 4;
    doc.text("#",            cx, tableY + 7, { width: cols.num });  cx += cols.num;
    doc.text("Imagen",       cx, tableY + 7, { width: cols.img });  cx += cols.img;
    doc.text("Producto",     cx, tableY + 7, { width: cols.name }); cx += cols.name;
    doc.text("Precio unit.", cx, tableY + 7, { width: cols.price, align: "right" }); cx += cols.price;
    doc.text("Cant.",        cx, tableY + 7, { width: cols.qty,   align: "center" }); cx += cols.qty;
    doc.text("Subtotal",     cx, tableY + 7, { width: cols.subtotal - 4, align: "right" });

    let rowY = tableY + headerH;

    const items = order.items || [];
    items.forEach((item, idx) => {
      // Fondo alternado
      if (idx % 2 === 0) doc.rect(tableX, rowY, tableW, rowH).fill(ROW_EVEN);

      // Línea separadora
      doc.rect(tableX, rowY + rowH - 0.5, tableW, 0.5).fill("#e2e8f0");

      cx = tableX + 4;

      // #
      doc.fillColor("#94a3b8").fontSize(8).font("Helvetica")
        .text(String(idx + 1), cx, rowY + rowH / 2 - 4, { width: cols.num });
      cx += cols.num;

      // Imagen — usa el buffer pre-descargado (Cloudinary o local)
      const imgBuffer = imageBuffers[idx];
      if (imgBuffer) {
        try {
          doc.image(imgBuffer, cx + 4, rowY + 6, { width: 40, height: 40, fit: [40, 40] });
        } catch (_) {
          // ignorar si el buffer no es una imagen válida para pdfkit
          doc.rect(cx + 4, rowY + 6, 40, 40).fill("#cbd5e1");
        }
      } else {
        doc.rect(cx + 4, rowY + 6, 40, 40).fill("#e2e8f0");
      }
      cx += cols.img;

      // Nombre del producto
      const name = item.product?.name || item.name || "Producto";
      doc.fillColor("#1e293b").fontSize(9).font("Helvetica-Bold")
        .text(name, cx, rowY + rowH / 2 - 5, { width: cols.name - 4, lineBreak: false });
      cx += cols.name;

      // Precio unitario
      doc.fillColor("#475569").fontSize(9).font("Helvetica")
        .text(formatARS(item.price), cx, rowY + rowH / 2 - 5, { width: cols.price, align: "right" });
      cx += cols.price;

      // Cantidad
      doc.text(String(item.quantity), cx, rowY + rowH / 2 - 5, { width: cols.qty, align: "center" });
      cx += cols.qty;

      // Subtotal
      doc.fillColor("#1e293b").font("Helvetica-Bold")
        .text(formatARS(item.price * item.quantity), cx, rowY + rowH / 2 - 5, {
          width: cols.subtotal - 8, align: "right",
        });

      rowY += rowH;
    });

    // Fila de cupón (si aplica)
    if (order.couponDiscount > 0) {
      doc.rect(tableX, rowY, tableW, 22).fill("#f0fdf4");
      doc.fillColor("#16a34a").fontSize(9).font("Helvetica-Bold")
        .text(
          `Cupón aplicado${order.coupon?.code ? ` (${order.coupon.code})` : ""}`,
          tableX + 8, rowY + 6,
          { width: tableW - cols.subtotal - 8 }
        );
      doc.text(
        `- ${formatARS(order.couponDiscount)}`,
        tableX + tableW - cols.subtotal - 4, rowY + 6,
        { width: cols.subtotal - 4, align: "right" }
      );
      rowY += 22;
    }

    // Fila de IVA (si solicitó factura)
    if (order.wantsInvoice && order.ivaAmount > 0) {
      doc.rect(tableX, rowY, tableW, 22).fill("#eff6ff");
      doc.fillColor("#2563eb").fontSize(9).font("Helvetica-Bold")
        .text("IVA (21%)", tableX + 8, rowY + 6, { width: tableW - cols.subtotal - 8 });
      doc.text(
        `+ ${formatARS(order.ivaAmount)}`,
        tableX + tableW - cols.subtotal - 4, rowY + 6,
        { width: cols.subtotal - 4, align: "right" }
      );
      rowY += 22;
    }

    // Fila de total
    doc.rect(tableX, rowY, tableW, 28).fill(ACCENT);
    doc.fillColor("white").fontSize(11).font("Helvetica-Bold")
      .text("TOTAL", tableX + 8, rowY + 8, { width: tableW - cols.subtotal - 8 });
    doc.text(formatARS(order.total), tableX + tableW - cols.subtotal - 4, rowY + 8, {
      width: cols.subtotal - 4, align: "right",
    });

    // Datos bancarios (solo si showBankDetails = true y hay datos configurados)
    if (showBankDetails) {
      const bank = getBankDetails();
      if (bank) {
        const bankY = rowY + 36;
        doc.rect(tableX, bankY, tableW, 14).fill("#2563eb");
        doc.fillColor("white").fontSize(8).font("Helvetica-Bold")
          .text("DATOS PARA TRANSFERENCIA BANCARIA", tableX + 6, bankY + 3, { width: tableW });

        let bY = bankY + 20;
        doc.fillColor("#1e293b").fontSize(9).font("Helvetica-Bold");
        if (bank.banco)   { doc.text(`Banco:`,   tableX,      bY); doc.font("Helvetica").text(bank.banco,   tableX + 70, bY, { width: tableW - 70 }); bY += 14; }
        if (bank.titular) { doc.font("Helvetica-Bold").text(`Titular:`, tableX, bY); doc.font("Helvetica").text(bank.titular, tableX + 70, bY, { width: tableW - 70 }); bY += 14; }
        if (bank.cvu)     { doc.font("Helvetica-Bold").text(`CVU/CBU:`, tableX, bY); doc.font("Helvetica").text(bank.cvu,     tableX + 70, bY, { width: tableW - 70 }); bY += 14; }
        if (bank.alias)   { doc.font("Helvetica-Bold").text(`Alias:`,   tableX, bY); doc.font("Helvetica").text(bank.alias,   tableX + 70, bY, { width: tableW - 70 }); bY += 14; }
        if (bank.cuenta)  { doc.font("Helvetica-Bold").text(`Cuenta:`,  tableX, bY); doc.font("Helvetica").text(bank.cuenta,  tableX + 70, bY, { width: tableW - 70 }); bY += 14; }

        doc.fillColor("#94a3b8").fontSize(8).font("Helvetica")
          .text("Gracias por elegirnos · IGWT Store", tableX, bY + 12, { width: tableW, align: "center" });
      } else {
        // No hay datos bancarios configurados → solo footer
        doc.fillColor("#94a3b8").fontSize(8).font("Helvetica")
          .text("Gracias por elegirnos · IGWT Store", tableX, rowY + 50, { width: tableW, align: "center" });
      }
    } else {
      // Footer normal
      doc.fillColor("#94a3b8").fontSize(8).font("Helvetica")
        .text("Gracias por elegirnos · IGWT Store", tableX, rowY + 50, {
          width: tableW, align: "center",
        });
    }

    doc.end();
  });
}

// ─── Generador de HTML ───────────────────────────────────────────────────────
// Genera el cuerpo HTML del email con la tabla de items.
// Usa CID attachments (imágenes embebidas por Content-ID) para compatibilidad
// con Gmail y otros clientes que bloquean data URLs.
// Retorna { html, attachments } donde attachments son los objetos nodemailer con cid.
// showBankDetails: si true, agrega bloque de datos bancarios al final (solo transferencia)
function buildOrderHtml(order, { title, subtitle, footer, type = "Pedido", showBankDetails = false }) {
  const items = order.items || [];
  const attachments = []; // acumula { filename, path, cid, contentType }

  const rowsHtml = items.map((item, idx) => {
    const imgName = item.product?.images?.[0] || null;
    const name    = item.product?.name || item.name || "Producto";
    const bg      = idx % 2 === 0 ? "#f8fafc" : "#ffffff";

    let imgCell;
    if (imgName && imgName.startsWith("http")) {
      // URL de Cloudinary: usar directamente en el src — no necesita CID ni archivo local.
      // Antes se intentaba resolveImagePath() que buscaba en disco → siempre null → sin imagen.
      imgCell = `<img src="${imgName}" width="48" height="48" style="border-radius:6px;object-fit:cover;display:block;">`;
    } else if (imgName) {
      // Imagen local (fallback): usar CID attachment
      const imgPath = resolveImagePath(imgName);
      if (imgPath) {
        const cid = `img-${idx}@igwt`;
        attachments.push({ filename: path.basename(imgPath), path: imgPath, cid, contentType: imageMime(imgPath) });
        imgCell = `<img src="cid:${cid}" width="48" height="48" style="border-radius:6px;object-fit:cover;display:block;">`;
      } else {
        imgCell = `<div style="width:48px;height:48px;background:#e2e8f0;border-radius:6px;text-align:center;line-height:48px;font-size:20px;">📦</div>`;
      }
    } else {
      imgCell = `<div style="width:48px;height:48px;background:#e2e8f0;border-radius:6px;text-align:center;line-height:48px;font-size:20px;">📦</div>`;
    }

    return `
      <tr style="background:${bg};">
        <td style="padding:10px 12px;color:#94a3b8;font-size:12px;text-align:center;">${idx + 1}</td>
        <td style="padding:8px 12px;">${imgCell}</td>
        <td style="padding:10px 12px;font-weight:600;color:#1e293b;font-size:13px;">${name}</td>
        <td style="padding:10px 12px;color:#475569;font-size:13px;text-align:right;">${formatARS(item.price)}</td>
        <td style="padding:10px 12px;color:#475569;font-size:13px;text-align:center;">${item.quantity}</td>
        <td style="padding:10px 12px;font-weight:700;color:#1e293b;font-size:13px;text-align:right;">${formatARS(item.price * item.quantity)}</td>
      </tr>`;
  }).join("");

  const html = `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

        <!-- Header -->
        <tr>
          <td style="background:#1e293b;padding:28px 40px;text-align:center;">
            <p style="margin:0;color:#94a3b8;font-size:12px;letter-spacing:2px;text-transform:uppercase;">IGWT Store</p>
            <h1 style="margin:6px 0 0;color:#ffffff;font-size:22px;font-weight:700;">${title}</h1>
            <p style="margin:4px 0 0;color:#64748b;font-size:13px;">${type} #${order.id}</p>
          </td>
        </tr>

        <!-- Subtítulo -->
        <tr>
          <td style="padding:28px 40px 8px;">
            <p style="margin:0;color:#334155;font-size:15px;">Hola <strong>${order.customerName}</strong>,</p>
            <p style="margin:8px 0 0;color:#64748b;font-size:14px;">${subtitle}</p>
          </td>
        </tr>

        <!-- Info cliente -->
        <tr>
          <td style="padding:16px 40px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-radius:10px;padding:0;">
              <tr>
                <td style="padding:14px 18px;">
                  <p style="margin:0 0 4px;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;">Datos del pedido</p>
                  <p style="margin:0;font-size:13px;color:#334155;"><strong>Cliente:</strong> ${order.customerName}</p>
                  <p style="margin:2px 0 0;font-size:13px;color:#334155;"><strong>Email:</strong> ${order.customerEmail}</p>
                  ${order.customerPhone ? `<p style="margin:2px 0 0;font-size:13px;color:#334155;"><strong>Teléfono:</strong> ${order.customerPhone}</p>` : ""}
                  <p style="margin:2px 0 0;font-size:13px;color:#334155;"><strong>Fecha:</strong> ${new Date(order.createdAt || Date.now()).toLocaleDateString("es-AR")}</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Tabla de productos -->
        <tr>
          <td style="padding:0 40px 24px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border-radius:10px;overflow:hidden;">
              <!-- Cabecera -->
              <thead>
                <tr style="background:#1e293b;">
                  <th style="padding:10px 12px;color:#94a3b8;font-size:10px;text-transform:uppercase;letter-spacing:1px;text-align:center;font-weight:600;width:30px;">#</th>
                  <th style="padding:10px 12px;color:#94a3b8;font-size:10px;text-transform:uppercase;letter-spacing:1px;width:60px;"></th>
                  <th style="padding:10px 12px;color:#94a3b8;font-size:10px;text-transform:uppercase;letter-spacing:1px;text-align:left;font-weight:600;">Producto</th>
                  <th style="padding:10px 12px;color:#94a3b8;font-size:10px;text-transform:uppercase;letter-spacing:1px;text-align:right;font-weight:600;">Precio unit.</th>
                  <th style="padding:10px 12px;color:#94a3b8;font-size:10px;text-transform:uppercase;letter-spacing:1px;text-align:center;font-weight:600;">Cant.</th>
                  <th style="padding:10px 12px;color:#94a3b8;font-size:10px;text-transform:uppercase;letter-spacing:1px;text-align:right;font-weight:600;">Subtotal</th>
                </tr>
              </thead>
              <tbody>${rowsHtml}</tbody>
              <!-- Cupón de descuento (si aplica) -->
              <tfoot>
                ${order.couponDiscount > 0 ? `
                <tr style="background:#f0fdf4;">
                  <td colspan="5" style="padding:10px 16px;color:#16a34a;font-size:13px;font-weight:600;">
                    🏷️ Cupón aplicado${order.coupon?.code ? ` (${order.coupon.code})` : ""}
                  </td>
                  <td style="padding:10px 16px;color:#16a34a;font-weight:700;font-size:13px;text-align:right;">
                    - ${formatARS(order.couponDiscount)}
                  </td>
                </tr>` : ""}
                ${order.wantsInvoice && order.ivaAmount > 0 ? `
                <tr style="background:#eff6ff;">
                  <td colspan="5" style="padding:10px 16px;color:#2563eb;font-size:13px;font-weight:600;">
                    🧾 IVA (21%)
                  </td>
                  <td style="padding:10px 16px;color:#2563eb;font-weight:700;font-size:13px;text-align:right;">
                    + ${formatARS(order.ivaAmount)}
                  </td>
                </tr>` : ""}
                <tr style="background:#3b82f6;">
                  <td colspan="5" style="padding:12px 16px;color:#ffffff;font-weight:700;font-size:14px;">TOTAL</td>
                  <td style="padding:12px 16px;color:#ffffff;font-weight:700;font-size:15px;text-align:right;">${formatARS(order.total)}</td>
                </tr>
              </tfoot>
            </table>
          </td>
        </tr>

        <!-- Footer del email -->
        <tr>
          <td style="padding:20px 40px ${showBankDetails && getBankDetails() ? "16px" : "32px"};">
            <p style="margin:0;color:#475569;font-size:13px;line-height:1.6;">${footer}</p>
          </td>
        </tr>

        ${(() => {
          // Bloque de datos bancarios — solo se renderiza si showBankDetails=true y hay datos
          if (!showBankDetails) return "";
          const bank = getBankDetails();
          if (!bank) return "";
          const rows = [
            bank.banco   ? `<tr><td style="padding:3px 0;font-size:13px;color:#1e293b;"><strong>Banco:</strong> ${bank.banco}</td></tr>` : "",
            bank.titular ? `<tr><td style="padding:3px 0;font-size:13px;color:#1e293b;"><strong>Titular:</strong> ${bank.titular}</td></tr>` : "",
            bank.cvu     ? `<tr><td style="padding:3px 0;font-size:13px;color:#1e293b;"><strong>CVU / CBU:</strong> <span style="font-family:monospace;background:#e0f2fe;padding:1px 6px;border-radius:4px;">${bank.cvu}</span></td></tr>` : "",
            bank.alias   ? `<tr><td style="padding:3px 0;font-size:13px;color:#1e293b;"><strong>Alias:</strong> <span style="font-family:monospace;background:#e0f2fe;padding:1px 6px;border-radius:4px;">${bank.alias}</span></td></tr>` : "",
            bank.cuenta  ? `<tr><td style="padding:3px 0;font-size:13px;color:#1e293b;"><strong>Nro. de cuenta:</strong> ${bank.cuenta}</td></tr>` : "",
          ].join("");
          return `
        <tr>
          <td style="padding:0 40px 28px;">
            <table width="100%" cellpadding="0" cellspacing="0"
                   style="background:#eff6ff;border-radius:10px;border-left:4px solid #3b82f6;">
              <tr>
                <td style="padding:16px 20px;">
                  <p style="margin:0 0 10px;font-size:11px;color:#2563eb;font-weight:700;
                             text-transform:uppercase;letter-spacing:1px;">
                    🏦 Datos para transferencia bancaria
                  </p>
                  <table cellpadding="0" cellspacing="0">${rows}</table>
                  <p style="margin:10px 0 0;font-size:12px;color:#64748b;">
                    Una vez realizada la transferencia, envianos el comprobante por WhatsApp o respondiendo este email.
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>`;
        })()}

        <!-- Pie -->
        <tr>
          <td style="background:#f8fafc;padding:16px 40px;border-top:1px solid #e2e8f0;text-align:center;">
            <p style="margin:0;color:#94a3b8;font-size:11px;">© IGWT Store · Gracias por elegirnos</p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return { html, attachments };
}

// ─── Emails de mayorista ─────────────────────────────────────────────────────

async function sendMayoristaRequestEmail({ customerName, customerEmail, message }) {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail) {
    console.log(`[EMAIL OMITIDO] Solicitud mayorista de ${customerName} <${customerEmail}>`);
    return;
  }

  const transporter = createTransporter();
  if (!transporter) {
    console.log(`[EMAIL OMITIDO - SMTP no configurado] Solicitud mayorista de ${customerName} <${customerEmail}>`);
    return;
  }

  const body = `Nueva solicitud mayorista\nCliente: ${customerName}\nEmail: ${customerEmail}\n${message ? `Mensaje: ${message}` : "Sin mensaje adicional"}\n\nIngresá al panel de administración para aprobar o rechazar la solicitud.`.trim();

  try {
    await transporter.sendMail({
      from: `"IGWT Store" <${process.env.SMTP_USER}>`,
      to: adminEmail,
      subject: `Solicitud mayorista - ${customerName}`,
      text: body,
    });
    console.log(`[EMAIL] Notificación enviada a ${adminEmail}`);
  } catch (err) {
    console.error("[EMAIL ERROR]", err.message);
  }
}

async function sendMayoristaApprovedEmail({ customerName, customerEmail }) {
  const transporter = createTransporter();
  if (!transporter) {
    console.log(`[EMAIL OMITIDO - SMTP no configurado] Solicitud aprobada para ${customerEmail}`);
    return;
  }

  const body = `Hola ${customerName},\n\n¡Tu solicitud para pasar a cuenta Mayorista fue APROBADA!\n\nPara ver los cambios, cerrá sesión y volvé a iniciar sesión en la tienda.\n\nGracias por confiar en nosotros.`.trim();

  try {
    await transporter.sendMail({
      from: `"IGWT Store" <${process.env.SMTP_USER}>`,
      to: customerEmail,
      subject: "¡Tu solicitud mayorista fue aprobada!",
      text: body,
    });
    console.log(`[EMAIL] Aprobación enviada a ${customerEmail}`);
  } catch (err) {
    console.error("[EMAIL ERROR]", err.message);
  }
}

async function sendMayoristaRejectedEmail({ customerName, customerEmail }) {
  const transporter = createTransporter();
  if (!transporter) {
    console.log(`[EMAIL OMITIDO - SMTP no configurado] Solicitud rechazada para ${customerEmail}`);
    return;
  }

  const body = `Hola ${customerName},\n\nLamentablemente tu solicitud para pasar a cuenta Mayorista fue rechazada en esta oportunidad.\n\nSi tenés alguna consulta, podés contactarnos respondiendo este email.\n\nGracias.`.trim();

  try {
    await transporter.sendMail({
      from: `"IGWT Store" <${process.env.SMTP_USER}>`,
      to: customerEmail,
      subject: "Solicitud mayorista - Estado actualizado",
      text: body,
    });
    console.log(`[EMAIL] Rechazo enviado a ${customerEmail}`);
  } catch (err) {
    console.error("[EMAIL ERROR]", err.message);
  }
}

// ─── Emails de pedidos ───────────────────────────────────────────────────────

// Confirmación al cliente — EFECTIVO o TRANSFERENCIA
async function sendOrderConfirmationToCustomer(order) {
  const transporter = createTransporter();
  if (!transporter) {
    console.log(`[EMAIL OMITIDO - SMTP no configurado] Confirmación pedido #${order.id} a ${order.customerEmail}`);
    return;
  }

  const methodLabel = order.paymentMethod === "EFECTIVO" ? "Efectivo" : "Transferencia bancaria";
  const isTransfer  = order.paymentMethod === "TRANSFERENCIA";
  const instructions =
    isTransfer
      ? "A continuación encontrás los datos para realizar la transferencia. Una vez abonado, envianos el comprobante."
      : "Te contactaremos para coordinar el pago en efectivo y la entrega.";

  try {
    const { html, attachments: imgAttachments } = buildOrderHtml(order, {
      title: "¡Pedido recibido! 🎉",
      subtitle: `Tu pedido fue registrado correctamente. Método de pago: <strong>${methodLabel}</strong>.`,
      footer: instructions,
      type: "Pedido",
      showBankDetails: isTransfer, // muestra bloque bancario solo si es transferencia
    });
    const pdfBuffer = await buildOrderPdf(order, "Pedido", isTransfer); // idem en el PDF

    await transporter.sendMail({
      from: `"IGWT Store" <${process.env.SMTP_USER}>`,
      to: order.customerEmail,
      subject: `Pedido #${order.id} recibido — IGWT Store`,
      html,
      attachments: [
        ...imgAttachments,
        { filename: `pedido-${order.id}.pdf`, content: pdfBuffer, contentType: "application/pdf" },
      ],
    });
    console.log(`[EMAIL] Confirmación pedido #${order.id} enviada a ${order.customerEmail}`);
  } catch (err) {
    console.error("[EMAIL ERROR]", err.message);
  }
}

// Notificación al admin — pedido con pago manual
async function sendOrderNotificationToAdmin(order) {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail) {
    console.log(`[EMAIL OMITIDO] Nuevo pedido #${order.id} de ${order.customerName}`);
    return;
  }

  const transporter = createTransporter();
  if (!transporter) {
    console.log(`[EMAIL OMITIDO - SMTP no configurado] Nuevo pedido #${order.id} de ${order.customerName}`);
    return;
  }

  const methodLabel = order.paymentMethod === "EFECTIVO" ? "Efectivo" : "Transferencia bancaria";

  try {
    const { html, attachments: imgAttachments } = buildOrderHtml(order, {
      title: `Nuevo pedido #${order.id}`,
      subtitle: `Cliente: <strong>${order.customerName}</strong> (${order.customerEmail}) · Método: <strong>${methodLabel}</strong>`,
      footer: "Ingresá al panel de administración para gestionar este pedido.",
      type: "Pedido",
    });
    const pdfBuffer = await buildOrderPdf(order, "Pedido");

    await transporter.sendMail({
      from: `"IGWT Store" <${process.env.SMTP_USER}>`,
      to: adminEmail,
      subject: `Nuevo pedido #${order.id} — ${order.customerName} (${methodLabel})`,
      html,
      attachments: [
        ...imgAttachments,
        { filename: `pedido-${order.id}.pdf`, content: pdfBuffer, contentType: "application/pdf" },
      ],
    });
    console.log(`[EMAIL] Notificación pedido #${order.id} enviada al admin`);
  } catch (err) {
    console.error("[EMAIL ERROR]", err.message);
  }
}

// ─── Emails de cotizaciones ──────────────────────────────────────────────────

// Confirmación al cliente MAYORISTA
async function sendCotizacionToCustomer(order) {
  const transporter = createTransporter();
  if (!transporter) {
    console.log(`[EMAIL OMITIDO - SMTP no configurado] Cotización #${order.id} a ${order.customerEmail}`);
    return;
  }

  try {
    const { html, attachments: imgAttachments } = buildOrderHtml(order, {
      title: "¡Cotización recibida! 📋",
      subtitle: "Tu solicitud de cotización fue recibida correctamente. Revisaremos la disponibilidad de stock y te contactaremos para confirmar precio y entrega.",
      footer: "Nos comunicaremos a la brevedad para acordar el precio final y coordinar la entrega. ¡Gracias por elegirnos!",
      type: "Cotización",
    });
    const pdfBuffer = await buildOrderPdf(order, "Cotización");

    await transporter.sendMail({
      from: `"IGWT Store" <${process.env.SMTP_USER}>`,
      to: order.customerEmail,
      subject: `Cotización #${order.id} recibida — IGWT Store`,
      html,
      attachments: [
        ...imgAttachments,
        { filename: `cotizacion-${order.id}.pdf`, content: pdfBuffer, contentType: "application/pdf" },
      ],
    });
    console.log(`[EMAIL] Cotización #${order.id} enviada a ${order.customerEmail}`);
  } catch (err) {
    console.error("[EMAIL ERROR]", err.message);
  }
}

// Notificación al admin de nueva cotización
async function sendCotizacionToAdmin(order) {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail) {
    console.log(`[EMAIL OMITIDO] Nueva cotización #${order.id} de ${order.customerName}`);
    return;
  }

  const transporter = createTransporter();
  if (!transporter) {
    console.log(`[EMAIL OMITIDO - SMTP no configurado] Nueva cotización #${order.id} de ${order.customerName}`);
    return;
  }

  try {
    const { html, attachments: imgAttachments } = buildOrderHtml(order, {
      title: `Nueva cotización mayorista #${order.id}`,
      subtitle: `Cliente MAYORISTA: <strong>${order.customerName}</strong> (${order.customerEmail})${order.customerPhone ? ` · Tel: ${order.customerPhone}` : ""}`,
      footer: "Ingresá al panel de administración para contactar al cliente y gestionar la cotización.",
      type: "Cotización",
    });
    const pdfBuffer = await buildOrderPdf(order, "Cotización");

    await transporter.sendMail({
      from: `"IGWT Store" <${process.env.SMTP_USER}>`,
      to: adminEmail,
      subject: `Nueva cotización mayorista #${order.id} — ${order.customerName}`,
      html,
      attachments: [
        ...imgAttachments,
        { filename: `cotizacion-${order.id}.pdf`, content: pdfBuffer, contentType: "application/pdf" },
      ],
    });
    console.log(`[EMAIL] Cotización #${order.id} notificada al admin`);
  } catch (err) {
    console.error("[EMAIL ERROR]", err.message);
  }
}

// ─── Emails de Botón de Arrepentimiento ─────────────────────────────────────

// 1. Confirmación al cliente cuando envía la solicitud
async function sendReturnRequestConfirmation(toEmail, customerName, returnRequest) {
  const transporter = createTransporter();
  if (!transporter) {
    console.log(`[EMAIL OMITIDO - SMTP no configurado] Confirmación devolución #${returnRequest.id} a ${toEmail}`);
    return;
  }

  const html = `
<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;">
    <tr><td align="center">
      <table width="600" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08);">

        <!-- Cabecera -->
        <tr>
          <td style="background:#1e293b;padding:24px 40px;">
            <p style="margin:0;font-size:22px;font-weight:700;color:#fff;">
              ⚡ IGWT Store
            </p>
          </td>
        </tr>

        <!-- Cuerpo -->
        <tr>
          <td style="padding:32px 40px;">
            <h2 style="margin:0 0 8px;color:#1e293b;font-size:20px;">Solicitud de devolución recibida ✅</h2>
            <p style="margin:0 0 20px;color:#475569;font-size:15px;">
              Hola <strong>${customerName}</strong>, recibimos tu solicitud de arrepentimiento.
            </p>
            <table width="100%" cellpadding="0" cellspacing="0"
                   style="background:#fffbeb;border-radius:10px;border-left:4px solid #f59e0b;margin-bottom:20px;">
              <tr><td style="padding:16px 20px;">
                <p style="margin:0 0 6px;font-size:11px;color:#b45309;font-weight:700;text-transform:uppercase;letter-spacing:1px;">
                  ⚠️ Condición importante
                </p>
                <p style="margin:0;font-size:14px;color:#78350f;line-height:1.6;">
                  Toda la mercadería debe encontrarse en el <strong>mismo estado en que la recibiste</strong>,
                  en perfecto estado y con su embalaje original. De lo contrario, la solicitud podrá ser rechazada.
                </p>
              </td></tr>
            </table>
            <p style="margin:0 0 8px;font-size:14px;color:#475569;"><strong>Tu motivo:</strong></p>
            <p style="margin:0 0 24px;font-size:14px;color:#1e293b;background:#f8fafc;padding:12px 16px;border-radius:8px;border:1px solid #e2e8f0;">
              ${returnRequest.reason}
            </p>
            <p style="margin:0;font-size:14px;color:#475569;line-height:1.6;">
              Revisaremos tu solicitud a la brevedad y te notificaremos por email con la resolución.
              El plazo legal de arrepentimiento es de <strong>10 días hábiles</strong> desde que recibiste el producto
              (Ley 24.240 — Defensa del Consumidor).
            </p>
          </td>
        </tr>

        <!-- Pie -->
        <tr>
          <td style="background:#f8fafc;padding:16px 40px;border-top:1px solid #e2e8f0;text-align:center;">
            <p style="margin:0;color:#94a3b8;font-size:11px;">© IGWT Store · Ante cualquier consulta respondé este email.</p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body></html>`;

  try {
    await transporter.sendMail({
      from: `"IGWT Store" <${process.env.SMTP_USER}>`,
      to: toEmail,
      subject: `Solicitud de devolución recibida — IGWT Store`,
      html,
    });
    console.log(`[EMAIL] Confirmación devolución #${returnRequest.id} enviada a ${toEmail}`);
  } catch (err) {
    console.error("[EMAIL ERROR] sendReturnRequestConfirmation:", err.message);
  }
}

// 2. Aprobación: se envían las instrucciones de devolución
async function sendReturnRequestApproved(toEmail, customerName, returnRequest) {
  const transporter = createTransporter();
  if (!transporter) {
    console.log(`[EMAIL OMITIDO - SMTP no configurado] Aprobación devolución #${returnRequest.id} a ${toEmail}`);
    return;
  }

  const html = `
<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;">
    <tr><td align="center">
      <table width="600" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08);">

        <tr>
          <td style="background:#1e293b;padding:24px 40px;">
            <p style="margin:0;font-size:22px;font-weight:700;color:#fff;">⚡ IGWT Store</p>
          </td>
        </tr>

        <tr>
          <td style="padding:32px 40px;">
            <h2 style="margin:0 0 8px;color:#15803d;font-size:20px;">✅ Solicitud de devolución aprobada</h2>
            <p style="margin:0 0 20px;color:#475569;font-size:15px;">
              Hola <strong>${customerName}</strong>, tu solicitud de devolución para el
              <strong>Pedido #${returnRequest.orderId}</strong> fue <strong>aprobada</strong>.
            </p>
            <table width="100%" cellpadding="0" cellspacing="0"
                   style="background:#f0fdf4;border-radius:10px;border-left:4px solid #22c55e;margin-bottom:20px;">
              <tr><td style="padding:16px 20px;">
                <p style="margin:0 0 8px;font-size:11px;color:#15803d;font-weight:700;text-transform:uppercase;letter-spacing:1px;">
                  📦 Instrucciones para enviar tu devolución
                </p>
                <p style="margin:0;font-size:14px;color:#166534;line-height:1.7;white-space:pre-line;">${returnRequest.adminNotes}</p>
              </td></tr>
            </table>
            <table width="100%" cellpadding="0" cellspacing="0"
                   style="background:#fffbeb;border-radius:10px;border-left:4px solid #f59e0b;margin-bottom:20px;">
              <tr><td style="padding:14px 20px;">
                <p style="margin:0;font-size:14px;color:#78350f;line-height:1.6;">
                  ⚠️ Recordá que <strong>toda la mercadería debe estar en el mismo estado en que la recibiste</strong>,
                  en perfecto estado y con su embalaje original.
                </p>
              </td></tr>
            </table>
            <p style="margin:0;font-size:14px;color:#475569;">
              Una vez que recibamos el paquete, procesaremos el reembolso correspondiente.
              Ante cualquier duda, respondé este email o contactanos por WhatsApp.
            </p>
          </td>
        </tr>

        <tr>
          <td style="background:#f8fafc;padding:16px 40px;border-top:1px solid #e2e8f0;text-align:center;">
            <p style="margin:0;color:#94a3b8;font-size:11px;">© IGWT Store · Gracias por tu paciencia.</p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body></html>`;

  try {
    await transporter.sendMail({
      from: `"IGWT Store" <${process.env.SMTP_USER}>`,
      to: toEmail,
      subject: `Devolución aprobada — Pedido #${returnRequest.orderId} — IGWT Store`,
      html,
    });
    console.log(`[EMAIL] Aprobación devolución #${returnRequest.id} enviada a ${toEmail}`);
  } catch (err) {
    console.error("[EMAIL ERROR] sendReturnRequestApproved:", err.message);
  }
}

// 3. Rechazo: se informa el motivo
async function sendReturnRequestRejected(toEmail, customerName, returnRequest) {
  const transporter = createTransporter();
  if (!transporter) {
    console.log(`[EMAIL OMITIDO - SMTP no configurado] Rechazo devolución #${returnRequest.id} a ${toEmail}`);
    return;
  }

  const html = `
<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;">
    <tr><td align="center">
      <table width="600" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08);">

        <tr>
          <td style="background:#1e293b;padding:24px 40px;">
            <p style="margin:0;font-size:22px;font-weight:700;color:#fff;">⚡ IGWT Store</p>
          </td>
        </tr>

        <tr>
          <td style="padding:32px 40px;">
            <h2 style="margin:0 0 8px;color:#dc2626;font-size:20px;">❌ Solicitud de devolución no aprobada</h2>
            <p style="margin:0 0 20px;color:#475569;font-size:15px;">
              Hola <strong>${customerName}</strong>, lamentablemente tu solicitud de devolución para el
              <strong>Pedido #${returnRequest.orderId}</strong> no pudo ser aprobada.
            </p>
            <table width="100%" cellpadding="0" cellspacing="0"
                   style="background:#fef2f2;border-radius:10px;border-left:4px solid #ef4444;margin-bottom:20px;">
              <tr><td style="padding:16px 20px;">
                <p style="margin:0 0 8px;font-size:11px;color:#b91c1c;font-weight:700;text-transform:uppercase;letter-spacing:1px;">
                  Motivo del rechazo
                </p>
                <p style="margin:0;font-size:14px;color:#7f1d1d;line-height:1.7;white-space:pre-line;">${returnRequest.adminNotes}</p>
              </td></tr>
            </table>
            <p style="margin:0;font-size:14px;color:#475569;">
              Si creés que se trata de un error o querés realizar una consulta adicional, respondé este email
              o contactanos por WhatsApp. Estamos para ayudarte.
            </p>
          </td>
        </tr>

        <tr>
          <td style="background:#f8fafc;padding:16px 40px;border-top:1px solid #e2e8f0;text-align:center;">
            <p style="margin:0;color:#94a3b8;font-size:11px;">© IGWT Store · Lamentamos los inconvenientes.</p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body></html>`;

  try {
    await transporter.sendMail({
      from: `"IGWT Store" <${process.env.SMTP_USER}>`,
      to: toEmail,
      subject: `Devolución no aprobada — Pedido #${returnRequest.orderId} — IGWT Store`,
      html,
    });
    console.log(`[EMAIL] Rechazo devolución #${returnRequest.id} enviada a ${toEmail}`);
  } catch (err) {
    console.error("[EMAIL ERROR] sendReturnRequestRejected:", err.message);
  }
}

// ─── Notificaciones de cambio de estado de pedido ───────────────────────────

// Helper que genera el HTML base para notificaciones de estado (sin tabla de productos)
function buildStatusNotifHtml({ orderId, title, subtitle, bodyHtml, footerNote }) {
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

        <!-- Header -->
        <tr>
          <td style="background:#1e293b;padding:28px 40px;text-align:center;">
            <p style="margin:0;color:#94a3b8;font-size:12px;letter-spacing:2px;text-transform:uppercase;">IGWT Store</p>
            <h1 style="margin:6px 0 0;color:#ffffff;font-size:22px;font-weight:700;">${title}</h1>
            <p style="margin:4px 0 0;color:#64748b;font-size:13px;">Pedido #${orderId}</p>
          </td>
        </tr>

        <!-- Subtitulo -->
        <tr>
          <td style="padding:24px 40px 0;text-align:center;">
            <p style="margin:0;color:#475569;font-size:15px;line-height:1.6;">${subtitle}</p>
          </td>
        </tr>

        <!-- Cuerpo -->
        <tr>
          <td style="padding:20px 40px;">
            ${bodyHtml}
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding:0 40px 32px;text-align:center;">
            <p style="margin:0;color:#94a3b8;font-size:11px;line-height:1.6;">${footerNote}</p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// Notificación de cambio de estado de PAGO (APPROVED / REJECTED / CANCELLED)
// No se envía para cotizaciones — esas tienen su propio flujo de emails.
async function sendOrderPaymentStatusEmail(order, newStatus) {
  if (!order.customerEmail) return;
  // Cotizaciones tienen emails propios (approveCotizacion / publishCotizacion)
  if (order.paymentMethod === "COTIZACION") return;

  const transporter = createTransporter();
  if (!transporter) {
    console.log(`[EMAIL OMITIDO - SMTP no configurado] Estado pago pedido #${order.id} → ${newStatus}`);
    return;
  }

  const configs = {
    APPROVED: {
      subject: `✅ Pago confirmado — Pedido #${order.id}`,
      title:   "¡Pago confirmado!",
      subtitle: `Hola ${order.customerName}, confirmamos el pago de tu pedido.`,
      color:   "#16a34a",
      icon:    "✅",
      message: "Tu pedido está confirmado y en breve comenzamos a prepararlo. Te avisaremos cuando esté listo.",
    },
    REJECTED: {
      subject: `❌ Pedido rechazado — #${order.id}`,
      title:   "Pedido rechazado",
      subtitle: `Hola ${order.customerName}, lamentamos informarte que tu pedido fue rechazado.`,
      color:   "#dc2626",
      icon:    "❌",
      message: "Si tenés alguna consulta o creés que se trata de un error, por favor contactanos respondiendo este email.",
    },
    CANCELLED: {
      subject: `🚫 Pedido cancelado — #${order.id}`,
      title:   "Pedido cancelado",
      subtitle: `Hola ${order.customerName}, tu pedido fue cancelado.`,
      color:   "#64748b",
      icon:    "🚫",
      message: "Si cancelaste por error o necesitás hacer un nuevo pedido, podés volver a la tienda en cualquier momento.",
    },
  };

  const cfg = configs[newStatus];
  if (!cfg) return; // PENDING y QUOTE_APPROVED no generan email desde acá

  const bodyHtml = `
    <div style="background:${cfg.color}10;border:1px solid ${cfg.color}30;border-radius:12px;padding:20px;text-align:center;">
      <p style="margin:0 0 8px;font-size:28px;">${cfg.icon}</p>
      <p style="margin:0;color:#1e293b;font-size:15px;line-height:1.6;">${cfg.message}</p>
    </div>`;

  const footerNote = `Podés consultar el estado de tus pedidos iniciando sesión en la tienda.<br>
    Si tenés alguna duda, escribinos a <a href="mailto:info@lsmarket.com.ar" style="color:#3b82f6;">info@lsmarket.com.ar</a>`;

  const html = buildStatusNotifHtml({
    orderId:  order.id,
    title:    cfg.title,
    subtitle: cfg.subtitle,
    bodyHtml,
    footerNote,
  });

  try {
    await transporter.sendMail({
      from:    `"IGWT Store" <${process.env.SMTP_USER}>`,
      to:      order.customerEmail,
      subject: cfg.subject,
      html,
    });
    console.log(`[EMAIL] Estado pago ${newStatus} enviado a ${order.customerEmail} (pedido #${order.id})`);
  } catch (err) {
    console.error("[EMAIL ERROR] sendOrderPaymentStatusEmail:", err.message);
  }
}

// Notificación de cambio de estado logístico (EN_PREPARACION / ENVIADO / ENTREGADO)
// shippingMethod determina si mostrar "listo para retirar" o "en camino"
async function sendOrderFulfillmentEmail(order, newFulfillmentStatus) {
  if (!order.customerEmail) return;

  const transporter = createTransporter();
  if (!transporter) {
    console.log(`[EMAIL OMITIDO - SMTP no configurado] Fulfillment pedido #${order.id} → ${newFulfillmentStatus}`);
    return;
  }

  const isRetiro = order.shippingMethod !== "ENVIO";

  const configs = {
    EN_PREPARACION: {
      subject: `🔧 Tu pedido está en preparación — #${order.id}`,
      title:   "En preparación",
      subtitle: `Hola ${order.customerName}, tu pedido ya está siendo preparado.`,
      color:   "#d97706",
      icon:    "🔧",
      message: "Estamos preparando tu pedido con cuidado. Te avisaremos cuando esté " + (isRetiro ? "listo para retirar." : "en camino."),
    },
    ENVIADO: isRetiro ? {
      subject: `📦 Tu pedido está listo para retirar — #${order.id}`,
      title:   "¡Pedido listo!",
      subtitle: `Hola ${order.customerName}, tu pedido está listo para retirar.`,
      color:   "#2563eb",
      icon:    "📦",
      message: "Podés pasar a retirar tu pedido por nuestro local: <strong>Av. La Plata 744 Timbre 3, CABA</strong>.<br>Coordinamos el horario por WhatsApp al <strong>+54 11 5039-5166</strong>.",
    } : {
      subject: `🚚 Tu pedido está en camino — #${order.id}`,
      title:   "¡En camino!",
      subtitle: `Hola ${order.customerName}, tu pedido fue despachado.`,
      color:   "#2563eb",
      icon:    "🚚",
      message: "Tu pedido ya está en camino. Te contactaremos para coordinar la entrega.",
    },
    ENTREGADO: {
      subject: `✅ Pedido entregado — #${order.id}`,
      title:   "¡Pedido entregado!",
      subtitle: `Hola ${order.customerName}, tu pedido fue entregado. ¡Gracias por tu compra!`,
      color:   "#16a34a",
      icon:    "✅",
      message: "Esperamos que estés muy conforme con tu compra. Si tenés algún inconveniente con el producto, no dudes en contactarnos.",
    },
  };

  const cfg = configs[newFulfillmentStatus];
  if (!cfg) return; // PENDIENTE no genera email

  const bodyHtml = `
    <div style="background:${cfg.color}10;border:1px solid ${cfg.color}30;border-radius:12px;padding:20px;text-align:center;">
      <p style="margin:0 0 8px;font-size:28px;">${cfg.icon}</p>
      <p style="margin:0;color:#1e293b;font-size:15px;line-height:1.6;">${cfg.message}</p>
    </div>`;

  const footerNote = `Podés consultar el estado de tus pedidos iniciando sesión en la tienda.<br>
    Si tenés alguna duda, escribinos a <a href="mailto:info@lsmarket.com.ar" style="color:#3b82f6;">info@lsmarket.com.ar</a>`;

  const html = buildStatusNotifHtml({
    orderId:  order.id,
    title:    cfg.title,
    subtitle: cfg.subtitle,
    bodyHtml,
    footerNote,
  });

  try {
    await transporter.sendMail({
      from:    `"IGWT Store" <${process.env.SMTP_USER}>`,
      to:      order.customerEmail,
      subject: cfg.subject,
      html,
    });
    console.log(`[EMAIL] Fulfillment ${newFulfillmentStatus} enviado a ${order.customerEmail} (pedido #${order.id})`);
  } catch (err) {
    console.error("[EMAIL ERROR] sendOrderFulfillmentEmail:", err.message);
  }
}

// ─── Email de carrito abandonado ────────────────────────────────────────────

async function sendAbandonedCartEmail(customer, cartItems, { couponCode, couponDescription, storeUrl } = {}) {
  const transporter = createTransporter();
  if (!transporter) {
    console.log(`[EMAIL OMITIDO - SMTP no configurado] Carrito abandonado para ${customer.email}`);
    return;
  }

  const baseUrl = storeUrl || process.env.FRONTEND_URL || "http://localhost:3000";
  const url = `${baseUrl}/carrito`;
  const attachments = [];

  const rowsHtml = cartItems.map((item, idx) => {
    const imgPath = item.image ? resolveImagePath(item.image) : null;
    const bg = idx % 2 === 0 ? "#f8fafc" : "#ffffff";
    let imgCell;
    if (imgPath) {
      const cid = `cart-img-${idx}@igwt`;
      attachments.push({ filename: path.basename(imgPath), path: imgPath, cid, contentType: imageMime(imgPath) });
      imgCell = `<img src="cid:${cid}" width="48" height="48" style="border-radius:6px;object-fit:cover;display:block;">`;
    } else {
      imgCell = `<div style="width:48px;height:48px;background:#e2e8f0;border-radius:6px;text-align:center;line-height:48px;font-size:20px;">📦</div>`;
    }
    const variantHtml = item.variantLabel
      ? `<p style="margin:2px 0 0;font-size:11px;color:#94a3b8;">${item.variantLabel}</p>`
      : "";
    return `
      <tr style="background:${bg};">
        <td style="padding:8px 12px;">${imgCell}</td>
        <td style="padding:10px 12px;">
          <p style="margin:0;font-weight:600;color:#1e293b;font-size:13px;">${item.name}</p>
          ${variantHtml}
        </td>
        <td style="padding:10px 12px;color:#475569;font-size:13px;text-align:right;">${formatARS(item.price)}</td>
        <td style="padding:10px 12px;color:#475569;font-size:13px;text-align:center;">${item.quantity}</td>
        <td style="padding:10px 12px;font-weight:700;color:#1e293b;font-size:13px;text-align:right;">${formatARS(item.price * item.quantity)}</td>
      </tr>`;
  }).join("");

  const total = cartItems.reduce((sum, i) => sum + i.price * i.quantity, 0);

  const couponBlock = couponCode ? `
    <tr>
      <td style="padding:0 40px 24px;">
        <table width="100%" cellpadding="0" cellspacing="0"
               style="background:#fffbeb;border-radius:10px;border-left:4px solid #f59e0b;">
          <tr><td style="padding:16px 20px;">
            <p style="margin:0 0 6px;font-size:11px;color:#b45309;font-weight:700;text-transform:uppercase;letter-spacing:1px;">
              🎁 Tu cupón de descuento exclusivo
            </p>
            <p style="margin:0 0 8px;font-size:22px;font-weight:800;color:#92400e;letter-spacing:3px;font-family:monospace;">
              ${couponCode}
            </p>
            ${couponDescription ? `<p style="margin:0;font-size:13px;color:#78350f;">${couponDescription}</p>` : ""}
            <p style="margin:6px 0 0;font-size:12px;color:#b45309;">Usá este código al finalizar tu compra.</p>
          </td></tr>
        </table>
      </td>
    </tr>` : "";

  const html = `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

        <!-- Header -->
        <tr>
          <td style="background:#1e293b;padding:28px 40px;text-align:center;">
            <p style="margin:0;color:#94a3b8;font-size:12px;letter-spacing:2px;text-transform:uppercase;">IGWT Store</p>
            <h1 style="margin:6px 0 0;color:#ffffff;font-size:22px;font-weight:700;">¿Olvidaste algo? 🛒</h1>
            <p style="margin:4px 0 0;color:#64748b;font-size:13px;">Tu carrito te está esperando</p>
          </td>
        </tr>

        <!-- Saludo -->
        <tr>
          <td style="padding:28px 40px 16px;">
            <p style="margin:0;color:#334155;font-size:15px;">Hola <strong>${customer.name}</strong>,</p>
            <p style="margin:8px 0 0;color:#64748b;font-size:14px;">
              Notamos que dejaste productos en tu carrito. ¡Todavía están disponibles para vos!
            </p>
          </td>
        </tr>

        <!-- Tabla de items -->
        <tr>
          <td style="padding:0 40px 8px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border-radius:10px;overflow:hidden;">
              <thead>
                <tr style="background:#1e293b;">
                  <th style="padding:10px 12px;color:#94a3b8;font-size:10px;text-transform:uppercase;letter-spacing:1px;width:60px;"></th>
                  <th style="padding:10px 12px;color:#94a3b8;font-size:10px;text-transform:uppercase;letter-spacing:1px;text-align:left;font-weight:600;">Producto</th>
                  <th style="padding:10px 12px;color:#94a3b8;font-size:10px;text-transform:uppercase;letter-spacing:1px;text-align:right;font-weight:600;">Precio</th>
                  <th style="padding:10px 12px;color:#94a3b8;font-size:10px;text-transform:uppercase;letter-spacing:1px;text-align:center;font-weight:600;">Cant.</th>
                  <th style="padding:10px 12px;color:#94a3b8;font-size:10px;text-transform:uppercase;letter-spacing:1px;text-align:right;font-weight:600;">Subtotal</th>
                </tr>
              </thead>
              <tbody>${rowsHtml}</tbody>
              <tfoot>
                <tr style="background:#3b82f6;">
                  <td colspan="4" style="padding:12px 16px;color:#ffffff;font-weight:700;font-size:14px;">TOTAL</td>
                  <td style="padding:12px 16px;color:#ffffff;font-weight:700;font-size:15px;text-align:right;">${formatARS(total)}</td>
                </tr>
              </tfoot>
            </table>
          </td>
        </tr>

        ${couponBlock}

        <!-- CTA -->
        <tr>
          <td style="padding:${couponCode ? "8px" : "24px"} 40px 32px;text-align:center;">
            <a href="${url}" style="display:inline-block;background:#22c55e;color:#ffffff;font-weight:700;font-size:15px;padding:14px 36px;border-radius:12px;text-decoration:none;letter-spacing:0.5px;">
              Ir a mi carrito →
            </a>
          </td>
        </tr>

        <!-- Pie -->
        <tr>
          <td style="background:#f8fafc;padding:16px 40px;border-top:1px solid #e2e8f0;text-align:center;">
            <p style="margin:0;color:#94a3b8;font-size:11px;">© IGWT Store · Gracias por elegirnos</p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  try {
    await transporter.sendMail({
      from: `"IGWT Store" <${process.env.SMTP_USER}>`,
      to: customer.email,
      subject: `¿Olvidaste algo? Tu carrito te está esperando 🛒`,
      html,
      attachments,
    });
    console.log(`[EMAIL] Recordatorio carrito enviado a ${customer.email}`);
  } catch (err) {
    console.error("[EMAIL ERROR] sendAbandonedCartEmail:", err.message);
  }
}

// ─── Email de reset de contraseña ────────────────────────────────────────────

async function sendPasswordResetEmail(customer, resetUrl) {
  const transporter = createTransporter();
  if (!transporter) {
    console.log(`[EMAIL OMITIDO - SMTP no configurado] Reset password para ${customer.email}`);
    return;
  }
  try {
    const html = `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0f172a;font-family:Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;padding:40px 0">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#1e293b;border-radius:16px;overflow:hidden;max-width:560px;width:100%">
        <tr><td style="background:#1e293b;padding:32px 40px 24px;border-bottom:1px solid #334155;text-align:center">
          <span style="font-size:22px;font-weight:900;color:#ffffff">&#9889; IGWT Store</span>
        </td></tr>
        <tr><td style="padding:36px 40px">
          <h2 style="color:#f1f5f9;font-size:20px;margin:0 0 12px">Restablecer contrase&#241;a</h2>
          <p style="color:#94a3b8;font-size:15px;line-height:1.6;margin:0 0 8px">Hola <strong style="color:#e2e8f0">${customer.name}</strong>,</p>
          <p style="color:#94a3b8;font-size:15px;line-height:1.6;margin:0 0 28px">Recibimos una solicitud para restablecer la contrase&#241;a de tu cuenta. Hac&#233; click en el bot&#243;n de abajo para crear una nueva:</p>
          <table cellpadding="0" cellspacing="0" style="margin:0 auto 28px">
            <tr><td align="center" style="background:#16a34a;border-radius:10px">
              <a href="${resetUrl}" style="display:inline-block;padding:14px 36px;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none">Resetear mi contrase&#241;a &#8594;</a>
            </td></tr>
          </table>
          <p style="color:#64748b;font-size:13px;line-height:1.6;margin:0 0 8px">&#9200; Este enlace expira en <strong style="color:#94a3b8">1 hora</strong>.</p>
          <p style="color:#64748b;font-size:13px;line-height:1.6;margin:0">Si no solicitaste este cambio, pod&#233;s ignorar este email. Tu contrase&#241;a actual sigue siendo la misma.</p>
        </td></tr>
        <tr><td style="background:#0f172a;padding:20px 40px;text-align:center">
          <p style="color:#475569;font-size:12px;margin:0">&#169; ${new Date().getFullYear()} IGWT Store &#8212; Este es un email autom&#225;tico, no respond&#225;s a este mensaje.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
    await transporter.sendMail({
      from: `"IGWT Store" <${process.env.SMTP_USER}>`,
      to: customer.email,
      subject: "Restablecer contraseña — IGWT Store",
      html,
    });
    console.log(`[EMAIL] Reset password enviado a ${customer.email}`);
  } catch (err) {
    console.error("[EMAIL ERROR] sendPasswordResetEmail:", err.message);
  }
}

// ---------------------------------------------------------------------------
// EMAIL DE RESTOCK PARA MAYORISTAS
// Se envía desde el cron job cuando el cliente lleva X días sin comprar.
// Incluye link de desuscripción (opt-out) al pie.
// ---------------------------------------------------------------------------
async function sendMayoristaRestockEmail(customer, unsubscribeUrl) {
  try {
    const transporter = createTransporter();
    if (!transporter) return;

    const storeName = process.env.STORE_NAME || "IGWT Store";
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
    const catalogUrl = `${frontendUrl}/catalogo`;

    const html = `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0f172a;font-family:'Helvetica Neue',Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;padding:40px 20px">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#1e293b;border-radius:12px;overflow:hidden;max-width:600px;width:100%">
        <!-- Header -->
        <tr><td style="background:#1e293b;padding:32px 40px 20px;text-align:center;border-bottom:1px solid #334155">
          <h1 style="color:#22c55e;margin:0;font-size:28px;letter-spacing:-0.5px">${storeName}</h1>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:36px 40px">
          <p style="color:#cbd5e1;font-size:16px;margin:0 0 12px">Hola <strong style="color:#f1f5f9">${customer.name}</strong>,</p>
          <p style="color:#cbd5e1;font-size:16px;line-height:1.6;margin:0 0 24px">
            Hace un tiempo que no hacés un pedido. ¡Tus clientes te están esperando!<br>
            Es hora de reestockearte y tener todo listo.
          </p>
          <div style="text-align:center;margin:32px 0">
            <a href="${catalogUrl}" style="display:inline-block;background:#22c55e;color:#fff;text-decoration:none;padding:14px 36px;border-radius:8px;font-weight:700;font-size:16px;letter-spacing:0.3px">Ver catálogo mayorista</a>
          </div>
          <p style="color:#94a3b8;font-size:14px;line-height:1.5;margin:0">
            Si tenés alguna consulta o querés hacer un pedido especial, respondé este email o contactanos por WhatsApp.
          </p>
        </td></tr>
        <!-- Footer -->
        <tr><td style="background:#0f172a;padding:20px 40px;text-align:center;border-top:1px solid #334155">
          <p style="color:#475569;font-size:12px;margin:0 0 8px">&#169; ${new Date().getFullYear()} ${storeName} &#8212; Este es un email automático.</p>
          <p style="color:#475569;font-size:11px;margin:0">
            <a href="${unsubscribeUrl}" style="color:#64748b;text-decoration:underline">No quiero recibir más recordatorios de este tipo</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

    await transporter.sendMail({
      from: `"${storeName}" <${process.env.SMTP_USER}>`,
      to: customer.email,
      subject: `¡Es hora de reestockearte, ${customer.name}!`,
      html,
    });
    console.log(`[EMAIL] Restock email enviado a ${customer.email}`);
  } catch (err) {
    console.error("[EMAIL ERROR] sendMayoristaRestockEmail:", err.message);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// EMAIL DE RECOMENDACIONES SEMANALES PARA MINORISTAS
// Se envía cada lunes con 4 productos relacionados a la última compra.
// ---------------------------------------------------------------------------
async function sendMinoristaRecommendationEmail(customer, products) {
  try {
    const transporter = createTransporter();
    if (!transporter) return;

    const storeName = process.env.STORE_NAME || "IGWT Store";
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";

    // Cada card: imagen, nombre, precio (con tachado si hay oferta), badge OFERTA, botón "Ver"
    // Linkea a la página individual del producto, no al catálogo genérico
    // Renderizado en grilla 2x2 (más legible en mobile que 1x4)
    const buildCard = (p) => {
      const hasSale = p.salePrice && p.salePrice < p.price;
      const finalPrice = hasSale ? p.salePrice : (p.price ?? 0);
      const imageUrl = p.images?.[0]
        ? p.images[0].startsWith("http")
          ? p.images[0]
          : `${process.env.BACKEND_URL || "http://localhost:4000"}${p.images[0]}`
        : null;
      const productUrl = `${frontendUrl}/producto/${p.id}`;
      const discountPct = hasSale ? Math.round(((p.price - p.salePrice) / p.price) * 100) : 0;

      // HTML del bloque de precio: si hay oferta muestra ambos, si no muestra solo uno
      // pero ocupando el mismo espacio visual. Va dentro de una celda de altura fija.
      const priceBlockHtml = hasSale
        ? `<div style="font-size:12px;line-height:1.4;color:#64748b;text-decoration:line-through">${formatARS(p.price)}</div>
           <div style="font-size:16px;line-height:1.4;color:#ef4444;font-weight:800">${formatARS(finalPrice)}</div>`
        : `<div style="font-size:16px;line-height:1.4;color:#22c55e;font-weight:800;padding-top:18px">${formatARS(finalPrice)}</div>`;

      // Card con altura TOTAL fija (290px) usando el atributo HTML height en cada <td>.
      // Estructura: imagen (140px) + contenido (150px). Dentro del contenido, una tabla anidada
      // con dos filas: arriba título+precio (valign top), abajo botón (valign bottom).
      // Resultado: el botón siempre queda anclado al fondo, sin importar cuánto contenido haya arriba.
      return `
        <td width="25%" valign="top" style="padding:5px">
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0f172a;border:1px solid #334155;border-radius:10px;overflow:hidden">
            <!-- Imagen 140px -->
            <tr><td height="140" valign="top" style="height:140px;position:relative;padding:0;line-height:0">
              <a href="${productUrl}" style="text-decoration:none;display:block">
                ${imageUrl
                  ? `<img src="${imageUrl}" alt="${p.name}" width="100%" height="140" style="display:block;width:100%;height:140px;object-fit:cover;background:#1e293b;border:0">`
                  : `<div style="height:140px;background:#1e293b;text-align:center;line-height:140px;color:#475569;font-size:32px">📦</div>`}
                ${hasSale ? `<div style="position:absolute;top:8px;left:8px;background:#ef4444;color:#fff;font-size:10px;font-weight:800;padding:3px 7px;border-radius:6px;letter-spacing:0.3px">-${discountPct}%</div>` : ""}
              </a>
            </td></tr>
            <!-- Contenido con altura fija 150px — tabla anidada con título arriba y botón abajo -->
            <tr><td height="150" valign="top" style="height:150px;padding:0">
              <table width="100%" height="150" cellpadding="0" cellspacing="0" border="0" style="height:150px">
                <!-- Fila superior: título + precio, alineado al tope -->
                <tr><td valign="top" style="padding:10px 11px 0">
                  <a href="${productUrl}" style="text-decoration:none">
                    <div style="color:#f1f5f9;font-size:13px;font-weight:600;line-height:1.3;height:34px;overflow:hidden;margin-bottom:6px">${p.name}</div>
                  </a>
                  ${priceBlockHtml}
                </td></tr>
                <!-- Fila inferior: botón anclado al fondo con valign bottom -->
                <tr><td valign="bottom" height="40" style="padding:0 11px 11px;height:40px">
                  <a href="${productUrl}" style="display:block;background:#22c55e;color:#fff;text-decoration:none;text-align:center;padding:7px 0;border-radius:6px;font-weight:700;font-size:12px;line-height:1.2">Ver</a>
                </td></tr>
              </table>
            </td></tr>
          </table>
        </td>`;
    };

    // 4 cards en una sola fila (1×4) — ancho ajustado para que entren bien
    const cards = products.slice(0, 4).map(buildCard);
    // Padear con celdas vacías si hay menos de 4 productos
    while (cards.length < 4) cards.push('<td width="25%"></td>');
    const productCards = `<tr>${cards.join("")}</tr>`;

    // Preheader: texto que aparece en la bandeja de entrada antes de abrir el email
    const preheader = `Seleccionamos ${products.length} productos pensando en vos — entrá a verlos.`;

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${storeName}</title>
</head>
<body style="margin:0;padding:0;background:#0f172a;font-family:'Helvetica Neue',Arial,sans-serif">
  <!-- Preheader oculto: aparece en la bandeja antes de abrir -->
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${preheader}</div>

  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;padding:32px 16px">
    <tr><td align="center">
      <table width="800" cellpadding="0" cellspacing="0" style="background:#1e293b;border-radius:14px;overflow:hidden;max-width:800px;width:100%;box-shadow:0 10px 30px rgba(0,0,0,0.3)">
        <!-- Header con gradiente -->
        <tr><td style="background:linear-gradient(135deg,#0f172a 0%,#1e293b 100%);padding:36px 40px 28px;text-align:center;border-bottom:2px solid #22c55e">
          <h1 style="color:#22c55e;margin:0 0 6px;font-size:30px;font-weight:800;letter-spacing:-0.5px">${storeName}</h1>
          <p style="color:#64748b;font-size:13px;margin:0;letter-spacing:0.5px;text-transform:uppercase;font-weight:600">Recomendaciones para vos</p>
        </td></tr>

        <!-- Body -->
        <tr><td style="padding:36px 32px 16px">
          <p style="color:#f1f5f9;font-size:18px;font-weight:600;margin:0 0 6px">¡Hola ${customer.name}! 👋</p>
          <p style="color:#cbd5e1;font-size:15px;line-height:1.6;margin:0 0 28px">
            Seleccionamos estos productos para vos basados en tu última compra. Algunos están en oferta — ¡aprovechá!
          </p>

          <!-- Grilla de cards 2x2 -->
          <table width="100%" cellpadding="0" cellspacing="0">
            ${productCards}
          </table>

          <!-- CTA principal -->
          <div style="text-align:center;margin:32px 0 8px">
            <a href="${frontendUrl}/catalogo" style="display:inline-block;background:#22c55e;color:#fff;text-decoration:none;padding:15px 40px;border-radius:10px;font-weight:700;font-size:15px;letter-spacing:0.3px">Ver todo el catálogo →</a>
          </div>
        </td></tr>

        <!-- Footer -->
        <tr><td style="background:#0f172a;padding:24px 40px;text-align:center;border-top:1px solid #334155">
          <p style="color:#64748b;font-size:12px;line-height:1.6;margin:0 0 4px">¿Tenés alguna pregunta? Respondé este email y te ayudamos.</p>
          <p style="color:#475569;font-size:11px;margin:8px 0 0">&#169; ${new Date().getFullYear()} ${storeName} &#8212; Email automático, no respondas a este mensaje.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

    await transporter.sendMail({
      from: `"${storeName}" <${process.env.SMTP_USER}>`,
      to: customer.email,
      subject: `Productos que te pueden interesar — ${storeName}`,
      html,
    });
    console.log(`[EMAIL] Recomendaciones enviadas a ${customer.email}`);
  } catch (err) {
    console.error("[EMAIL ERROR] sendMinoristaRecommendationEmail:", err.message);
    throw err;
  }
}

module.exports = {
  sendMayoristaRequestEmail,
  sendMayoristaApprovedEmail,
  sendMayoristaRejectedEmail,
  sendOrderConfirmationToCustomer,
  sendOrderNotificationToAdmin,
  sendCotizacionToCustomer,
  sendCotizacionToAdmin,
  sendReturnRequestConfirmation,
  sendReturnRequestApproved,
  sendReturnRequestRejected,
  sendOrderPaymentStatusEmail,
  sendOrderFulfillmentEmail,
  sendAbandonedCartEmail,
  sendPasswordResetEmail,
  sendMayoristaRestockEmail,
  sendMinoristaRecommendationEmail,
};
