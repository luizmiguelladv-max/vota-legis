/**
 * Serviço de Autenticação em Dois Fatores (2FA)
 */

import db from '@adonisjs/lucid/services/db'
import logger from '@adonisjs/core/services/logger'
import crypto from 'crypto'
import SmsService from './sms_service.js'

interface TwoFactorResult {
  success: boolean
  message?: string
  error?: string
  codigoId?: number
  tokenDispositivo?: string
}

export default class TwoFactorService {
  // Tempo de expiração do código em minutos
  static readonly EXPIRACAO_MINUTOS = 5

  // Máximo de tentativas
  static readonly MAX_TENTATIVAS = 3

  // Tempo de validade do dispositivo confiável (30 dias)
  static readonly DIAS_DISPOSITIVO_CONFIAVEL = 30

  /**
   * Gera código de 6 dígitos
   */
  static gerarCodigo(): string {
    return Math.floor(100000 + Math.random() * 900000).toString()
  }

  /**
   * Mascara telefone para exibição (ex: ***99-9999)
   */
  static mascararTelefone(telefone: string): string {
    const limpo = telefone.replace(/\D/g, '')
    if (limpo.length < 4) return '***'
    return '***' + limpo.slice(-4).replace(/(\d{2})(\d{2})/, '$1-$2')
  }

  /**
   * Envia código 2FA para o usuário master
   */
  static async enviarCodigo(usuarioMasterId: number): Promise<TwoFactorResult> {
    try {
      // Busca usuário e telefone
      const result = await db.rawQuery(
        'SELECT id, nome, telefone, dois_fatores_ativo FROM public.usuarios_master WHERE id = ?',
        [usuarioMasterId]
      )

      const usuario = result.rows[0]

      if (!usuario) {
        return { success: false, error: 'Usuário não encontrado' }
      }

      if (!usuario.telefone) {
        return { success: false, error: 'Usuário não possui telefone cadastrado para 2FA' }
      }

      // Invalida códigos anteriores não usados
      await db.rawQuery(
        'UPDATE public.codigos_2fa SET usado = true WHERE usuario_master_id = ? AND usado = false',
        [usuarioMasterId]
      )

      // Gera novo código
      const codigo = this.gerarCodigo()
      // Usa NOW() + intervalo diretamente no SQL para evitar problemas de fuso horário
      const expiraEmMinutos = this.EXPIRACAO_MINUTOS

      // Salva no banco - usa NOW() + INTERVAL para garantir consistência de fuso horário
      const insertResult = await db.rawQuery(
        `INSERT INTO public.codigos_2fa (usuario_master_id, codigo, telefone, expira_em)
         VALUES (?, ?, ?, NOW() + INTERVAL '${expiraEmMinutos} minutes') RETURNING id`,
        [usuarioMasterId, codigo, usuario.telefone]
      )

      const codigoId = insertResult.rows[0]?.id

      // Envia SMS
      const smsResult = await SmsService.enviarCodigo2FA(usuario.telefone, codigo)

      if (!smsResult.success) {
        logger.error(`[2FA] Falha ao enviar SMS para usuário ${usuarioMasterId}: ${smsResult.error}`)
        return {
          success: false,
          error: 'Falha ao enviar SMS. Tente novamente.',
        }
      }

      logger.info(`[2FA] Código enviado para usuário ${usuarioMasterId} (${this.mascararTelefone(usuario.telefone)})`)

      return {
        success: true,
        message: `Código enviado para ${this.mascararTelefone(usuario.telefone)}`,
        codigoId,
      }
    } catch (error: any) {
      logger.error(`[2FA] Erro ao enviar código: ${error.message}`)
      return { success: false, error: 'Erro interno ao processar 2FA' }
    }
  }

