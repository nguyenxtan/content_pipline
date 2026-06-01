FROM node:22-alpine

WORKDIR /app

COPY package.json tsconfig.json ./
RUN npm install

COPY src ./src
COPY sql ./sql
COPY README.md ./
COPY .env.example ./

RUN npm run build

EXPOSE 4001

CMD ["npm", "run", "start"]
