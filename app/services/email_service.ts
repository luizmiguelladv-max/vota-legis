/**
 * Serviço de Email para Notificações
 *
 * Configuração via variáveis de ambiente:
 * - SMTP_HOST: Servidor SMTP
 * - SMTP_PORT: Porta (587 para TLS, 465 para SSL)
 * - SMTP_USER: Usuário/Email
 * - SMTP_PASS: Senha
 * - SMTP_FROM: Email remetente
 * - SMTP_FROM_NAME: Nome do remetente
 */

import nodemailer from 'nodemailer'
import type { Transporter } from 'nodemailer'

interface EmailOptions {
  to: string | string[]
  subject: string
  html: string
  text?: string
}

class EmailService {
  private transporter: Transporter | null = null
  private enabled: boolean = false

  constructor() {
    this.initTransporter()
  }

  private initTransporter() {
    const host = process.env.SMTP_HOST
    const port = parseInt(process.env.SMTP_PORT || '587')
    const user = process.env.SMTP_USER
    const pass = process.env.SMTP_PASS

    if (!host || !user || !pass) {
      console.log('[Email] Serviço desabilitado - configure SMTP_HOST, SMTP_USER e SMTP_PASS')
      this.enabled = false
      return
    }

    try {
      this.transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass },
        tls: {
          rejectUnauthorized: false
        }
      })

      this.enabled = true
      console.log(`[Email] Serviço configurado: ${host}:${port}`)
    } catch (error) {
      console.error('[Email] Erro ao configurar:', error)
      this.enabled = false
    }
  }

  async send(options: EmailOptions): Promise<boolean> {
    if (!this.enabled || !this.transporter) {
      console.log('[Email] Serviço desabilitado, email não enviado')
      return false
    }

    const from = `"${process.env.SMTP_FROM_NAME || 'Sistema Ponto'}" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`

    try {
      const info = await this.transporter.sendMail({
        from,
        to: Array.isArray(options.to) ? options.to.join(', ') : options.to,
        subject: options.subject,
        text: options.text || options.html.replace(/<[^>]*>/g, ''),
        html: options.html
      })

      console.log(`[Email] Enviado: ${info.messageId}`)
      return true
    } catch (error) {
      console.error('[Email] Erro ao enviar:', error)
      return false
    }
  }

  /**
   * Envia notificação de aprovação pendente
   */
  async notificarAprovacaoPendente(email: string, dados: {
    tipo: string
    funcionario: string
    descricao: string
    link: string
  }): Promise<boolean> {
    return this.send({
      to: email,
      subject: `[Ponto] Aprovação Pendente: ${dados.tipo}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: #0d6efd; color: white; padding: 20px; text-align: center;">
            <h1 style="margin: 0;">Sistema de Ponto Eletrônico</h1>
          </div>
          <div style="padding: 20px; background: #f8f9fa;">
            <h2 style="color: #333;">Aprovação Pendente</h2>
            <p>Olá,</p>
            <p>Há uma nova solicitação aguardando sua aprovação:</p>
            <div style="background: white; padding: 15px; border-radius: 8px; margin: 20px 0;">
              <p><strong>Tipo:</strong> ${dados.tipo}</p>
              <p><strong>Funcionário:</strong> ${dados.funcionario}</p>
              <p><strong>Descrição:</strong> ${dados.descricao}</p>
            </div>
            <p style="text-align: center;">
              <a href="${dados.link}" style="background: #0d6efd; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">
                Ver Solicitação
              </a>
            </p>
          </div>
          <div style="padding: 15px; text-align: center; color: #6c757d; font-size: 12px;">
            <p>Este é um email automático. Por favor, não responda.</p>
          </div>
        </div>
      `
    })
  }

  /**
   * Envia alerta de banco de horas
   */
  async notificarBancoHoras(email: string, dados: {
    funcionario: string
    saldo: string
    percentual: number
    tipo: 'positivo' | 'negativo'
  }): Promise<boolean> {
    const cor = dados.tipo === 'positivo' ? '#28a745' : '#dc3545'
    const alerta = dados.tipo === 'positivo'
      ? 'próximo do limite máximo'
      : 'negativo em nível crítico'

    return this.send({
      to: email,
      subject: `[Ponto] Alerta: Banco de Horas ${alerta}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: ${cor}; color: white; padding: 20px; text-align: center;">
            <h1 style="margin: 0;">Alerta de Banco de Horas</h1>
          </div>
          <div style="padding: 20px; background: #f8f9fa;">
            <p>Olá,</p>
            <p>O banco de horas de <strong>${dados.funcionario}</strong> está ${alerta}.</p>
            <div style="background: white; padding: 15px; border-radius: 8px; margin: 20px 0; text-align: center;">
              <h3 style="color: ${cor}; margin: 0;">${dados.saldo}</h3>
              <p style="color: #6c757d; margin: 5px 0 0 0;">${dados.percentual}% do limite</p>
            </div>
            <p>Recomendamos verificar e tomar as providências necessárias.</p>
          </div>
          <div style="padding: 15px; text-align: center; color: #6c757d; font-size: 12px;">
            <p>Este é um email automático. Por favor, não responda.</p>
          </div>
        </div>
      `
    })
  }

  /**
   * Envia alerta genérico
   */
  async notificarAlerta(email: string, dados: {
    titulo: string
    mensagem: string
    tipo?: 'info' | 'warning' | 'danger' | 'success'
    link?: string
  }): Promise<boolean> {
    const cores = {
      info: '#17a2b8',
      warning: '#ffc107',
      danger: '#dc3545',
      success: '#28a745'
    }
    const cor = cores[dados.tipo || 'info']

    return this.send({
      to: email,
      subject: `[Ponto] ${dados.titulo}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: ${cor}; color: white; padding: 20px; text-align: center;">
            <h1 style="margin: 0;">${dados.titulo}</h1>
          </div>
          <div style="padding: 20px; background: #f8f9fa;">
            <p>${dados.mensagem}</p>
            ${dados.link ? `
              <p style="text-align: center; margin-top: 20px;">
                <a href="${dados.link}" style="background: #0d6efd; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">
                  Ver Detalhes
                </a>
              </p>
            ` : ''}
          </div>
          <div style="padding: 15px; text-align: center; color: #6c757d; font-size: 12px;">
            <p>Este é um email automático. Por favor, não responda.</p>
          </div>
        </div>
      `
    })
  }

  /**
   * Testa a conexão SMTP
   */
  async testarConexao(): Promise<{ success: boolean; message: string }> {
    if (!this.enabled || !this.transporter) {
      return {
        success: false,
        message: 'Serviço desabilitado. Configure SMTP_HOST, SMTP_USER e SMTP_PASS'
      }
    }

    try {
      await this.transporter.verify()
      return { success: true, message: 'Conexão SMTP OK' }
    } catch (error: any) {
      return { success: false, message: error.message }
    }
  }

  isEnabled(): boolean {
    return this.enabled
  }
}

export const emailService = new EmailService()
