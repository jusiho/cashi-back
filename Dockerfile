FROM node:20-alpine AS build

RUN apk update && apk add --no-cache \
  build-base \
  gcc \
  autoconf \
  automake \
  zlib-dev \
  libpng-dev \
  vips-dev \
  git \
  python3

WORKDIR /opt/

COPY package*.json ./
RUN npm ci --legacy-peer-deps

ENV PATH=/opt/node_modules/.bin:$PATH

WORKDIR /opt/app
COPY . .

RUN npm run build


FROM node:20-alpine

RUN apk add --no-cache vips-dev

ENV NODE_ENV=production
WORKDIR /opt/

COPY --from=build /opt/node_modules ./node_modules

WORKDIR /opt/app
COPY --from=build /opt/app ./

ENV PATH=/opt/node_modules/.bin:$PATH

EXPOSE 1337

CMD ["npm", "run", "start"]
