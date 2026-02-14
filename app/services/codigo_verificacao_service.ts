/**
 * Serviço de Código de Verificação (2FA)
 * Gera, armazena e valida códigos de verificação para login
 */

import { dbManager } from './database_manager_service.js'
import env from '#start/env'

interface CodigoInfo {
  email: string
  codigo: string
  expira_em: Date
  tentativas: number
  entidades: Array<{
    id: number
    codigo: string
    nome: string
    db_schema: string
  }>
}

// Armazena códigos em memória (em produção, usar Redis)
const codigosAtivos = new Map<string, CodigoInfo>()

export default class CodigoVerificacaoService {
  private static readonly EXPIRACAO_MINUTOS = 5
  private static readonly MAX_TENTATIVAS = 3

  /**
   * Gera código de 6 dígitos
   */
  private static gerarCodigo(): string {
    return Math.floor(100000 + Math.random() * 900000).toString()
  }

  /**
   * Busca todas as entidades onde o email existe como usuário admin/gestor
   */
  static async buscarEntidadesPorEmail(email: string): Promise<Array<{
    id: number
    codigo: string
    nome: string
    db_schema: string
    usuario_id: number
    usuario_nome: string
    perfil: string
  }>> {
    const entidades = await dbManager.queryCentral<{ id: number; codigo: string; nome: string; db_schema: string }>(
      'SELECT id, codigo, nome, db_schema FROM public.entidades WHERE ativo = true AND db_schema IS NOT NULL'
    )

    const entidadesComUsuario: Array<{
      id: number
      codigo: string
      nome: string
      db_schema: string
      usuario_id: number
      usuario_nome: string
      perfil: string
    }> = []

    for (const entidade of entidades) {
      try {
        const usuarios = await dbManager.queryCentral<{
          id: number
          nome: string
          perfil: string
        }>(`
          SELECT id, nome, perfil
          FROM ${entidade.db_schema}.usuarios
          WHERE email = $1
            AND ativo = true
            AND perfil IN ('ADMIN', 'RH', 'GESTOR')
        `, [email])

        if (usuarios.length > 0) {
          entidadesComUsuario.push({
            id: entidade.id,
            codigo: entidade.codigo,
            nome: entidade.nome,
            db_schema: entidade.db_schema,
            usuario_id: usuarios[0].id,
            usuario_nome: usuarios[0].nome,
            perfil: usuarios[0].perfil
          })
        }
      } catch {
        // Ignora erros de schema inexistente
      }
    }

    return entidadesComUsuario
  }

  /**
   * Solicita código de verificação para o email
   * Retorna true se email encontrado e código enviado
   */
  static async solicitarCodigo(email: string): Promise<{
    success: boolean
    message: string
    emailMascarado?: string
  }> {
    const emailLower = email.toLowerCase().trim()

    // Busca entidades onde o email existe
    const entidades = await this.buscarEntidadesPorEmail(emailLower)

    if (entidades.length === 0) {
      // Por segurança, não informamos se o email existe ou não
      return {
        success: true,
        message: 'Se o email estiver cadastrado, você receberá o código de acesso.',
        emailMascarado: this.mascararEmail(emailLower)
      }
    }

    // Gera código
    const codigo = this.gerarCodigo()
    const expiraEm = new Date(Date.now() + this.EXPIRACAO_MINUTOS * 60 * 1000)

    // Armazena código
    codigosAtivos.set(emailLower, {
      email: emailLower,
      codigo,
      expira_em: expiraEm,
      tentativas: 0,
      entidades: entidades.map(e => ({
        id: e.id,
        codigo: e.codigo,
        nome: e.nome,
        db_schema: e.db_schema
      }))
    })

    // Envia email com código
    await this.enviarEmail(emailLower, codigo, entidades[0].usuario_nome)

    console.log(`[2FA] Código enviado para ${this.mascararEmail(emailLower)}: ${codigo}`)

    return {
      success: true,
      message: 'Código enviado! Verifique seu email.',
      emailMascarado: this.mascararEmail(emailLower)
    }
  }

  /**
   * Valida código informado
   */
  static validarCodigo(email: string, codigo: string): {
    success: boolean
    error?: string
    entidades?: Array<{ id: number; codigo: string; nome: string }>
  } {
    const emailLower = email.toLowerCase().trim()
    const info = codigosAtivos.get(emailLower)

    if (!info) {
      return { success: false, error: 'Código expirado ou inválido. Solicite um novo.' }
    }

    // Verifica expiração
    if (new Date() > info.expira_em) {
      codigosAtivos.delete(emailLower)
      return { success: false, error: 'Código expirado. Solicite um novo.' }
    }

    // Verifica tentativas
    if (info.tentativas >= this.MAX_TENTATIVAS) {
      codigosAtivos.delete(emailLower)
      return { success: false, error: 'Muitas tentativas. Solicite um novo código.' }
    }

    // Verifica código
    if (info.codigo !== codigo) {
      info.tentativas++
      const restantes = this.MAX_TENTATIVAS - info.tentativas
      return {
        success: false,
        error: restantes > 0
          ? `Código incorreto. ${restantes} tentativa(s) restante(s).`
          : 'Código incorreto. Solicite um novo.'
      }
    }

    // Código válido - retorna entidades disponíveis
    return {
      success: true,
      entidades: info.entidades.map(e => ({
        id: e.id,
        codigo: e.codigo,
        nome: e.nome
      }))
    }
  }

