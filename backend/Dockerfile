FROM node:20-bookworm

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libdbus-1-3 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libpango-1.0-0 \
    libcairo2 \
    python3 \
    python3-pip \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./

RUN npm install --legacy-peer-deps

# Install Playwright browsers
RUN npx playwright install chromium --with-deps

COPY . .

# Create directories for parsers and logs
RUN mkdir -p /app/logs /app/parsers /app/configs

RUN npx prisma generate

RUN npm run build

EXPOSE 3000

CMD ["npm", "run", "start:prod"]
