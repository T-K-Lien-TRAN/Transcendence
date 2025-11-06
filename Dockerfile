# ==========================================================
# 🏗️ Stage 1: Build Frontend
# ==========================================================
FROM node:20-alpine AS frontend-builder

WORKDIR /app/frontend

# 1️⃣ Copy package files and install deps
COPY frontend/package*.json ./
RUN npm install

# 2️⃣ Copy all frontend source files
COPY frontend/ .

# 3️⃣ Build Vite project (compiles .ts -> .js)
RUN npm run build

# ==========================================================
# ⚙️ Stage 2: Build Backend (TypeScript -> JavaScript)
# ==========================================================
FROM node:20-alpine AS backend-builder

# Installer OpenSSL pour la génération des certificats
RUN apk add --no-cache openssl

WORKDIR /app/backend

# 1️⃣ Copy backend package files and install deps
COPY backend/package*.json ./
RUN npm install

# 2️⃣ Copy backend source and config
COPY backend/src ./src
COPY backend/tsconfig.json ./

# 3️⃣ Générer les certificats SSL automatiquement
RUN mkdir -p /app/backend/certs && \
    openssl req -x509 -newkey rsa:4096 -nodes \
    -keyout /app/backend/certs/server.key \
    -out /app/backend/certs/server.crt \
    -days 365 \
    -subj "/C=FR/ST=Alpes-Maritimes/L=Nice/O=42 Nice/OU=42 Nice/CN=localhost/emailAddress=transcendence@42nice.fr"

# 4️⃣ Compile backend TypeScript
RUN npx tsc

# 5️⃣ Copy schema.sql into build output
RUN mkdir -p dist/db && cp src/db/schema.sql dist/db/

# ==========================================================
# 🚀 Stage 3: Runtime
# ==========================================================
FROM node:20-slim

WORKDIR /app/backend

# 1️⃣ Copy production dependencies only
COPY backend/package*.json ./
RUN npm install --omit=dev

# 2️⃣ Copy compiled backend code
COPY --from=backend-builder /app/backend/dist ./dist

# 3️⃣ Copy built frontend (already compiled by Vite)
COPY --from=frontend-builder /app/frontend/dist ./dist/frontend

# 4️⃣ Copy generated certs from build stage
COPY --from=backend-builder /app/backend/certs ./certs

# 5️⃣ Create uploads folder
RUN mkdir -p /app/backend/uploads

# 6️⃣ Expose Fastify API port
EXPOSE 3000

# 7️⃣ Start backend server
CMD ["node", "dist/server.js"]