  /**
   * Finaliza login selecionando entidade
   */
  static async finalizarLogin(email: string, entidadeId: number): Promise<{
    success: boolean
    error?: string
    usuario?: {
      id: number
      nome: string
      email: string
      perfil: string
    }
    entidade?: {
      id: number
      codigo: string
      nome: string
      db_schema: string
    }
  }> {
    const emailLower = email.toLowerCase().trim()
    const info = codigosAtivos.get(emailLower)

    if (!info) {
      return { success: false, error: 'Sessão expirada. Faça login novamente.' }
    }

    const entidade = info.entidades.find(e => e.id === entidadeId)
    if (!entidade) {
      return { success: false, error: 'Entidade não encontrada.' }
    }

    // Busca dados completos do usuário
    const usuarios = await dbManager.queryCentral<{
      id: number
      nome: string
      email: string
      perfil: string
      funcionario_id: number | null
      lotacoes_permitidas: number[]
    }>(`
      SELECT id, nome, email, perfil, funcionario_id, lotacoes_permitidas
      FROM ${entidade.db_schema}.usuarios
      WHERE email = $1 AND ativo = true
    `, [emailLower])

    if (usuarios.length === 0) {
      return { success: false, error: 'Usuário não encontrado.' }
    }

    const usuario = usuarios[0]

    // Atualiza último acesso
    await dbManager.queryCentral(`
      UPDATE ${entidade.db_schema}.usuarios SET ultimo_acesso = NOW() WHERE id = $1
    `, [usuario.id])

    // Remove código usado
    codigosAtivos.delete(emailLower)

    return {
      success: true,
      usuario: {
        id: usuario.id,
        nome: usuario.nome,
        email: usuario.email,
        perfil: usuario.perfil
      },
      entidade
    }
  }

  /**
   * Mascara email para exibição (ex: l***@gmail.com)
   */
  private static mascararEmail(email: string): string {
    const [user, domain] = email.split('@')
    if (user.length <= 2) {
      return `${user[0]}***@${domain}`
    }
    return `${user[0]}${user[1]}***@${domain}`
  }

  /**
   * Envia email com código de verificação
   */
  private static async enviarEmail(email: string, codigo: string, nome: string): Promise<void> {
    try {
      // Tenta usar nodemailer se disponível
      const nodemailer = await import('nodemailer')

      const transporter = nodemailer.default.createTransport({
        host: env.get('SMTP_HOST', 'smtp.gmail.com'),
        port: Number(env.get('SMTP_PORT', '587')),
        secure: env.get('SMTP_SECURE', 'false') === 'true',
        auth: {
          user: env.get('SMTP_USER'),
          pass: env.get('SMTP_PASS')
        }
      })

      await transporter.sendMail({
        from: `"GetPonto" <${env.get('SMTP_FROM', 'noreply@getponto.inf.br')}>`,
        to: email,
        subject: `Código de Acesso: ${codigo}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px;">
            <div style="background: linear-gradient(135deg, #1a73e8 0%, #4285f4 100%); padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
              <h1 style="color: white; margin: 0; font-size: 24px;">GetPonto</h1>
            </div>
            <div style="background: #f8f9fa; padding: 30px; border-radius: 0 0 8px 8px;">
              <p style="margin: 0 0 20px; color: #333;">Olá, <strong>${nome}</strong>!</p>
              <p style="margin: 0 0 20px; color: #666;">Seu código de acesso é:</p>
              <div style="background: #1a73e8; color: white; font-size: 32px; font-weight: bold; text-align: center; padding: 20px; border-radius: 8px; letter-spacing: 8px;">
                ${codigo}
              </div>
              <p style="margin: 20px 0 0; color: #999; font-size: 12px; text-align: center;">
                Este código expira em ${this.EXPIRACAO_MINUTOS} minutos.
              </p>
              <p style="margin: 10px 0 0; color: #999; font-size: 12px; text-align: center;">
                Se você não solicitou este código, ignore este email.
              </p>
            </div>
          </div>
        `
      })

      console.log(`[2FA] Email enviado para ${email}`)
    } catch (error) {
      console.error('[2FA] Erro ao enviar email:', error)
      // Em desenvolvimento, apenas loga o código
      console.log(`[2FA] CÓDIGO PARA ${email}: ${codigo}`)
    }
  }

  /**
   * Limpa códigos expirados (chamar periodicamente)
   */
  static limparExpirados(): void {
    const agora = new Date()
    for (const [email, info] of codigosAtivos.entries()) {
      if (agora > info.expira_em) {
        codigosAtivos.delete(email)
      }
    }
  }
}

// Limpa códigos expirados a cada minuto
setInterval(() => CodigoVerificacaoService.limparExpirados(), 60000)
