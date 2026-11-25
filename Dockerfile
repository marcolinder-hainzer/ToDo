FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server ./server
COPY public ./public
COPY scripts ./scripts

RUN mkdir -p /data && chown node:node /data
USER node

ENV DATA_DIR=/data \
    PORT=3000
EXPOSE 3000
VOLUME ["/data"]

CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
