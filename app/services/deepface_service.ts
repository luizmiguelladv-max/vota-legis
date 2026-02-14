/**
 * ===========================================================================
 * SERVIÇO DEEPFACE - Reconhecimento Facial com IA
 * ===========================================================================
 *
 * Este serviço gerencia a comunicação com a API DeepFace (Python/FastAPI),
 * que realiza reconhecimento facial usando o modelo ArcFace com 99.5% de
 * precisão.
 *
 * ARQUITETURA:
 * ------------
 * - **Frontend**: Terminal facial captura imagem da webcam
 * - **Backend (AdonisJS)**: Este serviço recebe a imagem em Base64
 * - **Microserviço (Python)**: API DeepFace processa com IA
 *
 * O microserviço DeepFace roda na porta 5000 e mantém um cache de embeddings
 * faciais em memória para reconhecimento rápido.
 *
 * MODELO DE IA:
 * -------------
 * - **Modelo**: ArcFace (Additive Angular Margin Loss)
 * - **Precisão**: 99.5% no benchmark LFW
 * - **Custo**: 100% gratuito (roda local)
 * - **Tempo**: ~200-500ms por verificação
 *
 * FLUXO DE CADASTRO:
 * ------------------
 * 1. Captura foto do funcionário (webcam ou upload)
 * 2. Envia para API DeepFace via POST /cadastrar
 * 3. API extrai embedding facial (512 dimensões)
 * 4. Salva imagem e embedding em disco
 * 5. Atualiza cache em memória
 *
 * FLUXO DE RECONHECIMENTO:
 * ------------------------
 * 1. Terminal facial captura frame da webcam
 * 2. Envia para API DeepFace via POST /reconhecer
 * 3. API extrai embedding da foto
 * 4. Compara com todos os embeddings cadastrados
 * 5. Retorna funcionário mais similar (se threshold ok)
 *
 * ESTRUTURA DE ARQUIVOS DO MICROSERVIÇO:
 * --------------------------------------
 * - deepface-api/main.py - Servidor FastAPI
 * - deepface-api/faces/ - Imagens das faces cadastradas
 * - deepface-api/faces/embeddings_cache.json - Cache de embeddings
 *
 * @author Luiz Miguel
 * @version 1.0.0
 * @since 2024-12-13
 *
 * ===========================================================================
 */

// =============================================================================
// CONFIGURAÇÃO
// =============================================================================

/**
 * URL base da API DeepFace
 *
 * O microserviço Python roda na porta 5000 por padrão.
 * Pode ser configurado via variável de ambiente DEEPFACE_URL.
 *
 * @example
 * ```bash
 * # .env
 * DEEPFACE_URL=http://192.168.0.100:5000
 * ```
 */
const DEEPFACE_URL = process.env.DEEPFACE_URL || 'http://localhost:5000'
const DEFAULT_TIMEOUT_MS = 5000

// =============================================================================
// INTERFACES DE TIPOS
// =============================================================================

/**
 * Status do serviço DeepFace
 *
 * Retornado pelo endpoint GET / da API.
 */
interface DeepFaceStatus {
  /** Status do serviço (sempre 'ok' se online) */
  status: string
  /** Modelo de reconhecimento em uso (ArcFace) */
  model: string
  /** Quantidade de faces cadastradas no sistema */
  faces_cadastradas: number
  /** Versão da API */
  version: string
}

/**
 * Resposta do cadastro de face
 *
 * Retornado pelo endpoint POST /cadastrar da API.
 */
interface CadastroResponse {
  /** Se o cadastro foi bem-sucedido */
  success: boolean
  /** ID do funcionário cadastrado */
  funcionario_id?: number
  /** Nome do funcionário */
  nome?: string
  /** Mensagem de sucesso */
  message?: string
  /** Mensagem de erro (se falhou) */
  error?: string
}

/**
 * Resposta do reconhecimento facial
 *
 * Retornado pelo endpoint POST /reconhecer da API.
 */
