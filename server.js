import express from 'express';
import cors from 'cors';
import puppeteerCore from 'puppeteer-core';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import fs from 'fs';
import path from 'path';
import axios from 'axios';

// Configuração inicial
dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Verificação de ambiente
console.log('======= DIAGNÓSTICO DE AMBIENTE =======');
console.log('Node.js version:', process.version);
console.log('Platform:', process.platform);
console.log('Architecture:', process.arch);
console.log('Current directory:', process.cwd());
console.log('Environment variables:');
console.log('- NODE_ENV:', process.env.NODE_ENV);
console.log('- PORT:', process.env.PORT);
console.log('- PUPPETEER_EXECUTABLE_PATH:', process.env.PUPPETEER_EXECUTABLE_PATH);
console.log('======= FIM DO DIAGNÓSTICO =======');

// Captura de erros não tratados
process.on('uncaughtException', (err) => {
  console.error('ERRO CRÍTICO NÃO CAPTURADO:', err);
  console.error('Stack trace:', err.stack);
  // Não encerrar o processo para que o Railway não reinicie continuamente
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('PROMISE REJECTION NÃO TRATADA:', reason);
  // Não encerrar o processo
});

// Utilitários
const helpers = {
  getTimestamp() {
    return new Date().toISOString().replace(/[:.]/g, '-');
  },
  
  async randomDelay(min = 300, max = 800) {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    await new Promise(resolve => setTimeout(resolve, delay));
    return delay;
  },
  
  async delay(timeout) {
    await new Promise(resolve => setTimeout(resolve, timeout));
  },
  
  ensureDirectoryExists(dirPath) {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  },
  
  saveToFile(filePath, content) {
    this.ensureDirectoryExists(path.dirname(filePath));
    fs.writeFileSync(filePath, content);
  },
  
  generateUsername() {
    const prefix = 'user_';
    const randomPart = Math.random().toString(36).substring(2, 8);
    const timestamp = Date.now().toString().slice(-4);
    return `${prefix}${randomPart}${timestamp}`;
  },
  
  generatePassword() {
    const randomPart = Math.random().toString(36).substring(2, 8);
    const number = Math.floor(Math.random() * 900) + 100;
    return `Pass_${randomPart}_${number}!`;
  },
  
  log(message, type = 'info') {
    const timestamp = new Date().toISOString().slice(11, 19);
    const prefix = {
      info: '📘 INFO',
      warn: '⚠️ AVISO',
      error: '❌ ERRO',
      success: '✅ SUCESSO'
    }[type] || '📘 INFO';
    
    console.log(`[${timestamp}] ${prefix}: ${message}`);
  }
};

// Função para criar instância do navegador
async function createBrowser() {
  const isProd = process.env.NODE_ENV === 'production';
  helpers.log(`Criando navegador em ambiente ${isProd ? 'de produção' : 'de desenvolvimento'}`);
  
  try {
    // Verificar se estamos usando browserless.io
    if (process.env.BROWSERLESS_TOKEN) {
      helpers.log('Usando Browserless.io para navegador remoto');
      return await puppeteerCore.connect({
        browserWSEndpoint: `wss://chrome.browserless.io?token=${process.env.BROWSERLESS_TOKEN}`,
        defaultViewport: { width: 1280, height: 800 }
      });
    }
    
    // Em ambiente Docker (Railway)
    if (isProd) {
      // Na imagem puppeteer Docker, o Chrome está em:
      const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/google-chrome-stable';
      
      helpers.log(`Iniciando Chrome em caminho: ${executablePath}`);
      return puppeteerCore.launch({
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--single-process',
          '--disable-gpu'
        ],
        executablePath,
        headless: true,
        ignoreHTTPSErrors: true
      });
    }
    
    // Em ambiente de desenvolvimento
    helpers.log('Iniciando Chrome local para desenvolvimento');
    const executablePath = process.env.CHROME_PATH || 
      (process.platform === 'win32' 
        ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
        : process.platform === 'darwin'
          ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
          : '/usr/bin/google-chrome');
    
    helpers.log(`Caminho do executável Chrome: ${executablePath}`);
    
    return puppeteerCore.launch({
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage'
      ],
      executablePath,
      headless: true
    });
  } catch (error) {
    helpers.log(`Erro ao criar navegador: ${error.message}`, 'error');
    console.error('Stack trace completo:', error.stack);
    throw error;
  }
}

