# IGWT Store — E-commerce

Tienda online completa (mayorista + minorista) con panel de administración, carrito,
cotizaciones, pagos con MercadoPago, envíos por Correo Argentino y un asistente de IA
para cargar productos. En producción corre en un VPS propio (igwtstore.com.ar).

## Stack
- **Frontend**: React + Vite + Tailwind CSS (modo claro/oscuro)
- **Backend**: Node.js + Express + Prisma ORM
- **Base de datos**: PostgreSQL
- **Imágenes**: Cloudinary (CDN)
- **Pagos**: MercadoPago (Argentina)
- **Envíos**: Correo Argentino (MiCorreo)
- **IA (opcional)**: Google Gemini (texto/visión) + OpenAI (respaldo de imágenes)
- **Contenedores**: Docker + Docker Compose
- **Producción**: VPS Hostinger (nginx + PM2 + PostgreSQL local) — ver [DEPLOY.md](./DEPLOY.md)

---

## Primeros pasos (Docker)

### 1. Configurar variables de entorno

```bash
cp .env.example .env
```

Editar el `.env` raíz (lo usa Docker Compose). Variables principales:

| Variable | Para qué | Obligatoria |
|---|---|---|
| `DB_USER` / `DB_PASSWORD` / `DB_NAME` | PostgreSQL del contenedor | ✅ |
| `JWT_SECRET` | Firma de tokens (generá uno largo: `openssl rand -hex 64`) | ✅ |
| `MP_ACCESS_TOKEN` | Token de MercadoPago | ✅ (para pagos) |
| `FRONTEND_URL` / `BACKEND_URL` | URLs públicas (CORS + back_urls de MP) | ✅ en prod |
| `CLOUDINARY_CLOUD_NAME` / `_API_KEY` / `_API_SECRET` | Subida de imágenes | ✅ |
| `SMTP_USER` / `SMTP_PASS` / `ADMIN_EMAIL` | Emails (Gmail con contraseña de aplicación) | opcional |
| `GEMINI_API_KEY` | Asistente de IA (texto: título/descripción/SKU) | opcional |
| `OPENAI_API_KEY` | Respaldo de IA para generar fotos | opcional |

> Si faltan `GEMINI_API_KEY` / `OPENAI_API_KEY`, el sitio funciona igual; solo quedan
> deshabilitados los botones del asistente de IA.

### 2. Levantar

```bash
docker compose up --build
```

Cuando termine:
- 🌐 **Tienda**: http://localhost:3000
- ⚙️ **Admin**: http://localhost:3000/admin
- 🔧 **API**: http://localhost:4000

### 3. Cargar datos iniciales (seed)

```bash
docker compose exec backend npm run seed
```

Crea el usuario admin (`admin@tienda.com` / `admin123`) y las categorías base.

> ⚠️ **Cambiá la contraseña del admin después del primer login.**

---

## Desarrollo local (sin Docker)

