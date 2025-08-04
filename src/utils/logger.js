// Logger ultra-simples - sem dependências externas
// Substituição do sistema Winston complexo por console básico + timestamp

const logger = {
  info: (msg) => console.log(`[${new Date().toISOString()}] INFO: ${msg}`),
  error: (msg) => console.error(`[${new Date().toISOString()}] ERROR: ${msg}`),
  warn: (msg) => console.warn(`[${new Date().toISOString()}] WARN: ${msg}`),
  debug: (msg) => console.log(`[${new Date().toISOString()}] DEBUG: ${msg}`),
  
  // Métodos para compatibilidade com código existente
  instance: (id, msg, meta) => console.log(`[${new Date().toISOString()}] [${id}] ${msg}`, meta || ''),
  instanceError: (id, msg, err, meta) => console.error(`[${new Date().toISOString()}] [${id}] ERROR: ${msg}`, err, meta || ''),
  instanceDebug: (id, msg, meta) => console.log(`[${new Date().toISOString()}] [${id}] DEBUG: ${msg}`, meta || ''),
  
  // Métodos vazios para compatibilidade (não fazem nada)
  exceptions: { handle: () => {} },
  rejections: { handle: () => {} }
};

module.exports = logger;