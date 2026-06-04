FROM node:20-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates ffmpeg \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/mobile/package.json apps/mobile/package.json

RUN npm ci --omit=dev

COPY apps/api apps/api
COPY railway.json ./

ENV NODE_ENV=production
ENV FFMPEG_PATH=ffmpeg

EXPOSE 3333

CMD ["npm", "--workspace", "@condo-clean/api", "run", "start"]
