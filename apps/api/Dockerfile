# apps/api/Dockerfile
FROM node:22-alpine
RUN apk add --no-cache postgresql16-client smbclient
ENV TZ=Asia/Jakarta
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --frozen-lockfile --filter @bms/api...
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN cd apps/api && npx prisma generate && pnpm build
EXPOSE 3000
CMD ["sh", "-c", "cd apps/api && npx prisma migrate deploy && node dist/main.js"]
