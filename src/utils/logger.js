const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');
const fs = require('fs');

// Criar diretório de logs se não existir
const logsDir = path.join(__dirname, '../logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Configuração de formato personalizado
const customFormat = winston.format.combine(
  winston.format.timestamp({
    format: 'YYYY-MM-DD HH:mm:ss'
  }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
    let log = `${timestamp} [${level.toUpperCase()}]: ${message}`;
    
    // Adicionar stack trace para erros
    if (stack) {
      log += `\n${stack}`;
    }
    
    // Adicionar metadata se presente
    if (Object.keys(meta).length > 0) {
      log += `\n${JSON.stringify(meta, null, 2)}`;
    }
    
    return log;
  })
);

// Configuração de transports
const transports = [
  // Console para desenvolvimento
  new winston.transports.Console({
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    format: winston.format.combine(
      winston.format.colorize(),
      customFormat
    )
  }),
  
  // Arquivo rotativo para logs gerais
  new DailyRotateFile({
    filename: path.join(logsDir, 'application-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    maxSize: '20m',
    maxFiles: '14d',
    level: 'info',
    format: customFormat
  }),
  
  // Arquivo rotativo apenas para erros
  new DailyRotateFile({
    filename: path.join(logsDir, 'errors-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    maxSize: '20m',
    maxFiles: '30d',
    level: 'error',
    format: customFormat
  }),
  
  // Arquivo rotativo para operações de instâncias
  new DailyRotateFile({
    filename: path.join(logsDir, 'instances-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    maxSize: '50m',
    maxFiles: '30d',
    level: 'info',
    format: customFormat
  })
];

// Criar logger principal
const logger = winston.createLogger({
  level: 'debug',
  format: customFormat,
  defaultMeta: { 
    service: 'ultrabase-manager',
    version: require('../package.json').version 
  },
  transports,
  // Não sair em caso de erro
  exitOnError: false
});

// Logger específico para instâncias
const instanceLogger = winston.createLogger({
  level: 'debug',
  format: customFormat,
  defaultMeta: { 
    service: 'instance-manager',
    component: 'instances'
  },
  transports: [
    transports[0], // Console
    transports[3]  // Instances file
  ]
});

// Métodos de conveniência
logger.instance = (instanceId, message, meta = {}) => {
  instanceLogger.info(message, { instanceId, ...meta });
};

logger.instanceError = (instanceId, message, error, meta = {}) => {
  instanceLogger.error(message, { 
    instanceId, 
    error: error?.message || error,
    stack: error?.stack,
    ...meta 
  });
};

logger.instanceDebug = (instanceId, message, meta = {}) => {
  instanceLogger.debug(message, { instanceId, ...meta });
};

// Log não capturado de exceções
logger.exceptions.handle(
  new winston.transports.File({ 
    filename: path.join(logsDir, 'exceptions.log'),
    format: customFormat
  })
);

// Log não capturado de promises rejeitadas
logger.rejections.handle(
  new winston.transports.File({ 
    filename: path.join(logsDir, 'rejections.log'),
    format: customFormat
  })
);

module.exports = logger;