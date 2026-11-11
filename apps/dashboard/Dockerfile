
FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/broker/package.json ./apps/broker/
COPY apps/dashboard/package.json ./apps/dashboard/
COPY packages/javascript-sdk/package.json ./packages/javascript-sdk/

RUN npm ci

COPY apps/dashboard ./apps/dashboard

RUN npm run build:dashboard

FROM nginx:1.27-alpine

COPY --from=build /app/apps/dashboard/dist /usr/share/nginx/html

COPY apps/dashboard/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
