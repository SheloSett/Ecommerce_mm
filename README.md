# TechStore - E-commerce de Tecnología

Tienda online completa con panel de administración, carrito y pago con MercadoPago.

## Stack
- **Frontend**: React + Vite + Tailwind CSS
- **Backend**: Node.js + Express + Prisma ORM
- **Base de datos**: PostgreSQL
- **Pagos**: MercadoPago (Argentina)
- **Contenedores**: Docker + Docker Compose

---

## Primeros pasos

### 1. Configurar variables de entorno

```bash
cp .env.example .env
```

Editar `.env` con tus datos:
- `MP_ACCESS_TOKEN`: Tu token de MercadoPago (obtenerlo en https://www.mercadopago.com.ar/developers)
- `JWT_SECRET`: Una clave secreta larga y aleatoria

### 2. Levantar con Docker

```bash
docker compose up --build
```

La primera vez tardará unos minutos. Cuando termine:
- 🌐 **Tienda**: http://localhost:3000
- ⚙️ **Admin**: http://localhost:3000/admin
- 🔧 **API**: http://localhost:4000/api/health

### 3. Cargar datos iniciales

```bash
docker compose exec backend npm run seed
```

Esto crea:
- Usuario admin: `admin@tienda.com` / `admin123`
- Categorías base (Cables, Auriculares, Cargadores, etc.)

> ⚠️ **Cambiá la contraseña del admin después del primer login!**

---

## Desarrollo local (sin Docker)

### Backend
```bash
cd backend
npm install
# Crear el archivo .env con DATABASE_URL apuntando a tu PostgreSQL local
npx prisma migrate dev
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

## MercadoPago - Configuración

1. Entrá a https://www.mercadopago.com.ar/developers/panel/app
2. Creá una nueva aplicación
3. Copiá el **Access Token de TEST** para pruebas
4. Para producción, usá el **Access Token de PRODUCCIÓN**

Para probar pagos en modo TEST, usá las tarjetas de prueba de MercadoPago:
- https://www.mercadopago.com.ar/developers/es/docs/checkout-pro/additional-content/your-integrations/test/cards

---

## Estructura del proyecto

```
Eccomerce_mm/
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma      # Modelos de la DB
│   │   └── seed.js            # Datos iniciales
│   ├── src/
│   │   ├── controllers/       # Lógica de negocio
│   │   ├── middleware/        # Auth + Upload
│   │   ├── routes/            # Definición de rutas
│   │   └── index.js           # Entry point
│   └── uploads/               # Imágenes subidas
├── frontend/
│   └── src/
│       ├── components/        # Navbar, ProductCard, CartDrawer...
│       ├── context/           # CartContext, AuthContext
│       ├── pages/
│       │   ├── Home, Catalog, ProductDetail, Checkout...
│       │   └── admin/         # Panel de administración
│       └── services/api.js    # Cliente HTTP (axios)
├── docker-compose.yml
└── .env
```

---

## Panel de Admin

Acceder a `/admin` con las credenciales del seed.

Funcionalidades:
- 📊 **Dashboard**: estadísticas de ventas y órdenes recientes
- 📦 **Productos**: crear, editar, eliminar con múltiples imágenes
- 🏷️ **Categorías**: organizar el catálogo
- 🛒 **Órdenes**: ver y gestionar pedidos con cambio de estado
