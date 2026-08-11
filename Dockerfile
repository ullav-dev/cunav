FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN --mount=type=secret,id=npm_token \
    NODE_AUTH_TOKEN=$(cat /run/secrets/npm_token) npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG NEXT_PUBLIC_APP_VERSION
ARG NEXT_PUBLIC_GIT_SHA
ARG NEXT_PUBLIC_TICKET_PREFIX=UL
ENV NEXT_PUBLIC_APP_VERSION=$NEXT_PUBLIC_APP_VERSION
ENV NEXT_PUBLIC_GIT_SHA=$NEXT_PUBLIC_GIT_SHA
ENV NEXT_PUBLIC_TICKET_PREFIX=$NEXT_PUBLIC_TICKET_PREFIX
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@swc/helpers ./node_modules/@swc/helpers
USER nextjs
EXPOSE 3008
ENV PORT=3008
CMD ["node", "server.js"]
