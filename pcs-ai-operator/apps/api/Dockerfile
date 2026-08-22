FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
COPY packages ./packages
COPY apps/api ./apps/api
COPY apps/worker ./apps/worker
COPY apps/web ./apps/web
COPY prisma ./prisma
COPY tsconfig.typecheck.json .eslintrc.cjs ./
RUN npm install
RUN npx prisma generate
RUN npm run build -w @pcs/core && npm run build -w @pcs/backend && npm run build -w @pcs/api
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/api ./apps/api
COPY --from=build /app/prisma ./prisma
CMD ["node","apps/api/dist/index.js"]
