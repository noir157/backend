FROM ghcr.io/puppeteer/puppeteer:22.8.2

USER root

# Instalar dependências adicionais necessárias
RUN apt-get update && apt-get install -y \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libatspi2.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libwayland-client0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    xdg-utils \
    libu2f-udev \
    libvulkan1 \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Definir diretório de trabalho
WORKDIR /app

# Copiar package.json e package-lock.json (se existir)
COPY package*.json ./

# Instalar dependências sem usar cache e ignorando scripts opcionais
RUN npm install --no-cache --omit=dev --ignore-scripts

# Copiar o resto do código
COPY . .

# Expor a porta que o servidor usa
ENV PORT=3001
EXPOSE 3001

# Definir variáveis de ambiente
ENV NODE_ENV=production
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

# Executar como usuário não-root
USER pptruser

# Comando para iniciar o aplicativo
CMD ["node", "server.js"]
