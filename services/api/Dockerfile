FROM node:22-alpine AS dev
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
ENV PORT=4000
ENV DATA_DIR=/data
EXPOSE 4000
CMD ["npm", "run", "dev:docker"]

FROM dev AS start
CMD ["npm", "start"]