### Backend
```bash
cd backend
npm install
# Crear backend/.env con DATABASE_URL apuntando a tu PostgreSQL local
npx prisma generate
npx prisma db push     # el proyecto usa db push (schema-first), no migraciones
npm run seed
npm run dev
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

---

## Funcionalidades

### Tienda (cliente)
- Catálogo con búsqueda, filtros por atributos y categorías (con subcategorías)
- Precios diferenciados **minorista / mayorista** según el tipo de cuenta
- Ofertas y **descuentos por cantidad** (price tiers)
- Variantes de producto (color, medida, etc.) con stock y precio propios
- Carrito, checkout y pago con MercadoPago
- Envío por **Correo Argentino** (cotización por CP) o retiro en local
- Favoritos, perfil, historial de pedidos
- **Cotizaciones** para clientes mayoristas
- Solicitud de **devolución / arrepentimiento** (Ley 24.240)
- Modo claro/oscuro

### Panel de administración (`/admin`)
- 📊 **Dashboard** y 📈 **Métricas** (ventas, ganancias por costo)
- 📦 **Productos**: imágenes múltiples, costo (interno) + IVA, precios minorista/mayorista
  con ofertas, descuentos por cantidad, **variantes y atributos**, **SKU**, dimensiones,
  **proveedor**, **ubicación en depósito (módulo + estante)**, visibilidad por tipo de
  cliente (y el form muestra solo los precios relevantes), y un **asistente de IA** que
  autocompleta título/descripción/SKU desde la foto y puede generar fotos similares
- 🏷️ **Categorías** con subcategorías
- 🧑‍🤝‍🧑 **Proveedores** (lista dinámica, alta inline desde el producto)
- 🛒 **Órdenes**: estados de pago y de preparación (fulfillment), impresión del pedido
  (con ubicación de depósito para separar), modificación post-venta y **orden de compra
  a proveedores** (agrupada por proveedor, con costos)
- 📝 **Cotizaciones** (mayoristas)
- 👥 **Clientes** (minorista/mayorista, aprobación, solicitudes)
- 💰 **Caja / Gastos** y 🧾 **Compras** de stock
- 🎟️ **Cupones**
- 🖼️ Carrusel / banner de la home, ⚙️ Configuración (incl. modo mantenimiento)
- Modo claro/oscuro del panel

---

## MercadoPago

1. Entrá a https://www.mercadopago.com.ar/developers/panel/app y creá una aplicación.
2. Usá el **Access Token de TEST** para pruebas y el de **PRODUCCIÓN** en el VPS.
3. El webhook (`/api/payments/webhook`) necesita URL pública — en dev usá ngrok.
4. Tarjetas de prueba: https://www.mercadopago.com.ar/developers/es/docs/checkout-pro/additional-content/your-integrations/test/cards

---

## Asistente de IA (opcional)

Un solo proveedor cubre texto e imágenes, con **fallback** para máxima disponibilidad:
- **Texto/visión** (título, descripción y SKU desde la foto): **Google Gemini** — gratis en el nivel free.
- **Imágenes** (fotos similares del producto): se intenta **Gemini** y, si falla/no tiene cuota, **OpenAI** (`gpt-image-1`).

Para activarlo, poné `GEMINI_API_KEY` (y opcional `OPENAI_API_KEY`) en el `.env`.

> ⚠️ La **generación de imágenes** no está incluida en el nivel gratuito de Gemini
> (requiere activar facturación) y en OpenAI se paga por imagen. El **texto** sí es gratis.
> Las fotos generadas las elige el admin antes de publicar (no se agregan solas).

---

## Despliegue en producción

El proyecto corre en un VPS Hostinger (Ubuntu + nginx + PM2 + PostgreSQL local).
La guía completa (setup desde cero + actualizaciones) está en **[DEPLOY.md](./DEPLOY.md)**.

Actualización rápida (en el VPS):
```bash
cd ~/Ecommerce_mm && git pull
cd backend && npm install --omit=dev && npx prisma generate && npx prisma db push && pm2 restart igwtstore-backend
cd ../frontend && npm install && npm run build && sudo cp -r dist/* /var/www/igwtstore/frontend/
```

---

## Estructura del proyecto

```
Eccomerce_mm/
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma      # Modelos de la DB
│   │   └── seed.js            # Datos iniciales
│   ├── src/
│   │   ├── controllers/       # Lógica de negocio (productos, órdenes, IA, proveedores...)
│   │   ├── middleware/        # Auth + upload (Cloudinary)
│   │   ├── routes/            # Definición de rutas /api/*
│   │   ├── services/          # Email, MercadoPago, MiCorreo, etc.
│   │   └── index.js           # Entry point (CORS, montaje de rutas)
│   └── uploads/               # (legado) imágenes locales; las nuevas van a Cloudinary
├── frontend/
│   └── src/
│       ├── components/        # Navbar, ProductCard, CartDrawer, admin/...
│       ├── context/           # CartContext, AuthContext, SiteConfig...
│       ├── pages/
│       │   ├── Home, Catalog, ProductDetail, Checkout...
│       │   └── admin/         # Panel de administración
│       └── services/api.js    # Cliente HTTP (axios)
├── deploy/                    # nginx.conf + ecosystem.config.cjs (PM2)
├── docker-compose.yml
├── DEPLOY.md                  # Guía de despliegue en el VPS
└── .env
```

---

## Notas
- La base usa **`prisma db push`** (schema-first); no hay carpeta de migraciones. Cualquier
  cambio en `schema.prisma` requiere `db push` (en prod, el `start` lo corre automáticamente).
- Las imágenes nuevas se suben a **Cloudinary**; sólo el admin ve costo, proveedor y ubicación de depósito.
- Modo oscuro: el admin usa la clase `.admin-dark` y la tienda `[data-theme="oscuro"]`;
  para componentes nuevos usá el patrón `clase-clara dark:clase-oscura`.
