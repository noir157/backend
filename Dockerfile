FROM ghcr.io/puppeteer/puppeteer:22.8.2

USER root

# Definir diretório de trabalho
WORKDIR /app

# Copiar package.json e package-lock.json (se existir)
COPY package*.json ./

# Instalar dependências
RUN npm install --no-cache

# Copiar o resto do código
COPY . .

# Configurar variáveis de ambiente
ENV PORT=3001
ENV NODE_ENV=production
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

# Expor a porta
EXPOSE 3001

# Comando para iniciar o aplicativo
CMD ["node", "server.js"]
