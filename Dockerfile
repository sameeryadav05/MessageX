
FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/broker/package.json ./apps/broker/
COPY apps/dashboard/package.json ./apps/dashboard/

RUN npm ci

COPY apps/broker ./apps/broker

RUN npm run build:broker

FROM node:22-alpine

ENV NODE_ENV=production

WORKDIR /app

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/broker/package.json ./apps/broker/package.json
COPY --from=build /app/apps/broker/dist ./apps/broker/dist
COPY --from=build /app/apps/broker/migrations ./apps/broker/migrations

RUN addgroup -S messagex && adduser -S messagex -G messagex

COPY apps/broker/scripts/bootstrap-admin.mjs ./apps/broker/scripts/bootstrap-admin.mjs

USER messagex

EXPOSE 3000 5678

CMD ["node", "apps/broker/dist/server/index.js"]
