import express from 'express';
import cors from 'cors';
import puppeteer from 'puppeteer';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import fs from 'fs';
import path from 'path';

// Configuração inicial
dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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
            const domainsResponse = await fetch(`${this.baseUrl}/domains`);
            const domainsData = await domainsResponse.json();
            const domain = domainsData["hydra:member"][0].domain;

            const username = `user${Math.floor(Math.random() * 100000)}${Date.now().toString().slice(-4)}`;
            const password = `pass${Math.random().toString(36).substring(2, 10)}`;
            const email = `${username}@${domain}`;

            helpers.log(`Criando conta com email: ${email}`);
            await fetch(`${this.baseUrl}/accounts`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    address: email,
                    password: password
                })
            });

            helpers.log('Obtendo token de acesso...');
            const tokenResponse = await fetch(`${this.baseUrl}/token`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    address: email,
                    password: password
                })
            });
            const tokenData = await tokenResponse.json();

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
                const response = await fetch(`${this.baseUrl}/messages`, {
                    headers: { 'Authorization': `Bearer ${this.token}` }
                });
                const data = await response.json();
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
            const response = await fetch(`${this.baseUrl}/messages/${messageId}`, {
                headers: { 'Authorization': `Bearer ${this.token}` }
            });
            const messageData = await response.json();

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
            await page.waitForSelector('input[name="email"]');
            await helpers.randomDelay(300, 600);
            await page.type('input[name="email"]', credentials.email, { delay: 30 + Math.random() * 50 });

            helpers.log('Preenchendo campo de usuário...');
            await helpers.randomDelay(200, 500);
            await page.waitForSelector('input[name="username"]');
            await page.type('input[name="username"]', credentials.username, { delay: 30 + Math.random() * 50 });

            helpers.log('Preenchendo campo de senha...');
            await helpers.randomDelay(200, 500);
            await page.waitForSelector('input[name="password"]');
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
            browser = await puppeteer.launch({
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--single-process',
                    '--disable-gpu'
                ]
            });

            const page = await browser.newPage();
            page.setDefaultNavigationTimeout(60000);

            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.110 Safari/537.36');

            helpers.log('Navegando para a página de registro...');
            await page.goto('https://stackblitz.com/register?redirect_to=/oauth/authorize?client_id=bolt&response_type=code&redirect_uri=https%3A%2F%2Fbolt.new%2Foauth2&code_challenge_method=S256&code_challenge=ARGuTD1lpTZHCQWoHSbB5FkpFaQw2xXeUBWdIEW46uU&state=f0d2aaed-3c6d-4cf2-b0d7-1473411ffe4e&scope=public', { waitUntil: 'networkidle2' });

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
            await page.goto(confirmationLink, { waitUntil: 'networkidle2' });

            helpers.log('Aguardando processamento da confirmação...');
            await helpers.delay(5000);

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
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            helpers.log(`Erro durante o processo: ${errorMessage}`, 'error');

            return {
                success: false,
                error: errorMessage
            };
        } finally {
            if (browser) {
                helpers.log('Fechando navegador...');
                await browser.close();
                helpers.log('Navegador fechado');
            }
        }
    }
}

// Configuração do servidor Express
const app = express();

// Configuração de CORS para permitir apenas origens específicas
const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',')
    : ['http://localhost:5173'];

app.use(cors({
    origin: function (origin, callback) {
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

app.use(express.json());

const accountManager = new AccountManager();

// Rota para criar conta
app.post('/api/create-account', async (req, res) => {
    try {
        const result = await accountManager.createAndConfirmAccount();
        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

// Rota para verificar status do servidor
app.get('/api/status', (req, res) => {
    res.json({
        status: 'online',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development'
    });
});

// Inicie o servidor
const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
});