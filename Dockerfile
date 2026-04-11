FROM node:20-alpine

WORKDIR /app

COPY package.json ./
COPY src ./src
COPY data ./data
COPY .env.example ./.env.example
COPY README.md ./README.md

EXPOSE 3000

CMD ["node", "src/server.js"]
