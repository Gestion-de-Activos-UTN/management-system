FROM node:22-alpine

WORKDIR /app

RUN corepack enable pnpm
# Fuera de /app: con el montaje .:/app, pnpm dejaría su almacén en el disco del host (.pnpm-store).
ENV npm_config_store_dir=/pnpm-store

COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml ./
COPY patches ./patches
RUN HUSKY=0 pnpm install --frozen-lockfile

COPY . .

EXPOSE 3001

CMD ["pnpm", "run", "dev"]
