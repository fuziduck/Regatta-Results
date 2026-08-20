FROM node:20

WORKDIR /app

COPY package.json ./

RUN npm install --legacy-peer-deps --no-audit --no-fund

COPY . .

EXPOSE 3000

CMD ["npm", "start"]