  /**
   * Verifica código 2FA
   */
  static async verificarCodigo(
    usuarioMasterId: number,
    codigoInformado: string
  ): Promise<TwoFactorResult> {
    try {
      // Busca código válido mais recente
      const result = await db.rawQuery(
        `SELECT id, codigo, tentativas, expira_em
         FROM public.codigos_2fa
         WHERE usuario_master_id = ?
           AND usado = false
           AND expira_em > NOW()
         ORDER BY created_at DESC
         LIMIT 1`,
        [usuarioMasterId]
      )

      const registro = result.rows[0]

      if (!registro) {
        return { success: false, error: 'Código expirado ou não encontrado. Solicite um novo.' }
      }

      // Verifica tentativas
      if (registro.tentativas >= this.MAX_TENTATIVAS) {
        // Invalida o código
        await db.rawQuery('UPDATE public.codigos_2fa SET usado = true WHERE id = ?', [registro.id])
        return { success: false, error: 'Número máximo de tentativas excedido. Solicite um novo código.' }
      }

      // Verifica código
      if (registro.codigo !== codigoInformado) {
        // Incrementa tentativas
        await db.rawQuery(
          'UPDATE public.codigos_2fa SET tentativas = tentativas + 1 WHERE id = ?',
          [registro.id]
        )

        const tentativasRestantes = this.MAX_TENTATIVAS - registro.tentativas - 1
        return {
          success: false,
          error: `Código incorreto. ${tentativasRestantes} tentativa(s) restante(s).`,
        }
      }

      // Código correto - marca como usado
      await db.rawQuery('UPDATE public.codigos_2fa SET usado = true WHERE id = ?', [registro.id])

      logger.info(`[2FA] Código verificado com sucesso para usuário ${usuarioMasterId}`)

      return { success: true, message: 'Código verificado com sucesso' }
    } catch (error: any) {
      logger.error(`[2FA] Erro ao verificar código: ${error.message}`)
      return { success: false, error: 'Erro interno ao verificar código' }
    }
  }

  /**
   * Verifica se usuário tem 2FA ativo
   */
  static async is2FAAtivo(usuarioMasterId: number): Promise<boolean> {
    try {
      const result = await db.rawQuery(
        'SELECT dois_fatores_ativo, telefone FROM public.usuarios_master WHERE id = ?',
        [usuarioMasterId]
      )

      const usuario = result.rows[0]

      // 2FA está ativo se a flag estiver true E tiver telefone cadastrado
      return usuario?.dois_fatores_ativo === true && !!usuario?.telefone
    } catch {
      return false
    }
  }

