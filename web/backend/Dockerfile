# Build context must be the web/ directory (parent of backend/ and admin/).
# Uses full node:20 (includes g++/make/python) so Alpine apk is not required
# (some hosts block Alpine package mirrors / TLS).

# Stage 1: backend TypeScript build
FROM node:20 AS backend-build
WORKDIR /app
COPY backend/package.json backend/package-lock.json* ./
RUN npm install
COPY backend/tsconfig.json ./
COPY backend/src/ ./src/
RUN npx tsc

# Stage 2: admin UI build (outputs to /backend/static/admin from vite config)
FROM node:20 AS admin-build
WORKDIR /admin
COPY admin/package.json admin/package-lock.json* ./
RUN npm install
COPY admin/ ./
RUN npm run build

# Stage 3: runtime image
FROM node:20
WORKDIR /app
ENV NODE_ENV=production
COPY backend/package.json backend/package-lock.json* ./
RUN npm install --omit=dev
COPY --from=backend-build /app/dist/ ./dist/
COPY --from=admin-build /backend/static/admin ./static/admin/
EXPOSE 3001
CMD ["node", "dist/index.js"]
