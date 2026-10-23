FROM node:22-alpine AS admin
WORKDIR /src
COPY apps/admin/package.json apps/admin/package-lock.json ./
RUN npm ci
COPY apps/admin/ ./
RUN npm run build

FROM node:22-alpine AS share
WORKDIR /src
COPY apps/share-web/package.json apps/share-web/package-lock.json ./
RUN npm ci
COPY apps/share-web/ ./
RUN npm run build

FROM node:22-alpine AS board
WORKDIR /src
COPY apps/whiteboard-web/package.json apps/whiteboard-web/package-lock.json ./
RUN npm ci
COPY apps/whiteboard-web/ ./
RUN npm run build

FROM nginx:1.27-alpine
RUN apk add --no-cache openssl \
 && mkdir -p /etc/nginx/certs \
 && openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
      -keyout /etc/nginx/certs/privkey.pem \
      -out /etc/nginx/certs/fullchain.pem \
      -subj "/CN=localhost"
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=admin /src/dist /usr/share/nginx/html/admin
COPY --from=share /src/dist /usr/share/nginx/html/share
COPY --from=board /src/dist /usr/share/nginx/html/board
HEALTHCHECK --interval=10s --timeout=5s --retries=5 --start-period=15s \
  CMD wget -q --spider http://127.0.0.1/health || exit 1