  /**
   * Ativa 2FA para um usuário
   */
  static async ativar2FA(usuarioMasterId: number, telefone: string): Promise<TwoFactorResult> {
    try {
      const telefoneLimpo = telefone.replace(/\D/g, '')

      if (telefoneLimpo.length < 10 || telefoneLimpo.length > 11) {
        return { success: false, error: 'Telefone inválido' }
      }

      await db.rawQuery(
        'UPDATE public.usuarios_master SET telefone = ?, dois_fatores_ativo = true WHERE id = ?',
        [telefoneLimpo, usuarioMasterId]
      )

      logger.info(`[2FA] Ativado para usuário ${usuarioMasterId}`)

      return { success: true, message: '2FA ativado com sucesso' }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  }

  /**
   * Desativa 2FA para um usuário
   */
  static async desativar2FA(usuarioMasterId: number): Promise<TwoFactorResult> {
    try {
      await db.rawQuery(
        'UPDATE public.usuarios_master SET dois_fatores_ativo = false WHERE id = ?',
        [usuarioMasterId]
      )

      logger.info(`[2FA] Desativado para usuário ${usuarioMasterId}`)

      return { success: true, message: '2FA desativado com sucesso' }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  }

  /**
   * Gera token único para dispositivo confiável
   */
  static gerarTokenDispositivo(): string {
    return crypto.randomBytes(32).toString('hex')
  }

  /**
   * Registra dispositivo como confiável
   */
  static async confiarDispositivo(
    usuarioMasterId: number,
    ip: string,
    userAgent?: string
  ): Promise<TwoFactorResult> {
    try {
      const token = this.gerarTokenDispositivo()
      const diasValidade = this.DIAS_DISPOSITIVO_CONFIAVEL

      // Extrai nome do navegador do user-agent
      let navegador = 'Desconhecido'
      if (userAgent) {
        if (userAgent.includes('Chrome')) navegador = 'Chrome'
        else if (userAgent.includes('Firefox')) navegador = 'Firefox'
        else if (userAgent.includes('Safari')) navegador = 'Safari'
        else if (userAgent.includes('Edge')) navegador = 'Edge'
        else if (userAgent.includes('Opera')) navegador = 'Opera'
      }

      // Remove dispositivos expirados do usuário
      await db.rawQuery(
        'DELETE FROM public.dispositivos_confiaveis WHERE usuario_master_id = ? AND expira_em < NOW()',
        [usuarioMasterId]
      )

      // Limita a 5 dispositivos por usuário (remove os mais antigos)
      await db.rawQuery(`
        DELETE FROM public.dispositivos_confiaveis
        WHERE id IN (
          SELECT id FROM public.dispositivos_confiaveis
          WHERE usuario_master_id = ?
          ORDER BY ultimo_acesso DESC
          OFFSET 4
        )
      `, [usuarioMasterId])

      // Insere novo dispositivo - usa NOW() + INTERVAL para consistência de fuso horário
      await db.rawQuery(
        `INSERT INTO public.dispositivos_confiaveis
         (usuario_master_id, token, nome_dispositivo, navegador, ip, expira_em)
         VALUES (?, ?, ?, ?, ?, NOW() + INTERVAL '${diasValidade} days')`,
        [usuarioMasterId, token, `${navegador} em ${ip}`, navegador, ip]
      )

      logger.info(`[2FA] Dispositivo confiável registrado para usuário ${usuarioMasterId}: ${navegador}`)

      return {
        success: true,
        message: 'Dispositivo registrado como confiável',
        tokenDispositivo: token,
      }
    } catch (error: any) {
      logger.error(`[2FA] Erro ao registrar dispositivo confiável: ${error.message}`)
      return { success: false, error: error.message }
    }
  }

  /**
   * Verifica se um dispositivo é confiável
   */
  static async verificarDispositivoConfiavel(
    usuarioMasterId: number,
    token: string
  ): Promise<boolean> {
    try {
      if (!token) return false

      const result = await db.rawQuery(
        `SELECT id FROM public.dispositivos_confiaveis
         WHERE usuario_master_id = ?
           AND token = ?
           AND ativo = true
           AND expira_em > NOW()`,
        [usuarioMasterId, token]
      )

      if (result.rows.length > 0) {
        // Atualiza último acesso
        await db.rawQuery(
          'UPDATE public.dispositivos_confiaveis SET ultimo_acesso = NOW() WHERE token = ?',
          [token]
        )
        return true
      }

      return false
    } catch (error: any) {
      logger.error(`[2FA] Erro ao verificar dispositivo confiável: ${error.message}`)
      return false
    }
  }

  /**
   * Lista dispositivos confiáveis de um usuário
   */
  static async listarDispositivosConfiaveis(usuarioMasterId: number) {
    try {
      const result = await db.rawQuery(
        `SELECT id, nome_dispositivo, navegador, ip, ultimo_acesso, expira_em, created_at
         FROM public.dispositivos_confiaveis
         WHERE usuario_master_id = ? AND ativo = true AND expira_em > NOW()
         ORDER BY ultimo_acesso DESC`,
        [usuarioMasterId]
      )

      return result.rows
    } catch {
      return []
    }
  }

  /**
   * Remove um dispositivo confiável
   */
  static async removerDispositivoConfiavel(
    usuarioMasterId: number,
    dispositivoId: number
  ): Promise<TwoFactorResult> {
    try {
      await db.rawQuery(
        'DELETE FROM public.dispositivos_confiaveis WHERE id = ? AND usuario_master_id = ?',
        [dispositivoId, usuarioMasterId]
      )

      logger.info(`[2FA] Dispositivo ${dispositivoId} removido para usuário ${usuarioMasterId}`)

      return { success: true, message: 'Dispositivo removido' }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  }

  /**
   * Remove todos os dispositivos confiáveis de um usuário
   */
  static async removerTodosDispositivos(usuarioMasterId: number): Promise<TwoFactorResult> {
    try {
      await db.rawQuery(
        'DELETE FROM public.dispositivos_confiaveis WHERE usuario_master_id = ?',
        [usuarioMasterId]
      )

      logger.info(`[2FA] Todos dispositivos removidos para usuário ${usuarioMasterId}`)

      return { success: true, message: 'Todos os dispositivos foram removidos' }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  }
}
