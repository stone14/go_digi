FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install --frozen-lockfile 2>/dev/null || npm install
COPY . .
RUN mkdir -p public && npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
EXPOSE 3100
ENV PORT=3100
CMD ["node", "server.js"]