interface ReconhecimentoResponse {
  /** Se reconheceu alguém */
  success: boolean
  /** ID do funcionário reconhecido */
  funcionario_id?: number
  /** Nome do funcionário */
  nome?: string
  /** PIS do funcionário */
  pis?: string
  /** Confiança do reconhecimento (0-1) */
  confidence?: number
  /** Distância euclidiana (quanto menor, mais similar) */
  distance?: number
  /** Mensagem de erro */
  error?: string
}

/**
 * Lista de faces cadastradas
 *
 * Retornado pelo endpoint GET /listar da API.
 */
interface ListaFaces {
  /** Se a listagem foi bem-sucedida */
  success: boolean
  /** Total de faces cadastradas */
  total: number
  /** Array com dados de cada face */
  faces: {
    /** ID do funcionário */
    funcionario_id: number
    /** Nome do funcionário */
    nome: string
    /** PIS do funcionário */
    pis: string
  }[]
}

// =============================================================================
// CLASSE DO SERVIÇO
// =============================================================================

/**
 * Serviço de comunicação com API DeepFace
 *
 * Encapsula todas as chamadas HTTP para o microserviço Python,
 * tratando erros e convertendo respostas.
 *
 * @example
 * ```typescript
 * import { deepfaceService } from '#services/deepface_service'
 *
 * // Verificar se está online
 * const disponivel = await deepfaceService.isAvailable()
 *
 * // Cadastrar face
 * await deepfaceService.cadastrarFace(1, 'João Silva', '12345678901', fotoBase64)
 *
 * // Reconhecer face
 * const resultado = await deepfaceService.reconhecerFace(fotoBase64)
 * if (resultado.success) {
 *   console.log(`Reconhecido: ${resultado.nome} (${resultado.confidence * 100}%)`)
 * }
 * ```
 */
class DeepFaceService {
  // ===========================================================================
  // PROPRIEDADES
  // ===========================================================================

  /**
   * URL base da API (sem barra final)
   */
  private baseUrl: string

  /**
   * Executa requisição com timeout e validação de status
   */
  private async request<T>(path: string, init: RequestInit = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
    const signal = init.signal ?? AbortSignal.timeout(timeoutMs)
    const response = await fetch(`${this.baseUrl}${path}`, { ...init, signal })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(
        `DeepFace ${path} falhou (${response.status} ${response.statusText})${body ? ` - ${body}` : ''}`
      )
    }

