/**
 * Serviço de envio de SMS via Comtele
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

export default class SmsService {
  /**
   * Envia SMS via Comtele
   */
  static async enviarSms(telefone: string, mensagem: string, sender?: string): Promise<SmsResponse> {
    try {
      // Limpa o telefone (remove caracteres não numéricos)
      const telefoneLimpo = telefone.replace(/\D/g, '')

      // Valida telefone (deve ter 10 ou 11 dígitos)
      if (telefoneLimpo.length < 10 || telefoneLimpo.length > 11) {
        return {
          success: false,
          error: 'Telefone inválido. Use formato DDD + número (10 ou 11 dígitos)',
        }
      }

      const payload = {
        Sender: sender || 'PontoEletronico',
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

      const data = await response.json()

      if (data.Success) {
        logger.info(`[SMS] Enviado com sucesso. RequestId: ${data.Object?.requestUniqueId}`)
        return {
          success: true,
          message: 'SMS enviado com sucesso',
          requestId: data.Object?.requestUniqueId,
        }
      } else {
        logger.error(`[SMS] Erro ao enviar: ${data.Message || JSON.stringify(data)}`)
        return {
          success: false,
          error: data.Message || 'Erro desconhecido ao enviar SMS',
        }
      }
    } catch (error: any) {
      logger.error(`[SMS] Exceção: ${error.message}`)
      return {
        success: false,
        error: `Erro ao enviar SMS: ${error.message}`,
      }
    }
  }

  /**
   * Envia código de verificação 2FA
   */
  static async enviarCodigo2FA(telefone: string, codigo: string): Promise<SmsResponse> {
    const mensagem = `Seu codigo de verificacao e: ${codigo}. Valido por 5 minutos. Nao compartilhe este codigo.`
    return this.enviarSms(telefone, mensagem, '2FA')
  }

  /**
   * Notificação de banco de horas
   */
  static async notificarBancoHoras(telefone: string, dados: {
    funcionario: string
    saldo: string
    tipo: 'positivo' | 'negativo'
  }): Promise<SmsResponse> {
    const alerta = dados.tipo === 'positivo'
      ? 'proximo do limite maximo'
      : 'negativo em nivel critico'
    const mensagem = `PONTO: Banco de horas de ${dados.funcionario} esta ${alerta}. Saldo: ${dados.saldo}`
    return this.enviarSms(telefone, mensagem)
  }

  /**
   * Notificação de aprovação pendente
   */
  static async notificarAprovacaoPendente(telefone: string, dados: {
    tipo: string
    funcionario: string
  }): Promise<SmsResponse> {
    const mensagem = `PONTO: Aprovacao pendente - ${dados.tipo} de ${dados.funcionario}. Acesse o sistema.`
    return this.enviarSms(telefone, mensagem)
  }

  /**
   * Alerta genérico
   */
  static async notificarAlerta(telefone: string, titulo: string, mensagem: string): Promise<SmsResponse> {
    const msg = `PONTO: ${titulo} - ${mensagem}`.substring(0, 160)
    return this.enviarSms(telefone, msg)
  }

  /**
   * Testa se o serviço está configurado
   */
  static isEnabled(): boolean {
    return !!COMTELE_API_KEY && COMTELE_API_KEY.length > 10
  }

  /**
   * Envia SMS de teste
   */
  static async enviarTeste(telefone: string): Promise<SmsResponse> {
    const mensagem = 'Teste do Sistema de Ponto Eletronico. Se voce recebeu esta mensagem, o SMS esta configurado corretamente!'
    return this.enviarSms(telefone, mensagem, 'TESTE')
  }
}
