FROM node:23-alpine


RUN apk update && apk upgrade
RUN apk add --no-cache ffmpeg

WORKDIR /app

COPY package*.json .
RUN npm install --omit=dev

COPY index.js .

CMD ["npm", "start"]

