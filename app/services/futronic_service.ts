/**
 * Futronic Service
 * ================
 *
 * Serviço para comunicação com a API Futronic (leitor de digital FS80H).
 * A API Python roda na porta 5001.
 *
 * Uso:
 *   import { futronicService } from '#services/futronic_service'
 *   await futronicService.isAvailable()
 *   await futronicService.cadastrarDigital(funcionarioId, nome, pis, templateBase64)
 *   const result = await futronicService.verificarDigital(templateBase64)
 */

import env from '#start/env'

const FUTRONIC_URL = env.get('FUTRONIC_URL', 'http://localhost:5001')

interface StatusResponse {
  status: string
  device_connected: boolean
  templates_cadastrados: number
  version: string
}

interface CadastrarResponse {
  success: boolean
  funcionario_id?: number
  nome?: string
  message?: string
  error?: string
}

interface VerificarResponse {
  success: boolean
  funcionario_id?: number
  nome?: string
  pis?: string
  confidence?: number
  error?: string
}

interface CapturarResponse {
  success: boolean
  template_base64?: string
  message?: string
  error?: string
  simulated?: boolean
}

interface ListarResponse {
  success: boolean
  total: number
  digitais: Array<{
    funcionario_id: number
    nome: string
    pis: string
    cadastrado_em?: string
  }>
}

class FutronicService {
  private baseUrl: string

  constructor() {
    this.baseUrl = FUTRONIC_URL
  }

  /**
   * Verifica se a API Futronic está disponível
   */
  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(3000),
      })
      return response.ok
    } catch {
      return false
    }
  }

  /**
   * Obtém o status da API e do dispositivo
   */
  async getStatus(): Promise<StatusResponse | null> {
    try {
      const response = await fetch(`${this.baseUrl}/`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      })

      if (!response.ok) {
        return null
      }

      return await response.json()
    } catch (error) {
      console.error('[FutronicService] Erro ao obter status:', error)
      return null
    }
  }

  /**
   * Verifica se o leitor está conectado
   */
  async isDeviceConnected(): Promise<boolean> {
    const status = await this.getStatus()
    return status?.device_connected ?? false
  }

  /**
   * Captura uma digital do leitor
   */
  async capturarDigital(): Promise<CapturarResponse> {
    try {
      const response = await fetch(`${this.baseUrl}/capturar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(15000), // 15s timeout para captura
      })

      return await response.json()
    } catch (error) {
      console.error('[FutronicService] Erro ao capturar:', error)
      return {
        success: false,
        error: 'Erro ao conectar com a API Futronic',
      }
    }
  }

  /**
   * Simula uma captura de digital (para testes)
   */
  async simularCaptura(): Promise<CapturarResponse> {
    try {
      const response = await fetch(`${this.baseUrl}/simular/captura`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(5000),
      })

      return await response.json()
    } catch (error) {
      console.error('[FutronicService] Erro ao simular captura:', error)
      return {
        success: false,
        error: 'Erro ao conectar com a API Futronic',
      }
    }
  }

  /**
   * Cadastra uma digital
   */
  async cadastrarDigital(
    funcionarioId: number,
    nome: string,
    pis: string,
    templateBase64?: string
  ): Promise<CadastrarResponse> {
    try {
      const response = await fetch(`${this.baseUrl}/cadastrar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          funcionario_id: funcionarioId,
          nome,
          pis,
          template_base64: templateBase64,
        }),
        signal: AbortSignal.timeout(10000),
      })

      return await response.json()
    } catch (error) {
      console.error('[FutronicService] Erro ao cadastrar:', error)
      return {
        success: false,
        error: 'Erro ao conectar com a API Futronic',
      }
    }
  }

  /**
   * Verifica uma digital contra as cadastradas
   */
  async verificarDigital(templateBase64: string): Promise<VerificarResponse> {
    try {
      const response = await fetch(`${this.baseUrl}/verificar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          template_base64: templateBase64,
        }),
        signal: AbortSignal.timeout(10000),
      })

      return await response.json()
    } catch (error) {
      console.error('[FutronicService] Erro ao verificar:', error)
      return {
        success: false,
        error: 'Erro ao conectar com a API Futronic',
      }
    }
  }

  /**
   * Remove uma digital cadastrada
   */
  async removerDigital(funcionarioId: number): Promise<{ success: boolean; message?: string; error?: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/remover/${funcionarioId}`, {
        method: 'DELETE',
        signal: AbortSignal.timeout(5000),
      })

      return await response.json()
    } catch (error) {
      console.error('[FutronicService] Erro ao remover:', error)
      return {
        success: false,
        error: 'Erro ao conectar com a API Futronic',
      }
    }
  }

  /**
   * Lista todas as digitais cadastradas
   */
  async listarDigitais(): Promise<ListarResponse> {
    try {
      const response = await fetch(`${this.baseUrl}/listar`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      })

      return await response.json()
    } catch (error) {
      console.error('[FutronicService] Erro ao listar:', error)
      return {
        success: false,
        total: 0,
        digitais: [],
      }
    }
  }

  /**
   * Sincroniza o cache de templates
   */
  async sincronizar(): Promise<{ success: boolean; templates_carregados?: number }> {
    try {
      const response = await fetch(`${this.baseUrl}/sincronizar`, {
        method: 'POST',
        signal: AbortSignal.timeout(5000),
      })

      return await response.json()
    } catch (error) {
      console.error('[FutronicService] Erro ao sincronizar:', error)
      return {
        success: false,
      }
    }
  }

  /**
   * Tenta reconectar ao dispositivo
   */
  async reconectarDispositivo(): Promise<{ success: boolean; message?: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/device/reconnect`, {
        method: 'POST',
        signal: AbortSignal.timeout(5000),
      })

      return await response.json()
    } catch (error) {
      console.error('[FutronicService] Erro ao reconectar:', error)
      return {
        success: false,
        message: 'Erro ao conectar com a API Futronic',
      }
    }
  }
}

// Exporta instância singleton
export const futronicService = new FutronicService()
export default futronicService
