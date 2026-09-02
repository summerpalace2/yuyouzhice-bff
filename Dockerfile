FROM node:22-alpine

WORKDIR /app

# The BFF uses only Node.js built-ins, so no package installation is needed at
# image-build time. Keeping the runtime image explicit avoids auto-builder hangs.
COPY package.json ./
COPY server ./server
COPY images ./images

RUN mkdir -p /data \
  && chown -R node:node /app /data

ENV NODE_ENV=production
ENV YUYOUZHICE_DATA_FILE=/data/yuyouzhice.json

USER node
EXPOSE 3000

CMD ["node", "server/index.mjs"]
