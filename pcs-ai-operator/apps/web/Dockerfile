FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
COPY apps/web ./apps/web
RUN npm install
RUN npm run build -w @pcs/web
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
CMD ["node","apps/web/server.js"]
