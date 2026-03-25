FROM node:20-alpine

# Instalamos OpenSSL porque Prisma lo necesita para ejecutar su motor de base de datos.
# La imagen node:20-alpine es muy minimal y no lo incluye por defecto.
RUN apk add --no-cache openssl

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

RUN npx prisma generate

RUN mkdir -p uploads

EXPOSE 4000

# prisma db push: crea las tablas directamente desde el schema sin necesitar archivos de migración previos.
# Es ideal para el primer arranque. En producción avanzada se usaría prisma migrate deploy.
CMD ["sh", "-c", "npx prisma db push --accept-data-loss && node src/index.js"]
