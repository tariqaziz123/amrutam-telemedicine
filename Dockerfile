FROM node:24-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY prisma ./prisma
COPY prisma7.config.ts tsconfig.json ./
RUN npx prisma generate

COPY src ./src
COPY tests ./tests
RUN npm run build


FROM node:24-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts

COPY --from=build /app/dist ./dist
COPY --from=build /app/generated ./generated

EXPOSE 3000

CMD ["node", "dist/src/server.js"]
