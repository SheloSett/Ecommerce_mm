const nodemailer = require("nodemailer");
const PDFDocument = require("pdfkit");
const path = require("path");
const fs = require("fs");

// Crea el transporte solo si las variables de entorno de SMTP están configuradas
function createTransporter() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_USER || !SMTP_PASS) return null;

  return nodemailer.createTransport({
    host: SMTP_HOST || "smtp.gmail.com",
    port: parseInt(SMTP_PORT) || 587,
    secure: false,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
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

      // Imagen — pdfkit solo soporta JPG y PNG (no WebP)
      const imgName = item.product?.images?.[0] || null;
      const imgPath = imgName && isPdfCompatible(imgName) ? resolveImagePath(imgName) : null;
      if (imgPath) {
        try {
          doc.image(imgPath, cx + 4, rowY + 6, { width: 40, height: 40, fit: [40, 40] });
        } catch (_) {
          // ignorar si la imagen no se puede cargar
          doc.rect(cx + 4, rowY + 6, 40, 40).fill("#cbd5e1");
        }
      } else {
        // Placeholder gris para WebP u otras imágenes no soportadas
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
    const imgPath = imgName ? resolveImagePath(imgName) : null;
    const name    = item.product?.name || item.name || "Producto";
    const bg      = idx % 2 === 0 ? "#f8fafc" : "#ffffff";

    let imgCell;
    if (imgPath) {
      const cid = `img-${idx}@igwt`;
      attachments.push({
        filename:    path.basename(imgPath),
        path:        imgPath,
        cid,
        contentType: imageMime(imgPath),
      });
      imgCell = `<img src="cid:${cid}" width="48" height="48" style="border-radius:6px;object-fit:cover;display:block;">`;
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

module.exports = {
  sendMayoristaRequestEmail,
  sendMayoristaApprovedEmail,
  sendMayoristaRejectedEmail,
  sendOrderConfirmationToCustomer,
  sendOrderNotificationToAdmin,
  sendCotizacionToCustomer,
  sendCotizacionToAdmin,
};
