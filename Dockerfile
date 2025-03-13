FROM ghcr.io/puppeteer/puppeteer:22.8.2

USER root

# Instalar dependências do Node.js
WORKDIR /app
COPY package*.json ./
RUN npm install

# Copiar código fonte
COPY . .

# Expor a porta
ENV PORT=3001
EXPOSE 3001

# Executar como usuário não-root
USER pptruser

# Comando para iniciar o servidor
CMD ["node", "server.js"]
