# Pin the runtime family and the Playwright package together. Resolve this base
# image to an approved digest in CI before a production image is promoted.
FROM node:20-bookworm
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --ignore-scripts && npx playwright@1.64.0 install --with-deps chromium && npm cache clean --force
COPY src ./src
RUN useradd --create-home --uid 10001 renderer && chown -R renderer:renderer /app
USER 10001
ENV NODE_ENV=production
CMD ["node", "src/worker.mjs"]
