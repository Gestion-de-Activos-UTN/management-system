FROM node:22-alpine

WORKDIR /app

RUN corepack enable pnpm

COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml ./
RUN HUSKY=0 pnpm install

COPY . .

EXPOSE 3000

CMD ["pnpm", "run", "dev"]
