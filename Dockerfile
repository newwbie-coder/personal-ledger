FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build && npm prune --omit=dev --ignore-scripts

FROM node:22-alpine
RUN apk add --no-cache openssl postgresql16-client su-exec tini
WORKDIR /app
ENV NODE_ENV=production \
    LEDGER_DATA_DIR=/data \
    BACKUP_DIR=/backups \
    WEB_DIST=/app/apps/web/dist \
    HTTPS_PORT=8443 \
    HTTP_PORT=8080
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/db/package.json packages/db/
COPY --from=build /app/packages/db/dist packages/db/dist
COPY --from=build /app/packages/shared/package.json packages/shared/
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/apps/api/package.json apps/api/
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/web/dist apps/web/dist
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh && mkdir -p /data /backups
EXPOSE 8443 8080
ENTRYPOINT ["/sbin/tini", "--", "/entrypoint.sh"]
CMD ["node", "apps/api/dist/index.js"]
