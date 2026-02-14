/**
 * ===========================================================================
 * FUTRONIC PROVIDER
 * ===========================================================================
 *
 * Provider do AdonisJS que inicializa automaticamente o serviço Python
 * da Futronic API para leitura de digitais com o leitor FS80H.
 *
 * Este provider é executado durante o boot da aplicação e garante que o
 * servidor Python (porta 5001) esteja disponível para:
 * - Capturar digitais do leitor USB
 * - Cadastrar templates de funcionários
 * - Verificar identidade por digital
 *
 * @author Claude
 * @version 1.0.0
 * @since 2024-12-14
 *
 * ===========================================================================
 * CICLO DE VIDA DO PROVIDER
 * ===========================================================================
 *
 * 1. register()  - Registra bindings no container (não usado aqui)
 * 2. boot()      - Container pronto, mas servidor ainda não iniciou
 * 3. start()     - Aplicação iniciando
 * 4. ready()     - Servidor HTTP pronto - AQUI INICIAMOS A FUTRONIC API
 * 5. shutdown()  - Aplicação encerrando - AQUI PARAMOS A FUTRONIC API
 *
 * ===========================================================================
 */

import type { ApplicationService } from '@adonisjs/core/types'
import { spawn, ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

/**
 * Provider responsável por inicializar o serviço Python Futronic API
 */
export default class FutronicProvider {
  /**
   * Referência ao serviço de aplicação do AdonisJS
   */
  constructor(protected app: ApplicationService) {}

  /**
   * Processo Python da Futronic API
   */
  private pythonProcess: ChildProcess | null = null

  /**
   * Flag indicando se o processo está rodando
   */
  private isRunning = false

  /**
   * Flag para controlar se deve reiniciar automaticamente
   */
  private shouldAutoRestart = true

  /**
   * Contador de reinícios (apenas para logging)
   */
  private restartCount = 0

  /**
   * Intervalo para resetar contador de reinícios (5 minutos)
   */
  private restartResetInterval: NodeJS.Timeout | null = null

  /**
   * URL da API
   */
  private readonly apiUrl = process.env.FUTRONIC_URL || 'http://localhost:5001'

  /**
   * Porta do servidor
   */
  private readonly port = 5001

  /**
   * Diretório da API Python
   */
  private get apiDir(): string {
    return path.join(process.cwd(), 'futronic-api')
  }

  /**
   * Caminho para o executável Python 32-bit (necessário para SDK Futronic)
   */
  private get pythonPath(): string {
    const isWindows = process.platform === 'win32'

    if (isWindows) {
      // Primeiro tenta Python 32-bit embarcado (necessário para DLL 32-bit do SDK)
      const python32Path = path.join(this.apiDir, 'python32', 'python.exe')
      if (existsSync(python32Path)) {
        return python32Path
      }
      // Fallback para venv padrão
      return path.join(this.apiDir, 'venv', 'Scripts', 'python.exe')
    }
    return path.join(this.apiDir, 'venv', 'bin', 'python')
  }

  /**
   * Verifica se o Python existe
   */
  private hasVenv(): boolean {
    return existsSync(this.pythonPath)
  }

  /**
   * Verifica se a API está respondendo
   */
  private async checkHealth(): Promise<boolean> {
    try {
      const response = await fetch(`${this.apiUrl}/health`, {
        signal: AbortSignal.timeout(3000),
      })
      return response.ok
    } catch {
      return false
    }
  }

  /**
   * Aguarda a API ficar disponível
   */
  private async waitForApi(maxAttempts = 30): Promise<boolean> {
    for (let i = 0; i < maxAttempts; i++) {
      if (await this.checkHealth()) {
        return true
      }
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
    return false
  }

  /**
   * Inicia o processo Python
   */
  private async startPythonProcess(): Promise<void> {
    return new Promise((resolve, reject) => {
      const mainPy = path.join(this.apiDir, 'main.py')

      if (!existsSync(mainPy)) {
        reject(new Error(`Arquivo main.py não encontrado em ${this.apiDir}`))
        return
      }

      if (!this.hasVenv()) {
        reject(
          new Error(
            `Python 32-bit não encontrado. A Futronic API requer Python 32-bit para o SDK. Verifique se a pasta python32 existe em futronic-api/`
          )
        )
        return
      }

      console.log(`[Futronic Provider] Iniciando processo Python...`)
      console.log(`[Futronic Provider] → Python: ${this.pythonPath}`)
      console.log(`[Futronic Provider] → Script: ${mainPy}`)

      this.pythonProcess = spawn(this.pythonPath, [mainPy], {
        cwd: this.apiDir,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          PYTHONUNBUFFERED: '1',
        },
      })

      // Captura stdout
      this.pythonProcess.stdout?.on('data', (data: Buffer) => {
        const output = data.toString().trim()
        if (output) {
          console.log(`[Futronic API] ${output}`)
        }
      })

      // Captura stderr
      this.pythonProcess.stderr?.on('data', (data: Buffer) => {
        const output = data.toString().trim()
        if (output) {
          // Filtra warnings comuns do Python
          if (!output.includes('DeprecationWarning') && !output.includes('FutureWarning')) {
            console.error(`[Futronic API] ${output}`)
          }
        }
      })

      // Evento de erro
      this.pythonProcess.on('error', (error) => {
        console.error(`[Futronic Provider] Erro no processo Python:`, error)
        this.isRunning = false
      })

      // Evento de encerramento com auto-restart
      this.pythonProcess.on('close', (code) => {
        this.isRunning = false
        this.pythonProcess = null

        if (code !== 0 && code !== null) {
          console.error(`[Futronic Provider] Processo Python encerrou com código ${code}`)

          // Auto-restart SEMPRE (serviço crítico) com backoff exponencial
          if (this.shouldAutoRestart) {
            this.restartCount++

            // Backoff exponencial: 2s, 4s, 8s, 16s... até máximo de 30s
            const baseDelay = 2000
            const delay = Math.min(baseDelay * Math.pow(2, this.restartCount - 1), 30000)

            console.log(
              `[Futronic Provider] 🔄 Reiniciando automaticamente (reinício #${this.restartCount}, aguardando ${delay/1000}s)...`
            )

            setTimeout(async () => {
              try {
                await this.startPythonProcess()
                const available = await this.waitForApi(10)
                if (available) {
                  console.log('[Futronic Provider] ✅ Futronic API reiniciada com sucesso')
                }
              } catch (err) {
                console.error('[Futronic Provider] ❌ Falha ao reiniciar:', err)
                // Tenta novamente com delay maior
                setTimeout(() => this.startPythonProcess(), delay * 2)
              }
            }, delay)
          }
        }
      })

      // Considera iniciado após spawn
      this.isRunning = true
      resolve()
    })
  }

  /**
   * ===========================================================================
   * REGISTER - Registro de Bindings
   * ===========================================================================
   */
  register() {
    // Sem bindings necessários
  }

  /**
   * ===========================================================================
   * BOOT - Container Inicializado
   * ===========================================================================
   */
  async boot() {
    // Nada a fazer nesta fase
  }

  /**
   * ===========================================================================
   * START - Aplicação Iniciando
   * ===========================================================================
   */
  async start() {
    // Nada a fazer nesta fase
  }

  /**
   * ===========================================================================
   * READY - Servidor HTTP Pronto
   * ===========================================================================
   *
   * Aqui iniciamos o servidor Python da Futronic API.
   */
  async ready() {
    try {
      console.log('[Futronic Provider] Iniciando serviço Futronic API...')

      // Verifica se já está rodando (iniciado externamente)
      if (await this.checkHealth()) {
        console.log('[Futronic Provider] ✅ Futronic API já está rodando externamente')
        console.log(`[Futronic Provider] → API disponível em ${this.apiUrl}`)
        return
      }

      // Verifica se o diretório existe
      if (!existsSync(this.apiDir)) {
        console.warn('[Futronic Provider] ⚠️ Diretório futronic-api não encontrado')
        console.warn('[Futronic Provider] → Funcionalidades de digital USB não estarão disponíveis')
        return
      }

      // Verifica se o Python 32-bit existe
      if (!this.hasVenv()) {
        console.warn('[Futronic Provider] ⚠️ Python 32-bit não encontrado')
        console.warn('[Futronic Provider] → A Futronic API requer Python 32-bit para o SDK')
        console.warn('[Futronic Provider] → Verifique se a pasta python32 existe em futronic-api/')
        return
      }

      // Inicia o processo Python
      await this.startPythonProcess()

      // Aguarda a API ficar disponível
      console.log('[Futronic Provider] Aguardando API ficar disponível...')
      const available = await this.waitForApi(15)

      if (available) {
        console.log('[Futronic Provider] ✅ Futronic API inicializada com sucesso')
        console.log(`[Futronic Provider] → API disponível em ${this.apiUrl}`)
        console.log('[Futronic Provider] → Endpoints: /cadastrar, /verificar, /capturar, /listar')
        console.log('[Futronic Provider] → Auto-restart: HABILITADO')

        // Reseta contador de reinícios a cada 5 minutos de estabilidade
        this.restartResetInterval = setInterval(() => {
          if (this.restartCount > 0) {
            console.log('[Futronic Provider] ✅ API estável - resetando contador de reinícios')
            this.restartCount = 0
          }
        }, 5 * 60 * 1000)
      } else {
        console.warn('[Futronic Provider] ⚠️ API iniciada mas não respondeu a tempo')
        console.warn('[Futronic Provider] → Verifique os logs acima para erros')
      }
    } catch (error) {
      console.error('[Futronic Provider] ❌ Erro ao inicializar Futronic API:', error)
      console.error('[Futronic Provider] → Funcionalidades de digital USB não estarão disponíveis')
    }
  }

  /**
   * ===========================================================================
   * SHUTDOWN - Aplicação Encerrando
   * ===========================================================================
   */
  async shutdown() {
    // Desabilita auto-restart durante shutdown
    this.shouldAutoRestart = false

    // Limpa o intervalo de reset
    if (this.restartResetInterval) {
      clearInterval(this.restartResetInterval)
      this.restartResetInterval = null
    }

    try {
      if (this.pythonProcess && this.isRunning) {
        console.log('[Futronic Provider] Encerrando Futronic API...')

        // Tenta encerrar graciosamente
        this.pythonProcess.kill('SIGTERM')

        // Aguarda até 5 segundos
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(() => {
            // Force kill se não encerrou
            if (this.pythonProcess) {
              this.pythonProcess.kill('SIGKILL')
            }
            resolve()
          }, 5000)

          this.pythonProcess?.on('close', () => {
            clearTimeout(timeout)
            resolve()
          })
        })

        console.log('[Futronic Provider] ✅ Futronic API encerrada com sucesso')
      }
    } catch (error) {
      console.error('[Futronic Provider] ❌ Erro ao encerrar Futronic API:', error)
    } finally {
      this.pythonProcess = null
      this.isRunning = false
    }
  }
}
