FROM node:20-alpine AS frontend-builder
WORKDIR /app
RUN corepack enable && corepack prepare yarn@1.22.22 --activate
COPY package.json yarn.lock ./
COPY frontend ./frontend
RUN yarn install --frozen-lockfile --network-timeout 600000 --network-concurrency 4 \
    && yarn build:frontend

FROM node:20-alpine AS backend-builder
WORKDIR /app
RUN apk add --no-cache python3 make g++ gcc \
    && corepack enable \
    && corepack prepare yarn@1.22.22 --activate
COPY package.json yarn.lock tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN yarn install --frozen-lockfile --network-timeout 600000 --network-concurrency 4 \
    && yarn build:backend \
    && yarn install --frozen-lockfile --production=true --prefer-offline --network-timeout 600000

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    DB_PATH=/data/telemetry.sqlite
RUN apk add --no-cache libstdc++ \
    && mkdir -p /data \
    && chown node:node /data
COPY --from=backend-builder --chown=node:node /app/package.json ./package.json
COPY --from=backend-builder --chown=node:node /app/node_modules ./node_modules
COPY --from=backend-builder --chown=node:node /app/dist ./dist
COPY --from=frontend-builder --chown=node:node /app/frontend/dist ./frontend/dist
VOLUME ["/data"]
EXPOSE 8080
USER node
CMD ["node", "dist/index.js"]
