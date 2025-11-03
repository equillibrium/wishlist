# syntax=docker/dockerfile:1

FROM node:20-alpine AS base
WORKDIR /app

# Install only production deps
COPY package.json ./
# If you later add package-lock.json, switch to: npm ci --omit=dev
RUN npm install --omit=dev

# Copy app sources
COPY server.js ./
COPY public ./public

# Create data dir (mounted later via PVC)
RUN mkdir -p /app/data

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["npm", "start"]


