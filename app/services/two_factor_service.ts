/**
 * Servico de Autenticacao em Dois Fatores (2FA)
 */

import db from '@adonisjs/lucid/services/db'
import logger from '@adonisjs/core/services/logger'
import crypto from 'crypto'
import SmsService from './sms_service.js'
import User from '#models/user'

interface TwoFactorResult {
  success: boolean
  message?: string
  error?: string
  codigoId?: number
  tokenDispositivo?: string
}

export default class TwoFactorService {
  // Tempo de expiracao do codigo em minutos
  static readonly EXPIRACAO_MINUTOS = 5

  // Maximo de tentativas
  static readonly MAX_TENTATIVAS = 3

  // Tempo de validade do dispositivo confiavel (30 dias)
  static readonly DIAS_DISPOSITIVO_CONFIAVEL = 30

  /**
   * Gera codigo de 6 digitos
   */
  static gerarCodigo(): string {
    return Math.floor(100000 + Math.random() * 900000).toString()
  }

  /**
   * Mascara telefone para exibicao (ex: ***99-9999)
   */
  static mascararTelefone(telefone: string): string {
    const limpo = telefone.replace(/\D/g, '')
    if (limpo.length < 4) return '***'
    return '***' + limpo.slice(-4).replace(/(\d{2})(\d{2})/, '$1-$2')
  }

  /**
   * Envia codigo 2FA para o usuario
   */
  static async enviarCodigo(usuarioId: number): Promise<TwoFactorResult> {
    try {
      // Busca usuario e telefone
      const usuario = await User.find(usuarioId)

      if (!usuario) {
        return { success: false, error: 'Usuario nao encontrado' }
      }

      if (!usuario.celular) {
        return { success: false, error: 'Usuario nao possui telefone cadastrado para 2FA' }
      }

      // Invalida codigos anteriores nao usados
      await db.from('codigos_2fa')
        .where('usuario_id', usuarioId)
        .where('usado', false)
        .update({ usado: true })

      // Gera novo codigo
      const codigo = this.gerarCodigo()
      const expiraEm = new Date()
      expiraEm.setMinutes(expiraEm.getMinutes() + this.EXPIRACAO_MINUTOS)

      // Salva no banco
      const [inserted] = await db.table('codigos_2fa')
        .insert({
          usuario_id: usuarioId,
          codigo: codigo,
          telefone: usuario.celular,
          expira_em: expiraEm,
          tentativas: 0,
          usado: false,
          created_at: new Date(),
        })
        .returning('id')

      const codigoId = inserted?.id || inserted

      // Envia SMS
      const smsResult = await SmsService.enviarCodigo2FA(usuario.celular, codigo)

      if (!smsResult.success) {
        logger.error(`[2FA] Falha ao enviar SMS para usuario ${usuarioId}: ${smsResult.error}`)
        return {
          success: false,
          error: 'Falha ao enviar SMS. Tente novamente.',
        }
      }

      logger.info(`[2FA] Codigo enviado para usuario ${usuarioId} (${this.mascararTelefone(usuario.celular)})`)

      return {
        success: true,
        message: `Codigo enviado para ${this.mascararTelefone(usuario.celular)}`,
        codigoId,
      }
    } catch (error: any) {
      logger.error(`[2FA] Erro ao enviar codigo: ${error.message}`)
      return { success: false, error: 'Erro interno ao processar 2FA' }
    }
  }

  /**
   * Verifica codigo 2FA
   */
  static async verificarCodigo(
    usuarioId: number,
    codigoInformado: string
  ): Promise<TwoFactorResult> {
    try {
      // Busca codigo valido mais recente
      const registro = await db.from('codigos_2fa')
        .where('usuario_id', usuarioId)
        .where('usado', false)
        .where('expira_em', '>', new Date())
        .orderBy('created_at', 'desc')
        .first()

      if (!registro) {
        return { success: false, error: 'Codigo expirado ou nao encontrado. Solicite um novo.' }
      }

      // Verifica tentativas
      if (registro.tentativas >= this.MAX_TENTATIVAS) {
        // Invalida o codigo
        await db.from('codigos_2fa').where('id', registro.id).update({ usado: true })
        return { success: false, error: 'Numero maximo de tentativas excedido. Solicite um novo codigo.' }
      }

      // Verifica codigo
      if (registro.codigo !== codigoInformado) {
        // Incrementa tentativas
        await db.from('codigos_2fa')
          .where('id', registro.id)
          .update({ tentativas: registro.tentativas + 1 })

        const tentativasRestantes = this.MAX_TENTATIVAS - registro.tentativas - 1
        return {
          success: false,
          error: `Codigo incorreto. ${tentativasRestantes} tentativa(s) restante(s).`,
        }
      }

      // Codigo correto - marca como usado
      await db.from('codigos_2fa').where('id', registro.id).update({ usado: true })

      logger.info(`[2FA] Codigo verificado com sucesso para usuario ${usuarioId}`)

      return { success: true, message: 'Codigo verificado com sucesso' }
    } catch (error: any) {
      logger.error(`[2FA] Erro ao verificar codigo: ${error.message}`)
      return { success: false, error: 'Erro interno ao verificar codigo' }
    }
  }

  /**
   * Verifica se usuario tem 2FA ativo
   */
  static async is2FAAtivo(usuarioId: number): Promise<boolean> {
    try {
      const usuario = await User.find(usuarioId)
      // 2FA esta ativo se a flag estiver true E tiver telefone cadastrado
      return usuario?.doisFatoresAtivo === true && !!usuario?.celular
    } catch {
      return false
    }
  }

