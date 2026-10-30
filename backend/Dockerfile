FROM node:22-alpine

# Instalamos OpenSSL porque Prisma lo necesita para ejecutar su motor de base de datos.
# La imagen node:20-alpine es muy minimal y no lo incluye por defecto.
RUN apk add --no-cache openssl

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

RUN npx prisma generate

# Tests (M9 de la auditoría): si alguno falla, el build se corta y queda andando el contenedor anterior.
# No tocan la base ni mandan emails (todo simulado). Antes no corrían en ningún lado del deploy.
RUN npm test

RUN mkdir -p uploads

EXPOSE 4000

# Secuencia de arranque:
# 1. pre-migrate: guarda asignaciones categoryId → _cat_backup ANTES de que db push las elimine
# 2. prisma db push: aplica el schema nuevo (crea _CategoryToProduct, elimina categoryId)
# 3. post-migrate: restaura las asignaciones desde _cat_backup a _CategoryToProduct
# 4. Inicia el servidor Node
CMD ["sh", "-c", "node scripts/pre-migrate.js && npx prisma db push --accept-data-loss && node scripts/post-migrate.js && node src/index.js"]
