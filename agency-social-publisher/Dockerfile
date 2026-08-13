FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY src ./src
COPY config ./config
COPY skills ./skills
EXPOSE 8787
CMD ["npm", "start"]
