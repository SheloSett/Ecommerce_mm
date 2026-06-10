# Deploy en VPS Hostinger — guía paso a paso

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

### Ver logs del backend
```bash
pm2 logs igwtstore-backend
```

### Reiniciar el backend (después de cambios)
```bash
pm2 restart igwtstore-backend
```

### Actualizar el código (cuando hagas cambios)
```bash
cd ~/Ecommerce_mm
git pull

# Si cambió el backend:
cd backend
npm install --omit=dev
npx prisma generate
npx prisma db push    # Solo si cambió el schema
pm2 restart igwtstore-backend

# Si cambió el frontend:
cd ../frontend
npm install
npm run build
sudo cp -r dist/* /var/www/igwtstore/frontend/
```

### Restaurar desde backup
```bash
gunzip -c ~/backups/ecommerce_db_FECHA.sql.gz | psql -U ecommerce_user -d ecommerce_db -h localhost
```

---

## Troubleshooting rápido

| Problema | Solución |
|---|---|
| `502 Bad Gateway` en el browser | El backend está caído. `pm2 restart igwtstore-backend` |
| `pm2 logs` muestra error de Postgres | Verificar DATABASE_URL en `.env`. `sudo systemctl status postgresql` |
| SSL no funciona | `sudo certbot renew --dry-run`. Si falla, revisar DNS. |
| Disco lleno | `df -h` para ver. Borrar backups viejos o `journalctl --vacuum-time=7d` |
| Cambios no se reflejan | Hard refresh (Ctrl+Shift+R). Si es del backend, `pm2 restart` |

---

## Cuándo escalar a KVM 4

Si notás que el VPS anda lento, mirá:
```bash
htop          # CPU y RAM en tiempo real
free -h       # Memoria
df -h         # Disco
```

Si la RAM está siempre al 80%+ o el CPU al 70%+ sostenido, conviene upgradear. Hostinger te deja hacerlo desde el panel con ~5 min de downtime.
