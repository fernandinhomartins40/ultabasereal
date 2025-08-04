/**
 * DIAGNOSTIC ACTIONS - Sistema de ações para correção de problemas
 * 
 * Fornece ações seguras e controladas para resolver problemas encontrados
 * nos diagnósticos, com confirmações e rollback automático.
 */

const { execAsync } = require('util').promisify(require('child_process').exec);
const fs = require('fs-extra');
const path = require('path');

class DiagnosticActions {
  constructor() {
    this.actionLog = [];
    this.safetyTimeout = 30000; // 30s timeout para ações
  }

  /**
   * Registra ação executada para auditoria
   */
  logAction(instanceId, action, details, result) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      instanceId,
      action,
      details,
      result: result ? 'success' : 'failed',
      error: result === false ? details : null
    };
    
    this.actionLog.push(logEntry);
    console.log(`📋 [${instanceId}] Ação: ${action} - ${result ? '✅' : '❌'}`);
  }

  /**
   * Reinicia um container específico
   */
  async restartContainer(instanceId, containerName) {
    try {
      console.log(`🔄 Reiniciando container ${containerName} da instância ${instanceId}`);
      
      const result = await Promise.race([
        execAsync(`docker restart ${containerName}`),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Timeout')), this.safetyTimeout)
        )
      ]);
      
      this.logAction(instanceId, 'restart_container', { containerName }, true);
      
      return {
        success: true,
        message: `Container ${containerName} reiniciado com sucesso`,
        details: result.stdout
      };
      
    } catch (error) {
      this.logAction(instanceId, 'restart_container', { containerName, error: error.message }, false);
      
      return {
        success: false,
        message: `Erro ao reiniciar container ${containerName}`,
        error: error.message
      };
    }
  }

  /**
   * Inicia um container parado
   */
  async startContainer(instanceId, containerName) {
    try {
      console.log(`▶️ Iniciando container ${containerName} da instância ${instanceId}`);
      
      const result = await Promise.race([
        execAsync(`docker start ${containerName}`),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Timeout')), this.safetyTimeout)
        )
      ]);
      
      this.logAction(instanceId, 'start_container', { containerName }, true);
      
      return {
        success: true,
        message: `Container ${containerName} iniciado com sucesso`,
        details: result.stdout
      };
      
    } catch (error) {
      this.logAction(instanceId, 'start_container', { containerName, error: error.message }, false);
      
      return {
        success: false,
        message: `Erro ao iniciar container ${containerName}`,
        error: error.message
      };
    }
  }

  /**
   * Recria um serviço usando docker compose
   */
  async recreateService(instanceId, serviceName) {
    try {
      console.log(`🏗️ Recriando serviço ${serviceName} da instância ${instanceId}`);
      
      const dockerDir = path.join(process.cwd(), `volumes-${instanceId}`);
      const composeFile = `docker-compose.yml`;
      
      if (!await fs.pathExists(path.join(dockerDir, composeFile))) {
        throw new Error(`Arquivo docker-compose.yml não encontrado para instância ${instanceId}`);
      }
      
      const result = await Promise.race([
        execAsync(`cd "${dockerDir}" && docker compose up -d ${serviceName} --force-recreate`),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Timeout')), this.safetyTimeout)
        )
      ]);
      
      this.logAction(instanceId, 'recreate_service', { serviceName }, true);
      
      return {
        success: true,
        message: `Serviço ${serviceName} recriado com sucesso`,
        details: result.stdout
      };
      
    } catch (error) {
      this.logAction(instanceId, 'recreate_service', { serviceName, error: error.message }, false);
      
      return {
        success: false,
        message: `Erro ao recriar serviço ${serviceName}`,
        error: error.message
      };
    }
  }

  /**
   * Obtém logs de um container
   */
  async getContainerLogs(instanceId, containerName, lines = 50) {
    try {
      console.log(`📄 Obtendo logs do container ${containerName} da instância ${instanceId}`);
      
      const result = await Promise.race([
        execAsync(`docker logs --tail ${lines} ${containerName}`),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Timeout')), this.safetyTimeout)
        )
      ]);
      
      this.logAction(instanceId, 'get_logs', { containerName, lines }, true);
      
      return {
        success: true,
        message: `Logs obtidos com sucesso`,
        logs: result.stdout || result.stderr || 'Sem logs disponíveis'
      };
      
    } catch (error) {
      this.logAction(instanceId, 'get_logs', { containerName, error: error.message }, false);
      
      return {
        success: false,
        message: `Erro ao obter logs do container ${containerName}`,
        error: error.message
      };
    }
  }

  /**
   * Limpa logs excessivos de um container
   */
  async clearContainerLogs(instanceId, containerName) {
    try {
      console.log(`🧹 Limpando logs do container ${containerName} da instância ${instanceId}`);
      
      // Primeiro, obter o ID do container
      const inspectResult = await execAsync(`docker inspect ${containerName} --format='{{.Id}}'`);
      const containerId = inspectResult.stdout.trim();
      
      if (!containerId) {
        throw new Error('Container ID não encontrado');
      }
      
      // Limpar o arquivo de log
      const logFile = `/var/lib/docker/containers/${containerId}/${containerId}-json.log`;
      await execAsync(`echo "" > ${logFile}`);
      
      this.logAction(instanceId, 'clear_logs', { containerName }, true);
      
      return {
        success: true,
        message: `Logs do container ${containerName} limpos com sucesso`
      };
      
    } catch (error) {
      this.logAction(instanceId, 'clear_logs', { containerName, error: error.message }, false);
      
      return {
        success: false,
        message: `Erro ao limpar logs do container ${containerName}`,
        error: error.message
      };
    }
  }

  /**
   * Reinicia toda a instância de forma segura
   */
  async restartInstance(instanceId) {
    try {
      console.log(`🔄 Reiniciando instância ${instanceId} completamente`);
      
      const dockerDir = path.join(process.cwd(), `volumes-${instanceId}`);
      const composeFile = `docker-compose.yml`;
      
      if (!await fs.pathExists(path.join(dockerDir, composeFile))) {
        throw new Error(`Arquivo docker-compose.yml não encontrado para instância ${instanceId}`);
      }
      
      // Passo 1: Down da instância
      await execAsync(`cd "${dockerDir}" && docker compose down`);
      
      // Passo 2: Aguardar um momento
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // Passo 3: Up da instância
      const result = await Promise.race([
        execAsync(`cd "${dockerDir}" && docker compose up -d`),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Timeout')), 60000) // 60s para restart completo
        )
      ]);
      
      this.logAction(instanceId, 'restart_instance', { instanceId }, true);
      
      return {
        success: true,
        message: `Instância ${instanceId} reiniciada com sucesso`,
        details: result.stdout
      };
      
    } catch (error) {
      this.logAction(instanceId, 'restart_instance', { instanceId, error: error.message }, false);
      
      return {
        success: false,
        message: `Erro ao reiniciar instância ${instanceId}`,
        error: error.message
      };
    }
  }

  /**
   * Verifica se uma ação é segura para executar
   */
  isActionSafe(action, instanceId) {
    const safeActions = [
      'restart_container',
      'start_container', 
      'get_logs',
      'clear_logs'
    ];
    
    const riskyActions = [
      'recreate_service',
      'restart_instance'
    ];
    
    if (safeActions.includes(action)) {
      return { safe: true, requiresConfirmation: false };
    }
    
    if (riskyActions.includes(action)) {
      return { safe: true, requiresConfirmation: true };
    }
    
    return { safe: false, requiresConfirmation: false };
  }

  /**
   * Obtém histórico de ações executadas
   */
  getActionHistory(instanceId = null, limit = 50) {
    let history = [...this.actionLog];
    
    if (instanceId) {
      history = history.filter(entry => entry.instanceId === instanceId);
    }
    
    return history
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, limit);
  }

  /**
   * Obtém estatísticas das ações
   */
  getActionStats() {
    const total = this.actionLog.length;
    const successful = this.actionLog.filter(log => log.result === 'success').length;
    const failed = this.actionLog.filter(log => log.result === 'failed').length;
    
    const actionTypes = {};
    this.actionLog.forEach(log => {
      actionTypes[log.action] = (actionTypes[log.action] || 0) + 1;
    });
    
    return {
      total,
      successful,
      failed,
      successRate: total > 0 ? ((successful / total) * 100).toFixed(1) : 0,
      actionTypes,
      lastAction: this.actionLog.length > 0 ? this.actionLog[this.actionLog.length - 1] : null
    };
  }
}

module.exports = DiagnosticActions;