  /**
   * Ativa 2FA para um usuario
   */
  static async ativar2FA(usuarioId: number, telefone: string): Promise<TwoFactorResult> {
    try {
      const telefoneLimpo = telefone.replace(/\D/g, '')

      if (telefoneLimpo.length < 10 || telefoneLimpo.length > 11) {
        return { success: false, error: 'Telefone invalido' }
      }

      await User.query()
        .where('id', usuarioId)
        .update({
          celular: telefoneLimpo,
          doisFatoresAtivo: true,
        })

      logger.info(`[2FA] Ativado para usuario ${usuarioId}`)

      return { success: true, message: '2FA ativado com sucesso' }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  }

  /**
   * Desativa 2FA para um usuario
   */
  static async desativar2FA(usuarioId: number): Promise<TwoFactorResult> {
    try {
      await User.query()
        .where('id', usuarioId)
        .update({ doisFatoresAtivo: false })

      logger.info(`[2FA] Desativado para usuario ${usuarioId}`)

      return { success: true, message: '2FA desativado com sucesso' }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  }

  /**
   * Gera token unico para dispositivo confiavel
   */
  static gerarTokenDispositivo(): string {
    return crypto.randomBytes(32).toString('hex')
  }

  /**
   * Registra dispositivo como confiavel
   */
  static async confiarDispositivo(
    usuarioId: number,
    ip: string,
    userAgent?: string
  ): Promise<TwoFactorResult> {
    try {
      const token = this.gerarTokenDispositivo()
      const expiraEm = new Date()
      expiraEm.setDate(expiraEm.getDate() + this.DIAS_DISPOSITIVO_CONFIAVEL)

      // Extrai nome do navegador do user-agent
      let navegador = 'Desconhecido'
      if (userAgent) {
        if (userAgent.includes('Chrome')) navegador = 'Chrome'
        else if (userAgent.includes('Firefox')) navegador = 'Firefox'
        else if (userAgent.includes('Safari')) navegador = 'Safari'
        else if (userAgent.includes('Edge')) navegador = 'Edge'
        else if (userAgent.includes('Opera')) navegador = 'Opera'
      }

      // Remove dispositivos expirados do usuario
      await db.from('dispositivos_confiaveis')
        .where('usuario_id', usuarioId)
        .where('expira_em', '<', new Date())
        .delete()

      // Limita a 5 dispositivos por usuario (remove os mais antigos)
      const dispositivos = await db.from('dispositivos_confiaveis')
        .where('usuario_id', usuarioId)
        .orderBy('ultimo_acesso', 'desc')
        .offset(4)
        .select('id')

      if (dispositivos.length > 0) {
        await db.from('dispositivos_confiaveis')
          .whereIn('id', dispositivos.map(d => d.id))
          .delete()
      }

      // Insere novo dispositivo
      await db.table('dispositivos_confiaveis').insert({
        usuario_id: usuarioId,
        token: token,
        nome_dispositivo: `${navegador} em ${ip}`,
        navegador: navegador,
        ip: ip,
        expira_em: expiraEm,
        ativo: true,
        ultimo_acesso: new Date(),
        created_at: new Date(),
      })

      logger.info(`[2FA] Dispositivo confiavel registrado para usuario ${usuarioId}: ${navegador}`)

      return {
        success: true,
        message: 'Dispositivo registrado como confiavel',
        tokenDispositivo: token,
      }
    } catch (error: any) {
      logger.error(`[2FA] Erro ao registrar dispositivo confiavel: ${error.message}`)
      return { success: false, error: error.message }
    }
  }

  /**
   * Verifica se um dispositivo e confiavel
   */
  static async verificarDispositivoConfiavel(
    usuarioId: number,
    token: string
  ): Promise<boolean> {
    try {
      if (!token) return false

      const dispositivo = await db.from('dispositivos_confiaveis')
        .where('usuario_id', usuarioId)
        .where('token', token)
        .where('ativo', true)
        .where('expira_em', '>', new Date())
        .first()

      if (dispositivo) {
        // Atualiza ultimo acesso
        await db.from('dispositivos_confiaveis')
          .where('token', token)
          .update({ ultimo_acesso: new Date() })
        return true
      }

      return false
    } catch (error: any) {
      logger.error(`[2FA] Erro ao verificar dispositivo confiavel: ${error.message}`)
      return false
    }
  }

  /**
   * Lista dispositivos confiaveis de um usuario
   */
  static async listarDispositivosConfiaveis(usuarioId: number) {
    try {
      return await db.from('dispositivos_confiaveis')
        .where('usuario_id', usuarioId)
        .where('ativo', true)
        .where('expira_em', '>', new Date())
        .orderBy('ultimo_acesso', 'desc')
    } catch {
      return []
    }
  }

  /**
   * Remove um dispositivo confiavel
   */
  static async removerDispositivoConfiavel(
    usuarioId: number,
    dispositivoId: number
  ): Promise<TwoFactorResult> {
    try {
      await db.from('dispositivos_confiaveis')
        .where('id', dispositivoId)
        .where('usuario_id', usuarioId)
        .delete()

      logger.info(`[2FA] Dispositivo ${dispositivoId} removido para usuario ${usuarioId}`)

      return { success: true, message: 'Dispositivo removido' }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  }

  /**
   * Remove todos os dispositivos confiaveis de um usuario
   */
  static async removerTodosDispositivos(usuarioId: number): Promise<TwoFactorResult> {
    try {
      await db.from('dispositivos_confiaveis')
        .where('usuario_id', usuarioId)
        .delete()

      logger.info(`[2FA] Todos dispositivos removidos para usuario ${usuarioId}`)

      return { success: true, message: 'Todos os dispositivos foram removidos' }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  }
}
