FROM oven/bun:1-alpine
WORKDIR /app
COPY package.json ./
COPY src ./src
ENV PAYPLE_SANDBOX_PORT=9444
EXPOSE 9444
ENTRYPOINT ["bun", "src/cli.ts"]
