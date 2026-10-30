FROM node:22-alpine AS builder

WORKDIR /app

ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL

COPY package*.json ./
RUN npm install

COPY . .
# Tests (M9 de la auditoría): si alguno falla, el build se corta y queda andando la versión anterior.
RUN npm test
RUN npm run build

# Servir con nginx
FROM nginx:alpine

COPY --from=builder /app/dist /usr/share/nginx/html

# Configuración nginx para React Router (SPA)
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
