FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
ENV PORT=4000
ENV DATA_DIR=/data
EXPOSE 4000
CMD ["./node_modules/.bin/tsx", "src/index.ts"]
