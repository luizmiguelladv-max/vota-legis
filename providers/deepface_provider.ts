/**
 * ===========================================================================
 * DEEPFACE PROVIDER
 * ===========================================================================
 *
 * Provider do AdonisJS que inicializa automaticamente o serviço Python
 * da DeepFace API para reconhecimento facial.
 *
 * Este provider é executado durante o boot da aplicação e garante que o
 * servidor Python (porta 5000) esteja disponível para:
 * - Cadastrar faces de funcionários
 * - Reconhecer funcionários pela face
 * - Gerenciar embeddings faciais
 *
 * @author Claude
 * @version 1.1.0
 * @since 2024-12-14
 *
 * ===========================================================================
 * CICLO DE VIDA DO PROVIDER
 * ===========================================================================
 *
 * 1. register()  - Registra bindings no container (não usado aqui)
 * 2. boot()      - Container pronto, mas servidor ainda não iniciou
 * 3. start()     - Aplicação iniciando
 * 4. ready()     - Servidor HTTP pronto - AQUI INICIAMOS A DEEPFACE API
 * 5. shutdown()  - Aplicação encerrando - AQUI PARAMOS A DEEPFACE API
 *
 * ===========================================================================
 */

import type { ApplicationService } from '@adonisjs/core/types'
import { spawn, ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

/**
 * Provider responsável por inicializar o serviço Python DeepFace API
 */
export default class DeepfaceProvider {
  /**
   * Referência ao serviço de aplicação do AdonisJS
   */
  constructor(protected app: ApplicationService) {}

  /**
   * Processo Python da DeepFace API
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
  private readonly apiUrl = process.env.DEEPFACE_URL || 'http://localhost:5000'

  /**
   * Porta do servidor
   */
  private readonly port = 5000

  /**
   * Diretório da API Python
   */
  private get apiDir(): string {
    return path.join(process.cwd(), 'deepface-api')
  }

  /**
   * Caminho para o executável Python
   */
  private get pythonPath(): string {
    const isWindows = process.platform === 'win32'
    const venvPath = path.join(this.apiDir, 'venv')

    if (isWindows) {
      return path.join(venvPath, 'Scripts', 'python.exe')
    }
    return path.join(venvPath, 'bin', 'python')
  }

  /**
   * Verifica se o ambiente virtual existe
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
  private async waitForApi(maxAttempts = 60): Promise<boolean> {
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
            `Ambiente virtual não encontrado. Execute: cd deepface-api && ${process.platform === 'win32' ? 'install.bat' : './install.sh'}`
          )
        )
        return
      }

      console.log(`[DeepFace Provider] Iniciando processo Python...`)
      console.log(`[DeepFace Provider] → Python: ${this.pythonPath}`)
      console.log(`[DeepFace Provider] → Script: ${mainPy}`)

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
          console.log(`[DeepFace API] ${output}`)
        }
      })

      // Captura stderr
      this.pythonProcess.stderr?.on('data', (data: Buffer) => {
        const output = data.toString().trim()
        if (output) {
          // Filtra warnings comuns do Python/TensorFlow
          if (
            !output.includes('DeprecationWarning') &&
            !output.includes('FutureWarning') &&
            !output.includes('UserWarning') &&
            !output.includes('tensorflow') &&
            !output.includes('oneDNN') &&
            !output.includes('TF_ENABLE_ONEDNN')
          ) {
            console.error(`[DeepFace API] ${output}`)
          }
        }
      })

      // Evento de erro
      this.pythonProcess.on('error', (error) => {
        console.error(`[DeepFace Provider] Erro no processo Python:`, error)
        this.isRunning = false
      })

      // Evento de encerramento com auto-restart e backoff exponencial
      this.pythonProcess.on('close', (code) => {
        this.isRunning = false
        this.pythonProcess = null

        if (code !== 0 && code !== null) {
          console.error(`[DeepFace Provider] Processo Python encerrou com código ${code}`)

          // Auto-restart SEMPRE (serviço crítico) com backoff exponencial
          if (this.shouldAutoRestart) {
            this.restartCount++

            // Backoff exponencial: 3s, 6s, 12s, 24s... até máximo de 60s
            const baseDelay = 3000
            const delay = Math.min(baseDelay * Math.pow(2, this.restartCount - 1), 60000)

            console.log(
              `[DeepFace Provider] 🔄 Reiniciando automaticamente (reinício #${this.restartCount}, aguardando ${delay/1000}s)...`
            )

            setTimeout(async () => {
              try {
                await this.startPythonProcess()
                const available = await this.waitForApi(30)
                if (available) {
                  console.log('[DeepFace Provider] ✅ DeepFace API reiniciada com sucesso')
                }
              } catch (err) {
                console.error('[DeepFace Provider] ❌ Falha ao reiniciar:', err)
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
   * Aqui iniciamos o servidor Python da DeepFace API.
   */
  async ready() {
    try {
      console.log('[DeepFace Provider] Iniciando serviço DeepFace API...')

      // Verifica se já está rodando (iniciado externamente)
      if (await this.checkHealth()) {
        console.log('[DeepFace Provider] ✅ DeepFace API já está rodando externamente')
        console.log(`[DeepFace Provider] → API disponível em ${this.apiUrl}`)
        return
      }

      // Verifica se o diretório existe
      if (!existsSync(this.apiDir)) {
        console.warn('[DeepFace Provider] ⚠️ Diretório deepface-api não encontrado')
        console.warn('[DeepFace Provider] → Funcionalidades de reconhecimento facial não estarão disponíveis')
        return
      }

      // Verifica se o venv existe
      if (!this.hasVenv()) {
        console.warn('[DeepFace Provider] ⚠️ Ambiente virtual não encontrado')
        console.warn(
          `[DeepFace Provider] → Execute: cd deepface-api && ${process.platform === 'win32' ? 'install.bat' : './install.sh'}`
        )
        return
      }

      // Inicia o processo Python
      await this.startPythonProcess()

      // Aguarda a API ficar disponível (DeepFace pode demorar mais para carregar o modelo)
      console.log('[DeepFace Provider] Aguardando API ficar disponível (pode demorar para carregar o modelo)...')
      const available = await this.waitForApi(60) // 60 segundos para DeepFace carregar modelo

      if (available) {
        console.log('[DeepFace Provider] ✅ DeepFace API inicializada com sucesso')
        console.log(`[DeepFace Provider] → API disponível em ${this.apiUrl}`)
        console.log('[DeepFace Provider] → Endpoints: /cadastrar, /reconhecer, /remover, /listar')
        console.log('[DeepFace Provider] → Auto-restart: HABILITADO')

        // Reseta contador de reinícios a cada 5 minutos de estabilidade
        this.restartResetInterval = setInterval(() => {
          if (this.restartCount > 0) {
            console.log('[DeepFace Provider] ✅ API estável - resetando contador de reinícios')
            this.restartCount = 0
          }
        }, 5 * 60 * 1000)
      } else {
        console.warn('[DeepFace Provider] ⚠️ API iniciada mas não respondeu a tempo')
        console.warn('[DeepFace Provider] → O modelo pode ainda estar carregando, aguarde alguns segundos')
      }
    } catch (error) {
      console.error('[DeepFace Provider] ❌ Erro ao inicializar DeepFace API:', error)
      console.error('[DeepFace Provider] → Funcionalidades de reconhecimento facial não estarão disponíveis')
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
        console.log('[DeepFace Provider] Encerrando DeepFace API...')

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

        console.log('[DeepFace Provider] ✅ DeepFace API encerrada com sucesso')
      }
    } catch (error) {
      console.error('[DeepFace Provider] ❌ Erro ao encerrar DeepFace API:', error)
    } finally {
      this.pythonProcess = null
      this.isRunning = false
    }
  }
}