// Serviço de Email Temporário
class TempEmailService {
  constructor() {
    this.baseUrl = 'https://api.mail.tm';
    this.account = null;
    this.token = null;
  }

  async createAccount() {
    try {
      helpers.log('Obtendo domínios disponíveis...');
      const domainsResponse = await axios.get(`${this.baseUrl}/domains`);
      const domainsData = domainsResponse.data;
      const domain = domainsData["hydra:member"][0].domain;
      
      const username = `user${Math.floor(Math.random() * 100000)}${Date.now().toString().slice(-4)}`;
      const password = `pass${Math.random().toString(36).substring(2, 10)}`;
      const email = `${username}@${domain}`;
      
      helpers.log(`Criando conta com email: ${email}`);
      await axios.post(`${this.baseUrl}/accounts`, {
        address: email,
        password: password
      });
      
      helpers.log('Obtendo token de acesso...');
      const tokenResponse = await axios.post(`${this.baseUrl}/token`, {
        address: email,
        password: password
      });
      const tokenData = tokenResponse.data;
      
      this.account = { email, password };
      this.token = tokenData.token;
      
      helpers.log(`Email temporário criado: ${email}`, 'success');
      return this.account;
    } catch (error) {
      helpers.log('Erro ao criar email temporário: ' + error.message, 'error');
      throw new Error(`Falha ao criar email temporário: ${error.message}`);
    }
  }
  
  async checkInbox(maxAttempts = 30, delaySeconds = 5) {
    if (!this.token) {
      throw new Error('É necessário criar uma conta antes de verificar a caixa de entrada');
    }
    
    helpers.log(`Verificando emails para ${this.account.email}...`);
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      helpers.log(`Tentativa ${attempt}/${maxAttempts} de verificar emails...`);
      
      try {
        const response = await axios.get(`${this.baseUrl}/messages`, {
          headers: { 'Authorization': `Bearer ${this.token}` }
        });
        const data = response.data;
        const messages = data["hydra:member"];
        
        if (messages && messages.length > 0) {
          helpers.log(`${messages.length} email(s) encontrado(s)!`, 'success');
          return messages;
        }
        
        await helpers.delay(delaySeconds * 1000);
      } catch (error) {
        helpers.log('Erro ao verificar emails: ' + error.message, 'warn');
        await helpers.delay(delaySeconds * 1000);
      }
    }
    
    helpers.log('Tempo limite excedido. Nenhum email recebido.', 'error');
    return [];
  }
  
  async getMessageDetails(messageId) {
    if (!this.token) {
      throw new Error('É necessário criar uma conta antes de ler mensagens');
    }
    
    try {
      helpers.log(`Obtendo detalhes da mensagem ${messageId}...`);
      const response = await axios.get(`${this.baseUrl}/messages/${messageId}`, {
        headers: { 'Authorization': `Bearer ${this.token}` }
      });
      const messageData = response.data;
      
      helpers.log('Estrutura da resposta do email:');
      helpers.log(`- Tem HTML: ${Boolean(messageData.html)}`);
      helpers.log(`- Tem texto: ${Boolean(messageData.text)}`);
      
      if (!messageData.html && !messageData.text) {
        helpers.log('Formato de email não padrão. Analisando estrutura...', 'warn');
        helpers.log('Propriedades disponíveis: ' + Object.keys(messageData).join(', '));
      }
      
      return messageData;
    } catch (error) {
      helpers.log(`Erro ao obter detalhes da mensagem ${messageId}: ${error.message}`, 'error');
      throw error;
    }
  }
}

