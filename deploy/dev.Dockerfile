FROM node:22-alpine
ARG APP_DIR
WORKDIR /src
COPY ${APP_DIR}/package.json ${APP_DIR}/package-lock.json ./
RUN npm ci
ENV CHOKIDAR_USEPOLLING=1
EXPOSE 5173
CMD ["sh", "-c", "if [ ! -x node_modules/.bin/vite ] || ! cmp -s package-lock.json node_modules/.package-lock.json; then npm ci && cp package-lock.json node_modules/.package-lock.json; fi && exec npm run dev"]