    return (await response.json()) as T
  }

  // ===========================================================================
  // CONSTRUTOR
  // ===========================================================================

  /**
   * Inicializa o serviço com a URL da API
   *
   * Remove barra final da URL se houver para evitar URLs com //
   */
  constructor() {
    this.baseUrl = DEEPFACE_URL.replace(/\/$/, '')
  }

  // ===========================================================================
  // MÉTODOS DE VERIFICAÇÃO
  // ===========================================================================

  /**
   * Verifica se o serviço está configurado e online
   *
   * Faz uma requisição GET ao endpoint /health com timeout de 3 segundos.
   * Útil para verificar disponibilidade antes de operações críticas.
   *
   * @returns true se o serviço está disponível, false caso contrário
   *
   * @example
   * ```typescript
   * const disponivel = await deepfaceService.isAvailable()
   * if (!disponivel) {
   *   console.error('API DeepFace offline!')
   * }
   * ```
   */
  async isAvailable(): Promise<boolean> {
    try {
      await this.request('/health', { method: 'GET' }, 3000)
      return true
    } catch {
      // Qualquer erro (timeout, conexão recusada, etc) = não disponível
      return false
    }
  }

  /**
   * Obtém status detalhado do serviço
   *
   * Retorna informações como modelo em uso, faces cadastradas e versão.
   *
   * @returns Objeto com status ou null se offline/erro
   *
   * @example
   * ```typescript
   * const status = await deepfaceService.getStatus()
   * if (status) {
   *   console.log(`Modelo: ${status.model}`)
   *   console.log(`Faces: ${status.faces_cadastradas}`)
   * }
   * ```
   */
  async getStatus(): Promise<DeepFaceStatus | null> {
    try {
      return await this.request<DeepFaceStatus>('/')
    } catch (err) {
      console.error('[DeepFace] Erro ao obter status:', err)
      return null
    }
  }

  // ===========================================================================
  // CADASTRO DE FACES
  // ===========================================================================

  /**
   * Cadastra uma face no sistema de reconhecimento
   *
   * Envia a foto do funcionário para a API, que:
   * 1. Detecta o rosto na imagem
   * 2. Extrai o embedding facial (512 dimensões)
   * 3. Salva a imagem em disco (deepface-api/faces/)
   * 4. Atualiza o cache de embeddings
   *
   * REQUISITOS DA FOTO:
   * - Formato: JPEG ou PNG
   * - Tamanho recomendado: 640x480 ou maior
   * - Iluminação: Boa, sem sombras fortes
   * - Posição: Rosto frontal, olhando para câmera
   *
   * @param funcionarioId - ID único do funcionário no banco
   * @param nome - Nome completo do funcionário
   * @param pis - Número do PIS (11 dígitos)
   * @param fotoBase64 - Foto em formato Base64 (com ou sem prefixo data:image)
   * @returns Objeto com resultado do cadastro
   *
   * @example
   * ```typescript
   * // Cadastrar nova face
   * const resultado = await deepfaceService.cadastrarFace(
   *   42,
   *   'Maria Silva',
   *   '12345678901',
   *   'data:image/jpeg;base64,/9j/4AAQSkZ...'
   * )
   *
   * if (resultado.success) {
   *   console.log('Face cadastrada com sucesso!')
   * } else {
   *   console.error(`Erro: ${resultado.error}`)
   * }
   * ```
   */
  async cadastrarFace(
    funcionarioId: number,
    nome: string,
    pis: string,
    fotoBase64: string
  ): Promise<CadastroResponse> {
    try {
      console.log(`[DeepFace] Cadastrando: ${nome} (ID: ${funcionarioId})`)

      // Envia para API DeepFace
      const data = await this.request<CadastroResponse>('/cadastrar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          funcionario_id: funcionarioId,
          nome: nome,
          pis: pis,
          foto_base64: fotoBase64,
        }),
      })

      // Log do resultado
      if (data.success) {
        console.log(`[DeepFace] Cadastrado com sucesso: ${nome}`)
      } else {
        console.error(`[DeepFace] Erro ao cadastrar: ${data.error}`)
      }

      return data
    } catch (err: any) {
      // Erro de conexão ou outro erro não tratado
      console.error('[DeepFace] Erro ao cadastrar:', err)
      return { success: false, error: err.message }
    }
  }

  // ===========================================================================
  // RECONHECIMENTO FACIAL
  // ===========================================================================

  /**
   * Reconhece uma face a partir de uma foto
   *
   * Este é o método principal usado pelo terminal de ponto facial.
   * Envia uma foto e recebe de volta o funcionário mais similar.
   *
   * PROCESSO:
   * 1. API detecta rosto na foto
   * 2. Extrai embedding facial (512 dimensões)
   * 3. Calcula distância para todos os embeddings cadastrados
   * 4. Retorna o mais similar se abaixo do threshold
   *
   * THRESHOLD:
   * - Distância < 0.4: Alta confiança (reconhecido)
   * - Distância 0.4-0.6: Média confiança
   * - Distância > 0.6: Baixa confiança (não reconhecido)
   *
   * TEMPO DE RESPOSTA:
   * - ~200-500ms (depende do hardware)
   * - GPU acelera significativamente
   *
   * @param fotoBase64 - Foto em formato Base64 (com ou sem prefixo data:image)
   * @returns Objeto com resultado do reconhecimento
   *
   * @example
   * ```typescript
   * // Reconhecer face do terminal
   * const resultado = await deepfaceService.reconhecerFace(frameBase64)
   *
   * if (resultado.success) {
   *   console.log(`Reconhecido: ${resultado.nome}`)
   *   console.log(`Confiança: ${(resultado.confidence * 100).toFixed(1)}%`)
   *   console.log(`PIS: ${resultado.pis}`)
   *   console.log(`ID: ${resultado.funcionario_id}`)
   *
   *   // Registrar ponto...
   * } else {
   *   console.log('Nenhum rosto reconhecido')
   * }
   * ```
   */
  async reconhecerFace(fotoBase64: string): Promise<ReconhecimentoResponse> {
    try {
      // Envia para API DeepFace
      const data = await this.request<ReconhecimentoResponse>('/reconhecer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ foto_base64: fotoBase64 }),
      })

      // Log se reconheceu
      if (data.success) {
        console.log(
          `[DeepFace] Reconhecido: ${data.nome} (confiança: ${((data.confidence || 0) * 100).toFixed(1)}%)`
        )
      }

      return data
    } catch (err: any) {
      // Erro de conexão ou outro erro não tratado
      console.error('[DeepFace] Erro ao reconhecer:', err)
      return { success: false, error: err.message }
    }
  }

  // ===========================================================================
  // GERENCIAMENTO DE FACES
  // ===========================================================================

  /**
   * Remove uma face cadastrada
   *
   * Deleta a imagem e o embedding do funcionário do sistema.
   * Útil quando um funcionário é desligado ou troca de foto.
   *
   * @param funcionarioId - ID do funcionário a remover
   * @returns true se removido com sucesso, false caso contrário
   *
   * @example
   * ```typescript
   * // Remover face do funcionário desligado
   * const removido = await deepfaceService.removerFace(42)
   * if (removido) {
   *   console.log('Face removida com sucesso')
   * }
   * ```
   */
  async removerFace(funcionarioId: number): Promise<boolean> {
    try {
      const data = await this.request<{ success: boolean }>(`/remover/${funcionarioId}`, {
        method: 'DELETE',
      })
      return data.success === true
    } catch (err) {
      console.error('[DeepFace] Erro ao remover:', err)
      return false
    }
  }

  /**
   * Lista todas as faces cadastradas
   *
   * Retorna informações básicas de todos os funcionários
   * que possuem face cadastrada no sistema.
   *
   * @returns Objeto com lista de faces ou lista vazia em erro
   *
   * @example
   * ```typescript
   * const lista = await deepfaceService.listarFaces()
   * console.log(`Total: ${lista.total} faces cadastradas`)
   *
   * for (const face of lista.faces) {
   *   console.log(`- ${face.nome} (ID: ${face.funcionario_id})`)
   * }
   * ```
   */
  async listarFaces(): Promise<ListaFaces> {
    try {
      return await this.request<ListaFaces>('/listar')
    } catch (err: any) {
      console.error('[DeepFace] Erro ao listar:', err)
      return { success: false, total: 0, faces: [] }
    }
  }

  /**
   * Sincroniza o cache de embeddings
   *
   * Força a API a recarregar todos os embeddings do disco.
   * Útil após operações em lote ou sincronização manual.
   *
   * O cache fica em: deepface-api/faces/embeddings_cache.json
   *
   * @returns true se sincronizado com sucesso, false caso contrário
   *
   * @example
   * ```typescript
   * // Após importação em lote de fotos
   * const ok = await deepfaceService.sincronizar()
   * if (ok) {
   *   console.log('Cache de embeddings atualizado')
   * }
   * ```
   */
  async sincronizar(): Promise<boolean> {
    try {
      const data = await this.request<{ success: boolean }>('/sincronizar', {
        method: 'POST',
      })
      return data.success === true
    } catch (err) {
      console.error('[DeepFace] Erro ao sincronizar:', err)
      return false
    }
  }
}

// =============================================================================
// EXPORTAÇÕES
// =============================================================================

/**
 * Instância do serviço DeepFace
 *
 * Use esta exportação em qualquer parte do código:
 *
 * @example
 * ```typescript
 * import { deepfaceService } from '#services/deepface_service'
 *
 * // Verificar disponibilidade
 * const online = await deepfaceService.isAvailable()
 *
 * // Reconhecer face
 * const resultado = await deepfaceService.reconhecerFace(foto)
 * ```
 */
export const deepfaceService = new DeepFaceService()

/**
 * Exportação default (mesmo que deepfaceService)
 */
export default deepfaceService
