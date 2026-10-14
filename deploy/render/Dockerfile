FROM node:22-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl && rm -rf /var/lib/apt/lists/*
COPY package.json ./
RUN npm install --omit=optional
COPY . .
RUN mkdir -p /app/certificates && curl --fail --proto '=https' --tlsv1.2 https://truststore.pki.rds.amazonaws.com/us-east-2/us-east-2-bundle.pem -o /app/certificates/rds.pem && npm run build
ENV NODE_ENV=production DB_SSL_CA_PATH=/app/certificates/rds.pem
EXPOSE 10000
CMD ["npm","start"]
