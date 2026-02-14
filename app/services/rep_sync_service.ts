/**
 * ===========================================================================
 * REP SYNC SERVICE
 * ===========================================================================
 *
 * Serviço de sincronização automática com equipamentos REP Control iD.
 * Busca batidas do REP a cada intervalo configurado e importa para o banco.
 *
 * IMPORTANTE: Este é um serviço CRÍTICO para o sistema de ponto.
 * Possui auto-restart INFINITO para garantir que nunca pare.
 *
 * @author Claude
 * @version 1.1.0
 * @since 2024-12-14
 *
 * ===========================================================================
 */

import { spawn, ChildProcess } from 'node:child_process'
import path from 'node:path'

class RepSyncService {
  /**
   * Processo do serviço de sincronização
   */
  private syncProcess: ChildProcess | null = null

  /**
   * Flag indicando se o serviço está rodando
   */
  private running = false

  /**
   * Flag para controlar se deve reiniciar automaticamente
   * SEMPRE true para este serviço crítico
   */
  private shouldAutoRestart = true

  /**
   * Contador de reinícios (apenas para logging)
   */
  private restartCount = 0

  /**
   * Intervalo para resetar contador de reinícios (10 minutos)
   */
  private restartResetInterval: NodeJS.Timeout | null = null

  /**
   * Inicia o serviço de sincronização
   */
  async start(): Promise<void> {
    if (this.running) {
      console.log('[REP Sync Service] Serviço já está rodando')
      return
    }

    return new Promise((resolve, reject) => {
      const scriptPath = path.join(process.cwd(), 'scripts', 'servico-sincronizacao.mjs')

      console.log('[REP Sync Service] Iniciando serviço de sincronização...')
      console.log(`[REP Sync Service] → Script: ${scriptPath}`)

      this.syncProcess = spawn('node', ['--insecure-http-parser', scriptPath], {
        cwd: process.cwd(),
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
        },
      })

      // Captura stdout
      this.syncProcess.stdout?.on('data', (data: Buffer) => {
        const output = data.toString().trim()
        if (output) {
          // Filtra mensagens repetitivas para não poluir o console
          if (
            !output.includes('Próxima sincronização em') &&
            !output.includes('Iniciando sincronização MULTI-TENANT') &&
            !output.includes('município(s) encontrado') &&
            !output.includes('equipamento(s) encontrado') &&
            !output.includes('funcionários mapeados') &&
            !output.includes('──────────────────') &&
            !output.includes('Sincronização concluída') &&
            !output.includes('0 novos registros')
          ) {
            console.log(`[REP Sync] ${output}`)
          }
        }
      })

      // Captura stderr
      this.syncProcess.stderr?.on('data', (data: Buffer) => {
        const output = data.toString().trim()
        if (output) {
          // Filtra warnings comuns do Node.js
          if (!output.includes('insecure HTTP parsing') && !output.includes('trace-warnings')) {
            console.error(`[REP Sync] ${output}`)
          }
        }
      })

      // Evento de erro
      this.syncProcess.on('error', (error) => {
        console.error(`[REP Sync Service] Erro no processo:`, error)
        this.running = false
      })

      // Evento de encerramento com auto-restart INFINITO
      this.syncProcess.on('close', (code) => {
        this.running = false
        this.syncProcess = null

        if (code !== 0 && code !== null) {
          console.error(`[REP Sync Service] Processo encerrou com código ${code}`)

          // Auto-restart SEMPRE (serviço crítico) com backoff exponencial
          if (this.shouldAutoRestart) {
            this.restartCount++

            // Backoff exponencial: 5s, 10s, 20s, 40s... até máximo de 60s
            const baseDelay = 5000
            const delay = Math.min(baseDelay * Math.pow(2, this.restartCount - 1), 60000)

            console.log(
              `[REP Sync Service] 🔄 Reiniciando automaticamente (reinício #${this.restartCount}, aguardando ${delay/1000}s)...`
            )

            setTimeout(async () => {
              try {
                await this.start()
                console.log('[REP Sync Service] ✅ Serviço reiniciado com sucesso')
              } catch (err) {
                console.error('[REP Sync Service] ❌ Falha ao reiniciar:', err)
                // Tenta novamente com delay maior
                setTimeout(() => this.start(), delay * 2)
              }
            }, delay)
          }
        }
      })

      // Considera iniciado após spawn
      this.running = true

      // Reseta contador de reinícios a cada 10 minutos de estabilidade
      this.restartResetInterval = setInterval(() => {
        if (this.restartCount > 0) {
          console.log('[REP Sync Service] ✅ Serviço estável - resetando contador de reinícios')
          this.restartCount = 0
        }
      }, 10 * 60 * 1000)

      resolve()
    })
  }

  /**
   * Para o serviço de sincronização
   */
  async stop(): Promise<void> {
    // Desabilita auto-restart durante shutdown
    this.shouldAutoRestart = false

    // Limpa o intervalo de reset
    if (this.restartResetInterval) {
      clearInterval(this.restartResetInterval)
      this.restartResetInterval = null
    }

    if (this.syncProcess && this.running) {
      console.log('[REP Sync Service] Encerrando serviço de sincronização...')

      return new Promise((resolve) => {
        const timeout = setTimeout(() => {
          // Force kill se não encerrou
          if (this.syncProcess) {
            this.syncProcess.kill('SIGKILL')
          }
          resolve()
        }, 5000)

        this.syncProcess?.on('close', () => {
          clearTimeout(timeout)
          resolve()
        })

        // Tenta encerrar graciosamente
        this.syncProcess?.kill('SIGTERM')
      })
    }

    this.syncProcess = null
    this.running = false
  }

  /**
   * Verifica se o serviço está rodando
   */
  isRunning(): boolean {
    return this.running
  }

  /**
   * Retorna estatísticas do serviço
   */
  getStats(): { running: boolean; restartCount: number } {
    return {
      running: this.running,
      restartCount: this.restartCount,
    }
  }
}

// Exporta instância singleton
export const repSyncService = new RepSyncService()
