/**
 * Servico de envio de SMS via Comtele
 */

import logger from '@adonisjs/core/services/logger'

const COMTELE_API_URL = 'https://sms.comtele.com.br/api/v2/send'
const COMTELE_API_KEY = process.env.COMTELE_API_KEY || '86369d6b-82f9-447a-8571-1b79a5a64aac'

interface SmsResponse {
  success: boolean
  message?: string
  requestId?: string
  error?: string
}

interface ComteleResponse {
  Success: boolean
  Message?: string
  Object?: {
    requestUniqueId?: string
  }
}

export default class SmsService {
  /**
   * Envia SMS via Comtele
   */
  static async enviarSms(telefone: string, mensagem: string, sender?: string): Promise<SmsResponse> {
    try {
      // Limpa o telefone (remove caracteres nao numericos)
      const telefoneLimpo = telefone.replace(/\D/g, '')

      // Valida telefone (deve ter 10 ou 11 digitos)
      if (telefoneLimpo.length < 10 || telefoneLimpo.length > 11) {
        return {
          success: false,
          error: 'Telefone invalido. Use formato DDD + numero (10 ou 11 digitos)',
        }
      }

      const payload = {
        Sender: sender || 'VotaLegis',
        Receivers: telefoneLimpo,
        Content: mensagem,
      }

      logger.info(`[SMS] Enviando para ${telefoneLimpo}: ${mensagem.substring(0, 50)}...`)

      const response = await fetch(COMTELE_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'auth-key': COMTELE_API_KEY,
        },
        body: JSON.stringify(payload),
      })

      const data = (await response.json()) as ComteleResponse

      if (data.Success) {
        logger.info(`[SMS] Enviado com sucesso. RequestId: ${data.Object?.requestUniqueId}`)
        return {
          success: true,
          message: 'SMS enviado com sucesso',
          requestId: data.Object?.requestUniqueId,
        }
      } else {
        logger.error(`[SMS] Erro ao enviar: ${data.Message || 'Erro desconhecido'}`)
        return {
          success: false,
          error: data.Message || 'Erro desconhecido ao enviar SMS',
        }
      }
    } catch (error: any) {
      logger.error(`[SMS] Excecao: ${error.message}`)
      return {
        success: false,
        error: `Erro ao enviar SMS: ${error.message}`,
      }
    }
  }

  /**
   * Envia codigo de verificacao 2FA
   */
  static async enviarCodigo2FA(telefone: string, codigo: string): Promise<SmsResponse> {
    const mensagem = `Seu codigo de verificacao e: ${codigo}. Valido por 5 minutos. Nao compartilhe este codigo.`
    return this.enviarSms(telefone, mensagem, '2FA')
  }
}