// Parser de Email
class EmailParser {
  static extractConfirmationLink(emailData) {
    let bodyText = '';
    
    if (typeof emailData === 'string') {
      bodyText = emailData;
      helpers.log('Corpo do email recebido como string');
    } 
    else if (emailData && typeof emailData === 'object') {
      helpers.log('Corpo do email recebido como objeto. Propriedades: ' + Object.keys(emailData).join(', '));
      
      if (emailData.html) {
        bodyText = emailData.html;
        helpers.log('Usando corpo HTML do email');
      } else if (emailData.text) {
        bodyText = emailData.text;
        helpers.log('Usando corpo texto do email');
      } else if (emailData.body) {
        bodyText = emailData.body;
        helpers.log('Usando propriedade body do email');
      } else if (emailData.content) {
        bodyText = emailData.content;
        helpers.log('Usando propriedade content do email');
      } else if (emailData.intro) {
        bodyText = emailData.intro;
        helpers.log('Usando propriedade intro do email');
      } else {
        for (const key in emailData) {
          const value = emailData[key];
          if (typeof value === 'string' && 
              (value.includes('http') || value.includes('href') || value.includes('<a'))) {
            bodyText = value;
            helpers.log(`Usando propriedade ${key} que parece conter links`);
            break;
          }
        }
        
        if (!bodyText) {
          try {
            bodyText = JSON.stringify(emailData);
            helpers.log('Convertendo objeto completo para string');
          } catch (e) {
            helpers.log('Falha ao converter objeto para string: ' + e.message, 'warn');
          }
        }
      }
    } else {
      helpers.log('Corpo do email em formato não reconhecido: ' + typeof emailData, 'error');
      return null;
    }

    if (!bodyText) {
      helpers.log('Não foi possível extrair texto do corpo do email', 'error');
      return null;
    }
    
    if (typeof bodyText !== 'string') {
      try {
        bodyText = String(bodyText);
      } catch (e) {
        helpers.log('Falha ao converter corpo do email para string: ' + e.message, 'error');
        return null;
      }
    }
    
    const urlRegex = /(https?:\/\/[^\s<>"']+)/g;
    const urls = bodyText.match(urlRegex) || [];
    
    helpers.log(`Encontrados ${urls.length} URLs no corpo do email`);
    
    const confirmationKeywords = ['confirm', 'verify', 'activate', 'validation'];
    
    for (const keyword of confirmationKeywords) {
      const confirmationUrls = urls.filter(url => url.toLowerCase().includes(keyword));
      if (confirmationUrls.length > 0) {
        helpers.log(`URL de confirmação encontrado com a palavra-chave "${keyword}": ${confirmationUrls[0]}`, 'success');
        return confirmationUrls[0];
      }
    }
    
    if (urls.length > 0) {
      helpers.log(`Nenhum URL específico de confirmação encontrado. Usando o primeiro URL: ${urls[0]}`);
      return urls[0];
    }
    
    helpers.log('Nenhum URL encontrado no corpo do email', 'warn');
    return null;
  }
  
  static isConfirmationEmail(message) {
    if (!message || !message.subject) {
      helpers.log('Mensagem ou assunto inexistente', 'warn');
      return false;
    }
    
    const subject = message.subject.toLowerCase();
    const confirmationKeywords = ['confirm', 'verify', 'activate', 'welcome', 'registration', 'instruction'];
    
    const isConfirmation = confirmationKeywords.some(keyword => subject.includes(keyword));
    helpers.log(`Verificando email "${message.subject}": ${isConfirmation ? 'Parece ser de confirmação' : 'Não parece ser de confirmação'}`);
    
    return isConfirmation;
  }
}

// Gerenciador de Contas
class AccountManager {
  constructor(outputDir = './bolt_account_result') {
    this.outputDir = outputDir;
    this.emailService = new TempEmailService();
    helpers.ensureDirectoryExists(outputDir);
  }
  
  async fillRegistrationForm(page, credentials) {
    try {
      helpers.log('Preenchendo campo de email...');
      await page.waitForSelector('input[name="email"]', { timeout: 30000 });
      await helpers.randomDelay(300, 600);
      await page.type('input[name="email"]', credentials.email, { delay: 30 + Math.random() * 50 });

      helpers.log('Preenchendo campo de usuário...');
      await helpers.randomDelay(200, 500);
      await page.waitForSelector('input[name="username"]', { timeout: 30000 });
      await page.type('input[name="username"]', credentials.username, { delay: 30 + Math.random() * 50 });

      helpers.log('Preenchendo campo de senha...');
      await helpers.randomDelay(200, 500);
      await page.waitForSelector('input[name="password"]', { timeout: 30000 });
      await page.type('input[name="password"]', credentials.password, { delay: 30 + Math.random() * 50 });

      helpers.log('Preenchendo campo de confirmação de senha...');
      await helpers.randomDelay(200, 500);
      
      const confirmationSelectors = [
        'input[name="passwordConfirmation"]',
        'input[name="password_confirmation"]',
        'input[name="confirmPassword"]',
        'input[name="confirm_password"]'
      ];
      
      let confirmationFilled = false;
      
      for (const selector of confirmationSelectors) {
        try {
          const confirmField = await page.$(selector);
          if (confirmField) {
            await page.type(selector, credentials.password, { delay: 30 + Math.random() * 50 });
            confirmationFilled = true;
            helpers.log(`Campo de confirmação de senha preenchido usando seletor: ${selector}`, 'success');
            break;
          }
        } catch (e) {
          // Continue to next selector
        }
      }
      
      if (!confirmationFilled) {
        const passwordFields = await page.$$('input[type="password"]');
        if (passwordFields.length >= 2) {
          await passwordFields[1].type(credentials.password, { delay: 30 + Math.random() * 50 });
          confirmationFilled = true;
          helpers.log('Campo de confirmação de senha preenchido (segundo campo de senha)', 'success');
        } else {
          helpers.log('Não foi possível identificar o campo de confirmação de senha', 'warn');
        }
      }
      
      helpers.log('Verificando termos e condições...');
      await helpers.randomDelay(300, 700);
      try {
        const termsCheckbox = await page.$('input[type="checkbox"]');
        if (termsCheckbox) {
          await termsCheckbox.click();
          helpers.log('Termos aceitos', 'success');
        }
      } catch (error) {
        helpers.log('Não foi possível localizar checkbox de termos', 'warn');
      }
      
      return true;
    } catch (error) {
      helpers.log('Erro ao preencher formulário: ' + error.message, 'error');
      return false;
    }
  }
  
  async submitRegistrationForm(page) {
    try {
      const submitSelectors = [
        'button[type="submit"]',
        'input[type="submit"]',
        'button.submit-button',
        'button:contains("Sign up")',
        'button:contains("Register")'
      ];
      
      for (const selector of submitSelectors) {
        try {
          const button = await page.$(selector);
          if (button) {
            await helpers.randomDelay(500, 1000);
            await button.click();
            helpers.log(`Formulário enviado usando seletor: ${selector}`, 'success');
            return true;
          }
        } catch (e) {
          // Continue to next selector
        }
      }
      
      helpers.log('Tentando enviar formulário com a tecla Enter...');
      await helpers.randomDelay(300, 700);
      await page.keyboard.press('Enter');
      helpers.log('Formulário enviado usando tecla Enter', 'success');
      
      return true;
    } catch (error) {
      helpers.log('Erro ao submeter formulário: ' + error.message, 'error');
      return false;
    }
  }

  async createAndConfirmAccount() {
    let browser = null;
    let retries = 0;
    const maxRetries = 3;
    
    while (retries < maxRetries) {
      try {
        const emailAccount = await this.emailService.createAccount();
        
        const accountCredentials = {
          email: emailAccount.email,
          username: helpers.generateUsername(),
          password: helpers.generatePassword()
        };
        
        console.log('Credenciais geradas:');
        console.log(`- Email: ${accountCredentials.email}`);
        console.log(`- Username: ${accountCredentials.username}`);
        console.log(`- Password: ${accountCredentials.password}`);
        
        helpers.log('Iniciando navegador...');
        browser = await createBrowser();
        
        const page = await browser.newPage();
        page.setDefaultNavigationTimeout(60000);
        
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.110 Safari/537.36');
        
        helpers.log('Navegando para a página de registro...');
        await page.goto('https://stackblitz.com/register?redirect_to=/oauth/authorize?client_id=bolt&response_type=code&redirect_uri=https%3A%2F%2Fbolt.new%2Foauth2&code_challenge_method=S256&code_challenge=ARGuTD1lpTZHCQWoHSbB5FkpFaQw2xXeUBWdIEW46uU&state=f0d2aaed-3c6d-4cf2-b0d7-1473411ffe4e&scope=public', { 
          waitUntil: 'networkidle2',
          timeout: 60000
        });
        
        helpers.log('Preenchendo formulário...');
        await this.fillRegistrationForm(page, accountCredentials);
        
        helpers.log('Enviando formulário...');
        await this.submitRegistrationForm(page);

        helpers.log('Aguardando processamento...');
        await helpers.delay(5000);
        
        helpers.log('Verificando caixa de entrada para email de confirmação...');
        const messages = await this.emailService.checkInbox();
        
        if (messages.length === 0) {
          throw new Error('Nenhum email recebido após o tempo limite');
        }
        
        let confirmationLink = null;
        for (const message of messages) {
          if (EmailParser.isConfirmationEmail(message)) {
            const messageDetails = await this.emailService.getMessageDetails(message.id);
            confirmationLink = EmailParser.extractConfirmationLink(messageDetails);
            if (confirmationLink) break;
          }
        }
        
        if (!confirmationLink) {
          throw new Error('Não foi possível extrair o link de confirmação dos emails recebidos');
        }

        helpers.log('Navegando para o link de confirmação...');
        await page.goto(confirmationLink, { 
          waitUntil: 'networkidle2',
          timeout: 60000
        });
        
        helpers.log('Aguardando processamento da confirmação...');
        await helpers.delay(5000);
        
        if (browser) {
          helpers.log('Fechando navegador...');
          await browser.close();
          browser = null;
          helpers.log('Navegador fechado');
        }
        
        return {
          success: true,
          accountInfo: {
            email: accountCredentials.email,
            username: accountCredentials.username,
            password: accountCredentials.password,
            confirmed: true
          }
        };
        
      } catch (error) {
        retries++;
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        helpers.log(`Erro durante o processo (tentativa ${retries}/${maxRetries}): ${errorMessage}`, 'error');
        
        // Fechar o navegador se estiver aberto
        if (browser) {
          try {
            await browser.close();
            browser = null;
          } catch (closeError) {
            helpers.log(`Erro ao fechar navegador: ${closeError.message}`, 'warn');
          }
        }
        
        // Se chegamos ao número máximo de tentativas, retornar erro
        if (retries >= maxRetries) {
          return {
            success: false,
            error: errorMessage
          };
        }
        
        // Aguardar antes de tentar novamente
        helpers.log(`Aguardando 3 segundos antes de tentar novamente...`, 'info');
        await helpers.delay(3000);
      }
    }
    
    // Este ponto nunca deve ser alcançado devido às verificações acima,
    // mas incluímos como fallback
    return {
      success: false,
      error: "Número máximo de tentativas excedido"
    };
  }
}

// Configuração do servidor Express
const app = express();

// Configuração de CORS para permitir apenas origens específicas
const allowedOrigins = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(',') 
  : ['http://localhost:5173'];

// Em ambiente de desenvolvimento, permitir todas as origens
if (process.env.NODE_ENV !== 'production') {
  app.use(cors());
  helpers.log('Modo de desenvolvimento: CORS permitindo todas as origens', 'warn');
} else {
  app.use(cors({
    origin: function(origin, callback) {
      // Permitir requisições sem origin (como apps mobile ou curl)
      if (!origin) return callback(null, true);
      
      if (allowedOrigins.indexOf(origin) === -1) {
        const msg = 'A política CORS deste site não permite acesso desta origem.';
        return callback(new Error(msg), false);
      }
      return callback(null, true);
    },
    credentials: true
  }));
  helpers.log(`Modo de produção: CORS restrito às origens: ${allowedOrigins.join(', ')}`, 'info');
}

app.use(express.json());

// Middleware para logging de requisições
app.use((req, res, next) => {
  helpers.log(`${req.method} ${req.path} - IP: ${req.ip}`, 'info');
  next();
});

// Instância global do gerenciador de contas
const accountManager = new AccountManager();

// Rota para diagnóstico básico
app.get('/api/healthcheck', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
    nodeVersion: process.version,
    memoryUsage: process.memoryUsage(),
    uptime: process.uptime()
  });
});

