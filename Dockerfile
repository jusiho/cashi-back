# ── Stage 1: deps ───────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app

RUN apk add --no-cache libc6-compat python3 make g++

COPY package*.json ./
RUN npm ci --legacy-peer-deps

# ── Stage 2: build ──────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

RUN apk add --no-cache libc6-compat python3 make g++

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NODE_ENV=production

# Compile TypeScript (config/, src/, database/) → dist/
# then build the Strapi admin panel
RUN npx tsc && npm run build

# ── Stage 3: runner ─────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

RUN apk add --no-cache libc6-compat

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 strapi && \
    adduser  --system --uid 1001 strapi

COPY --from=builder --chown=strapi:strapi /app/package*.json ./
COPY --from=builder --chown=strapi:strapi /app/node_modules  ./node_modules
# dist/ contains compiled config/, src/, database/ + admin panel
COPY --from=builder --chown=strapi:strapi /app/dist          ./dist
# public/ for static files & uploads (no TS here)
COPY --from=builder --chown=strapi:strapi /app/public        ./public

RUN mkdir -p .tmp && chown -R strapi:strapi .tmp

USER strapi

EXPOSE 1337

CMD ["npm", "run", "start"]
