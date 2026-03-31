FROM node:22-bookworm

ENV DEBIAN_FRONTEND=noninteractive
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV CONTENT_GEN_PYTHON=/usr/bin/python3
ENV CONTENT_GEN_DISABLE_BROWSER_SANDBOX=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    ffmpeg \
    python3 \
    python3-pip \
    python3-venv \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    xdg-utils \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json requirements.txt ./

RUN npm ci
RUN python3 -m pip install --break-system-packages --no-cache-dir -r requirements.txt
RUN npx playwright install chromium

COPY . .

RUN mkdir -p /app/output /app/auth /app/cookies /app/downloads /app/research

CMD ["node", "code/posting/run-instagram-slot.js", "morning"]