// Rota para verificar status do servidor
app.get('/api/status', async (req, res) => {
  try {
    // Em modo de diagnóstico, não testa o navegador
    if (process.env.DIAGNOSTIC_MODE === 'true') {
      return res.json({
        status: 'online',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development',
        message: 'Servidor online em modo de diagnóstico',
        diagnosticMode: true
      });
    }
    
    // Testar a conexão com o navegador
    helpers.log('Testando conexão com o navegador...');
    const browser = await createBrowser();
    await browser.close();
    
    res.json({
      status: 'online',
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      message: 'Servidor online e navegador funcionando'
    });
  } catch (error) {
    console.error('Erro na verificação de saúde:', error);
    res.status(500).json({
      status: 'error',
      message: 'Erro ao conectar ao navegador',
      error: error.message
    });
  }
});

// Rota para criar conta
app.post('/api/create-account', async (req, res) => {
  try {
    // Verificar modo de diagnóstico
    if (process.env.DIAGNOSTIC_MODE === 'true') {
      helpers.log('Modo de diagnóstico ativado, retornando conta simulada', 'warn');
      return res.json({
        success: true,
        diagnostic: true,
        accountInfo: {
          email: `test_${Date.now()}@example.com`,
          username: `user_${Date.now()}`,
          password: `Password_${Math.floor(Math.random() * 1000)}!`,
          confirmed: true
        }
      });
    }
    
    helpers.log('Recebida solicitação para criar conta', 'info');
    const result = await accountManager.createAndConfirmAccount();
    helpers.log(`Processo finalizado com ${result.success ? 'sucesso' : 'erro'}`, result.success ? 'success' : 'error');
    res.json(result);
  } catch (error) {
    helpers.log(`Erro não tratado: ${error.message}`, 'error');
    console.error('Stack trace completo:', error.stack);
    
    res.status(500).json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Rota para a raiz do servidor
app.get('/', (req, res) => {
  res.send(`
    <html>
      <head>
        <title>Bolt Account Creator API</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; max-width: 800px; margin: 0 auto; padding: 20px; }
          h1 { color: #333; border-bottom: 1px solid #eee; padding-bottom: 10px; }
          .endpoint { background: #f4f4f4; padding: 10px; border-radius: 5px; margin-bottom: 10px; }
          .method { display: inline-block; padding: 5px 10px; border-radius: 3px; color: white; margin-right: 10px; }
          .get { background: #61affe; }
          .post { background: #49cc90; }
          code { background: #f8f8f8; padding: 2px 5px; border-radius: 3px; font-size: 0.9em; }
        </style>
      </head>
      <body>
        <h1>Bolt Account Creator API</h1>
        <p>Esta API permite a criação automatizada de contas bolt.new.</p>
        
        <h2>Endpoints disponíveis:</h2>
        
        <div class="endpoint">
          <span class="method get">GET</span>
          <code>/api/status</code>
          <p>Verifica o status do servidor e a conexão com o navegador.</p>
        </div>
        
        <div class="endpoint">
          <span class="method get">GET</span>
          <code>/api/healthcheck</code>
          <p>Verificação básica de saúde do servidor.</p>
        </div>
        
        <div class="endpoint">
          <span class="method post">POST</span>
          <code>/api/create-account</code>
          <p>Cria uma nova conta bolt.new automaticamente.</p>
        </div>
        
        <p>Status do servidor: Online</p>
        <p>Ambiente: ${process.env.NODE_ENV || 'development'}</p>
        <p>Modo de diagnóstico: ${process.env.DIAGNOSTIC_MODE === 'true' ? 'Ativado' : 'Desativado'}</p>
            </body>
    </html>
  `);
});

// Middleware para tratamento de rotas não encontradas
app.use((req, res) => {
  res.status(404).json({ 
    success: false, 
    error: 'Endpoint não encontrado' 
  });
});

// Middleware para tratamento de erros
app.use((err, req, res, next) => {
  console.error('Erro não tratado:', err);
  res.status(500).json({ 
    success: false, 
    error: 'Erro interno do servidor', 
    message: err.message 
  });
});

// Inicie o servidor
const PORT = process.env.PORT || 3001;
try {
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor rodando na porta ${PORT}`);
    console.log(`Ambiente: ${process.env.NODE_ENV || 'development'}`);
    console.log(`Origens permitidas: ${allowedOrigins.join(', ')}`);
    console.log(`Modo de diagnóstico: ${process.env.DIAGNOSTIC_MODE === 'true' ? 'Ativado' : 'Desativado'}`);
  });

  // Tratamento para shutdown gracioso
  process.on('SIGTERM', () => {
    console.log('SIGTERM recebido, encerrando servidor...');
    server.close(() => {
      console.log('Servidor encerrado');
      process.exit(0);
    });
  });

  process.on('SIGINT', () => {
    console.log('SIGINT recebido, encerrando servidor...');
    server.close(() => {
      console.log('Servidor encerrado');
      process.exit(0);
    });
  });
} catch (error) {
  console.error('ERRO CRÍTICO AO INICIAR SERVIDOR:', error);
  // Tentar iniciar em uma porta alternativa
  try {
    const alternativePort = 8080;
    app.listen(alternativePort, '0.0.0.0', () => {
      console.log(`Servidor rodando na porta alternativa ${alternativePort}`);
    });
  } catch (secondError) {
    console.error('ERRO AO INICIAR NA PORTA ALTERNATIVA:', secondError);
  }
}
