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

WORKDIR /app/backend

# 1️⃣ Copy backend package files and install deps
COPY backend/package*.json ./
RUN npm install

# 2️⃣ Copy backend source and config
COPY backend/src ./src
COPY backend/tsconfig.json ./
COPY backend/certs /app/backend/certs

# 3️⃣ Compile backend TypeScript
RUN npx tsc

# 4️⃣ Copy schema.sql into build output
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

# 4️⃣ Copy certs (fix ENOENT)
COPY backend/certs ./certs

# 5 Create uplads folder
RUN mkdir -p /app/backend/uploads

# 6 Expose Fastify API port
EXPOSE 3000

# 7  Start backend server
CMD ["node", "dist/server.js"]
