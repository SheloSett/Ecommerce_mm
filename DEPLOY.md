# Deploy en VPS Hostinger — guía paso a paso

> ## ⚠️ LEER PRIMERO — el runtime cambió a Docker
>
> Las secciones 1 a 12 de abajo describen el **setup original con PM2**, que YA NO es el que corre
> en el VPS. Se dejan como registro de cómo se armó el server (Postgres, nginx, SSL y backups
> siguen siendo exactamente eso), pero **el backend y el frontend hoy corren en contenedores
> Docker**, definidos en `deploy/docker-compose.vps.yml`:
>
> | | Cómo corre hoy |
> |---|---|
> | Backend | contenedor `igwtstore_backend`, `network_mode: host` → escucha el 4000 del VPS |
> | Frontend | contenedor `igwtstore_frontend` → `127.0.0.1:8090`, proxyeado por el nginx del VPS |
> | Postgres | **bare-metal en el VPS** (`localhost:5432`), fuera de Docker |
> | PM2 | ya no se usa — `pm2 list` vacío es lo NORMAL, no un problema |
>
> **Para actualizar el código, andá directo a [Operaciones diarias](#operaciones-diarias).**
>
> _(Nota: esto se descubrió el 2026-08-12 durante un deploy, siguiendo los pasos de PM2 de este
> mismo archivo, que ya estaban desactualizados. Casi se arranca un segundo backend en el 4000
> encima del contenedor.)_

Esta guía te lleva desde un VPS vacío hasta la app funcionando con dominio + SSL + backups.

**Tiempo estimado:** 2-3 horas el primer setup + 30 min por cada actualización futura.

**Pre-requisitos:**
- VPS Hostinger KVM 2 ya comprado, con Ubuntu 22.04 LTS instalado
- IP pública del VPS (Hostinger te la da en el panel)
- Tu dominio comprado (puede ser en Hostinger o cualquier registrar)
- Acceso SSH al VPS (Hostinger te da las credenciales root)

---

## 1. Conexión inicial y hardening del VPS

Desde tu PC abrí PowerShell:

```bash
ssh root@IP_DE_TU_VPS
# Contraseña: la que te dio Hostinger
```

Actualizar todo:
```bash
apt update && apt upgrade -y
```

Crear un usuario no-root (más seguro que andar como root):
```bash
adduser shelo            # Te pide contraseña — ponele una fuerte
usermod -aG sudo shelo   # Permite usar sudo
```

Permitir SSH al nuevo usuario:
```bash
mkdir -p /home/shelo/.ssh
cp /root/.ssh/authorized_keys /home/shelo/.ssh/ 2>/dev/null || true
chown -R shelo:shelo /home/shelo/.ssh
chmod 700 /home/shelo/.ssh
```

Desconectarse y reconectarse como el nuevo usuario:
```bash
exit
ssh shelo@IP_DE_TU_VPS
```

Configurar el firewall (ufw):
```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'   # Abre puertos 80 y 443
sudo ufw enable                # Confirmar con 'y'
sudo ufw status                # Verificar
```

---

## 2. Instalar Node.js 20, nginx, PostgreSQL, PM2

### Node.js 20 (vía NodeSource)
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v   # Debe imprimir v20.x.x
npm -v
```

### PostgreSQL 16
```bash
sudo apt install -y postgresql postgresql-contrib
sudo systemctl status postgresql   # Verificar que esté running
```

### nginx
```bash
sudo apt install -y nginx
sudo systemctl status nginx
```

### PM2 (process manager)
```bash
sudo npm install -g pm2
```

### Git + herramientas básicas
```bash
sudo apt install -y git build-essential
```

---

## 3. Configurar PostgreSQL local

Crear usuario y base de datos:
```bash
sudo -u postgres psql
```

Dentro del prompt de psql:
```sql
CREATE USER ecommerce_user WITH PASSWORD 'PONER_UNA_PASS_FUERTE_ACA';
CREATE DATABASE ecommerce_db OWNER ecommerce_user;
GRANT ALL PRIVILEGES ON DATABASE ecommerce_db TO ecommerce_user;
\q
```

Verificar conexión con el nuevo usuario:
```bash
psql -U ecommerce_user -d ecommerce_db -h localhost
# Si pide password, ponele la que creaste arriba
# Si conecta, salí con: \q
```

**Si no te deja conectar:** editá `/etc/postgresql/16/main/pg_hba.conf` y cambiá la línea `local all all peer` a `local all all md5`, después `sudo systemctl restart postgresql`.

---

## 4. Clonar el repo y configurar el código

```bash
cd ~
git clone https://github.com/SheloSett/Ecommerce_mm.git
cd Ecommerce_mm/backend
```

### Configurar el .env del backend
```bash
cp .env.production.example .env
nano .env
```

Editar y poner los valores reales:
- `DATABASE_URL=postgresql://ecommerce_user:LA_PASS_QUE_PUSISTE@localhost:5432/ecommerce_db?schema=public`
- `JWT_SECRET=` (generar con `openssl rand -hex 64`)
- `MP_ACCESS_TOKEN=` (tu token de producción de MercadoPago)
- `FRONTEND_URL=https://igwtstore.com.ar` (tu dominio)
- `BACKEND_URL=https://igwtstore.com.ar`
- `ADMIN_EMAIL`, `SMTP_USER`, `SMTP_PASS` (Gmail + contraseña de aplicación)
- `CLOUDINARY_*` (los que ya tenés en Render)

Guardar: `Ctrl+O`, `Enter`, `Ctrl+X`.

### Instalar dependencias del backend
```bash
npm install --omit=dev   # No instala devDependencies, ahorra espacio
```

### Generar Prisma client y crear las tablas
```bash
npx prisma generate
npx prisma db push       # Crea todas las tablas según schema.prisma
```

### Crear el usuario admin inicial
```bash
node prisma/seed.js
```
Por defecto crea: `admin@tienda.com` / `admin123`. Cambialo después desde el panel.

---

## 5. Migrar datos desde Supabase (si los querés mantener)

**En tu PC (no en el VPS):**

```bash
cd "c:/Users/shelo/Desktop/COSAS SHELO/Por_Claude/Eccomerce_mm/backend"
# Sacar la DATABASE_URL de Supabase del .env de Render
pg_dump "postgresql://USER:PASS@HOST:5432/postgres" --no-owner --no-acl > supabase_backup.sql
```

Subir el dump al VPS:
```bash
scp supabase_backup.sql shelo@IP_DEL_VPS:~/
```

En el VPS, restaurar:
```bash
cd ~
psql -U ecommerce_user -d ecommerce_db -h localhost < supabase_backup.sql
```

---

## 6. Build del frontend y deploy

En el VPS:
```bash
cd ~/Ecommerce_mm/frontend
```

Crear `.env.production`:
```bash
nano .env.production
```
Contenido:
```
VITE_API_URL=https://igwtstore.com.ar
```
Guardar.

```bash
npm install
npm run build
```

Mover el build a la carpeta que sirve nginx:
```bash
sudo mkdir -p /var/www/igwtstore/frontend
sudo cp -r dist/* /var/www/igwtstore/frontend/
sudo chown -R www-data:www-data /var/www/igwtstore
```

---

## 7. Configurar nginx

Copiar la config:
```bash
sudo cp ~/Ecommerce_mm/deploy/nginx.conf /etc/nginx/sites-available/igwtstore
```

Editar y reemplazar `igwtstore.com.ar` por tu dominio real:
```bash
sudo nano /etc/nginx/sites-available/igwtstore
```

Activar el sitio y desactivar el default:
```bash
sudo ln -s /etc/nginx/sites-available/igwtstore /etc/nginx/sites-enabled/
sudo rm /etc/nginx/sites-enabled/default
sudo nginx -t              # Verificar sintaxis
sudo systemctl reload nginx
```

---

## 8. Apuntar el dominio al VPS

En tu registrar de dominio (donde compraste el dominio):
- Tipo `A`, nombre `@`, valor: IP del VPS
- Tipo `A`, nombre `www`, valor: IP del VPS

Esperá 10-60 minutos a que propague. Probá con:
```bash
ping igwtstore.com.ar      # Debe responder con la IP del VPS
```

---

## 9. SSL gratis con Let's Encrypt

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d igwtstore.com.ar -d www.igwtstore.com.ar
```

Te pide email + acepta términos. Listo, ya tenés HTTPS.

El certificado se renueva solo cada 90 días vía cron — no hacés nada más.

---

## 10. Arrancar el backend con PM2

```bash
cd ~/Ecommerce_mm
pm2 start deploy/ecosystem.config.cjs
pm2 save
pm2 startup     # Te imprime un comando — copialo y ejecutalo (es un sudo ...)
```

Verificar que está corriendo:
```bash
pm2 status                       # Debe decir "online"
pm2 logs igwtstore-backend       # Ver logs en vivo (Ctrl+C para salir)
curl localhost:4000/api/products # Debe devolver JSON
```

---

## 11. Probar todo

Andá con el browser a `https://igwtstore.com.ar`:
- ✅ Debe cargar el frontend
- ✅ Debe haber candado verde (SSL OK)
- ✅ El catálogo debe traer productos (API funciona)
- ✅ Login admin debe funcionar en `/admin`

---

## 12. Configurar backups automáticos

```bash
cd ~/Ecommerce_mm/backend/scripts
chmod +x backup-db.sh
mkdir -p ~/backups
```

Probar el script manualmente primero:
```bash
./backup-db.sh
ls -lh ~/backups/   # Debe haber un archivo .sql.gz
```

(Opcional pero recomendado) Instalar rclone para subir a Backblaze B2:
```bash
curl https://rclone.org/install.sh | sudo bash
rclone config       # Crear remote "backblaze" tipo B2
```

Programar con cron (corre cada noche a las 3 AM):
```bash
crontab -e
```
Agregar al final:
```
0 3 * * * /home/shelo/Ecommerce_mm/backend/scripts/backup-db.sh >> /home/shelo/backups/cron.log 2>&1
```

---

## Operaciones diarias

Todo esto asume el setup ACTUAL (Docker). El compose vive en `deploy/docker-compose.vps.yml` y
todos los comandos se corren desde `~/Ecommerce_mm`.

Para no repetir la ruta larga, conviene:
```bash
alias dcv='docker compose -f ~/Ecommerce_mm/deploy/docker-compose.vps.yml'
```

### Ver logs del backend
```bash
docker compose -f deploy/docker-compose.vps.yml logs -f --tail=50 backend
```
Para ver SOLO lo reciente (clave para no confundir errores viejos con actuales):
```bash
docker compose -f deploy/docker-compose.vps.yml logs --since 2m --timestamps backend
```

### Reiniciar el backend
```bash
docker compose -f deploy/docker-compose.vps.yml restart backend
```

### Actualizar el código (deploy normal)

**Paso 0 — SIEMPRE: ver si el schema de la DB quedó atrás.**

Este chequeo NO existía y por eso se rompió el deploy del 2026-08-12: se desplegó código que usaba
las tablas `offers` / `offer_items` que nunca se habían creado en producción. Mirar solo el diff de
los commits NO alcanza — hay que comparar el schema contra la base real, porque el drift se acumula
de deploys anteriores.

```bash
cd ~/Ecommerce_mm/backend
npx prisma migrate diff \
  --from-schema-datasource prisma/schema.prisma \
  --to-schema-datamodel prisma/schema.prisma \
  --script
```

- `-- This is an empty migration.` → la base está al día, seguí al paso 1.
- Sale SQL → hay drift. Resolvelo con [Aplicar cambios de schema](#aplicar-cambios-de-schema-a-mano)
  ANTES de seguir.

**Paso 1 — traer el código y rebuildear:**
```bash
cd ~/Ecommerce_mm
git pull
docker compose -f deploy/docker-compose.vps.yml up -d --build
```

Eso rebuildea las dos imágenes y recrea los contenedores. No hace falta `npm install` ni
`prisma generate` en el host: el código y las dependencias van adentro de las imágenes.

**Paso 2 — verificar:**
```bash
docker ps --filter name=igwtstore
curl -s localhost:4000/api/products -o /dev/null -w "API: %{http_code}\n"
docker compose -f deploy/docker-compose.vps.yml logs --since 2m --timestamps backend
```

En el browser, hard refresh con `Ctrl+Shift+R` (si no, te queda el JS viejo cacheado).

> **Si acabás de crear tablas nuevas, reiniciá el backend.** El motor de Prisma mantiene la conexión
> abierta y sigue tirando "table does not exist" aunque la tabla ya exista:
> `docker compose -f deploy/docker-compose.vps.yml restart backend`

### Aplicar cambios de schema a mano

`prisma db push` pide `--accept-data-loss` con demasiada facilidad (pasó con el `slug`), y ese flag
NO se usa nunca. En su lugar: se genera el SQL, se LEE, y se aplica en una transacción.

```bash
# 1. Backup primero, siempre
~/Ecommerce_mm/backend/scripts/backup-db.sh

# 2. Generar el SQL a un archivo
cd ~/Ecommerce_mm/backend
npx prisma migrate diff \
  --from-schema-datasource prisma/schema.prisma \
  --to-schema-datamodel prisma/schema.prisma \
  --script > /tmp/migracion.sql

# 3. LEERLO antes de correrlo
cat /tmp/migracion.sql
```

Qué mirar en ese SQL:
- `CREATE TABLE` / `ADD COLUMN` / `CREATE INDEX` → aditivo, seguro.
- Cualquier `DROP`, o un `ALTER COLUMN ... SET NOT NULL` sobre una tabla con datos → **frenar** y
  pensarlo, eso sí puede perder información.
- Si usa un tipo enum (`"DiscountType"`, etc.) y no hay un `CREATE TYPE` en el script, es porque el
  enum ya existe. Verificalo:
  ```bash
  psql -U ecommerce_user -d ecommerce_db -h localhost \
    -c "SELECT typname FROM pg_type WHERE typname IN ('DiscountType','CustomerVisibility');"
  ```

```bash
# 4. Aplicar TODO O NADA
psql -U ecommerce_user -d ecommerce_db -h localhost \
  --single-transaction -v ON_ERROR_STOP=1 -f /tmp/migracion.sql

# 5. Confirmar que quedó en sync (tiene que decir "empty migration")
npx prisma migrate diff \
  --from-schema-datasource prisma/schema.prisma \
  --to-schema-datamodel prisma/schema.prisma \
  --script

# 6. Reiniciar el backend para que Prisma vea las tablas nuevas
docker compose -f ~/Ecommerce_mm/deploy/docker-compose.vps.yml restart backend
```

`--single-transaction` + `ON_ERROR_STOP=1` es lo que garantiza que si algo falla se revierte entero
y no quedan tablas a medio crear.

### El compose ya te protege de dos cosas

No las cambies sin entender por qué están:

- **`command: ["node", "src/index.js"]`** pisa el CMD del Dockerfile, que corre
  `prisma db push --accept-data-loss` en cada arranque. Eso está pensado para contenedores de dev
  descartables; contra la base real de producción es destructivo.
- **`volumes: ../backend/uploads:/app/uploads`** deja las imágenes subidas FUERA de la imagen, así
  sobreviven a cada redeploy.

### Método viejo (PM2) — YA NO APLICA

Se deja documentado por si alguna vez se vuelve atrás, pero hoy NO se usa. Si corrés esto con los
contenedores levantados, PM2 va a intentar tomar el puerto 4000 que ya tiene el contenedor
(`network_mode: host`) y va a fallar — o peor, vas a terminar con dos backends peleándose.

```bash
# pm2 logs igwtstore-backend
# pm2 restart igwtstore-backend
#
# cd ~/Ecommerce_mm && git pull
# cd backend && npm install --omit=dev && npx prisma generate
# pm2 restart igwtstore-backend
#
# cd ../frontend && npm install && npm run build
# sudo cp -r dist/* /var/www/igwtstore/frontend/
```

### Deploy puntual: URLs con slug (feature #123 — correr UNA sola vez)

El campo `slug` de productos es `@unique`, y `prisma db push` pide `--accept-data-loss` para
crear esa constraint (falso positivo: es seguro, pero NUNCA usamos ese flag). En su lugar,
aplicar el cambio con estos 3 pasos manuales ANTES del `pm2 restart`:

```bash
cd ~/Ecommerce_mm/backend

# 1. Crear la columna (aditivo, no toca datos)
psql -U ecommerce_user -d ecommerce_db -h localhost -c "ALTER TABLE products ADD COLUMN IF NOT EXISTS slug text;"

# 2. Generar slugs para los productos existentes (idempotente: solo toca los que tienen slug NULL)
npx prisma generate
node prisma/backfill-product-slugs.js

# 3. Crear el índice único (mismo nombre que espera Prisma)
psql -U ecommerce_user -d ecommerce_db -h localhost -c "CREATE UNIQUE INDEX IF NOT EXISTS products_slug_key ON products(slug);"

# Verificar: no debe quedar ninguno sin slug
psql -U ecommerce_user -d ecommerce_db -h localhost -c "SELECT COUNT(*) AS sin_slug FROM products WHERE slug IS NULL;"

pm2 restart igwtstore-backend
```

Después de esto, `npx prisma db push` va a decir "already in sync" (la DB ya coincide con el schema).
Los links viejos `/producto/123` siguen funcionando: el backend acepta id numérico o slug.

### Restaurar desde backup
```bash
gunzip -c ~/backups/ecommerce_db_FECHA.sql.gz | psql -U ecommerce_user -d ecommerce_db -h localhost
```

---

## Troubleshooting rápido

Todos los comandos con `dcv` son `docker compose -f ~/Ecommerce_mm/deploy/docker-compose.vps.yml`.

| Problema | Solución |
|---|---|
| `502 Bad Gateway` en el browser | El backend está caído: `dcv ps` y `dcv restart backend` |
| `table public.X does not exist` | Falta aplicar el schema. Ver [Aplicar cambios de schema](#aplicar-cambios-de-schema-a-mano) |
| Ese error sigue DESPUÉS de crear la tabla | Prisma quedó con la conexión vieja: `dcv restart backend` |
| Logs llenos de un error que ya arreglaste | `--tail` muestra historial. Usá `dcv logs --since 2m --timestamps backend` |
| Error de Postgres en los logs | Verificar DATABASE_URL en `backend/.env`. `sudo systemctl status postgresql` |
| `pm2 list` vacío | **Es lo normal.** Ya no se usa PM2, corre en Docker. |
| SSL no funciona | `sudo certbot renew --dry-run`. Si falla, revisar DNS. |
| Disco lleno | `df -h`. Borrar backups viejos, `docker image prune -a`, o `journalctl --vacuum-time=7d` |
| Cambios no se reflejan | Hard refresh (Ctrl+Shift+R). Si es del backend, `dcv up -d --build` |
| El build del frontend se queda sin memoria | Agregar swap temporal, o buildear en la PC y subir el `dist/` por `scp` |

---

## Cuándo escalar a KVM 4

Si notás que el VPS anda lento, mirá:
```bash
htop          # CPU y RAM en tiempo real
free -h       # Memoria
df -h         # Disco
```

Si la RAM está siempre al 80%+ o el CPU al 70%+ sostenido, conviene upgradear. Hostinger te deja hacerlo desde el panel con ~5 min de downtime.
