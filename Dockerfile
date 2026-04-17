FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev
COPY src ./src
COPY public ./public
RUN mkdir -p data
COPY .env.example ./.env.example
COPY README.md ./README.md

EXPOSE 3000

CMD ["node", "src/server.js"]
