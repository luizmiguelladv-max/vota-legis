import AuditLog from '#models/audit_log'
import type { HttpContext } from '@adonisjs/core/http'

/**
 * Tipos de ações de auditoria
 */
export type AuditAction =
  | 'LOGIN'
  | 'LOGOUT'
  | 'LOGIN_FAILED'
  | 'PASSWORD_CHANGE'
  | 'CREATE'
  | 'UPDATE'
  | 'DELETE'
  | 'VIEW'
  | 'EXPORT'
  | 'IMPORT'
  | 'SYNC'
  | 'BACKUP'
  | 'RESTORE'
  | 'CONFIG_CHANGE'

/**
 * Interface para parâmetros de auditoria
 */
interface AuditParams {
  usuarioId?: number | null
  usuarioTipo?: 'master' | 'municipal'
  acao: AuditAction
  tabela?: string
  registroId?: number
  dadosAnteriores?: Record<string, any>
  dadosNovos?: Record<string, any>
  descricao?: string
  ip?: string
  userAgent?: string
}

/**
 * Serviço de Auditoria
 * Responsável por registrar todas as ações importantes do sistema
 */
export default class AuditService {
  /**
   * Registra uma ação de auditoria
   */
  static async log(params: AuditParams): Promise<AuditLog | null> {
    try {
      return await AuditLog.registrar({
        usuarioId: params.usuarioId ?? null,
        usuarioTipo: params.usuarioTipo,
        acao: params.acao,
        tabela: params.tabela,
        registroId: params.registroId,
        dadosAnteriores: params.dadosAnteriores,
        dadosNovos: params.dadosNovos
          ? { ...params.dadosNovos, _descricao: params.descricao }
          : params.descricao
            ? { _descricao: params.descricao }
            : undefined,
        ip: params.ip,
        userAgent: params.userAgent,
      })
    } catch (error) {
      console.error('[AuditService] Erro ao registrar auditoria:', error)
      return null
    }
  }

  /**
   * Registra auditoria a partir do contexto HTTP
   */
  static async logFromContext(
    ctx: HttpContext,
    params: Omit<AuditParams, 'ip' | 'userAgent' | 'usuarioId' | 'usuarioTipo'>
  ): Promise<AuditLog | null> {
    const ip = ctx.request.ip()
    const userAgent = ctx.request.header('user-agent') || null

    let usuarioId: number | null = null
    let usuarioTipo: 'master' | 'municipal' | undefined

    // Tenta obter dados do usuário do tenant
    if (ctx.tenant?.usuario) {
      usuarioId = ctx.tenant.usuario.id
      usuarioTipo = ctx.tenant.isSuperAdmin ? 'master' : 'municipal'
    }

    return this.log({
      ...params,
      usuarioId,
      usuarioTipo,
      ip,
      userAgent: userAgent || undefined,
    })
  }

  /**
   * Registra login bem-sucedido
   */
  static async logLogin(
    usuarioId: number,
    usuarioTipo: 'master' | 'municipal',
    ip?: string,
    userAgent?: string,
    municipioNome?: string
  ): Promise<AuditLog | null> {
    return this.log({
      usuarioId,
      usuarioTipo,
      acao: 'LOGIN',
      descricao: municipioNome ? `Login no município: ${municipioNome}` : 'Login realizado',
      ip,
      userAgent,
    })
  }

  /**
   * Registra tentativa de login falha
   */
  static async logLoginFailed(
    login: string,
    ip?: string,
    userAgent?: string,
    motivo?: string
  ): Promise<AuditLog | null> {
    return this.log({
      acao: 'LOGIN_FAILED',
      dadosNovos: { login, motivo: motivo || 'Credenciais inválidas' },
      ip,
      userAgent,
    })
  }

  /**
   * Registra logout
   */
  static async logLogout(
    usuarioId: number,
    usuarioTipo: 'master' | 'municipal',
    ip?: string,
    userAgent?: string
  ): Promise<AuditLog | null> {
    return this.log({
      usuarioId,
      usuarioTipo,
      acao: 'LOGOUT',
      descricao: 'Logout realizado',
      ip,
      userAgent,
    })
  }

  /**
   * Registra alteração de senha
   */
  static async logPasswordChange(
    usuarioId: number,
    usuarioTipo: 'master' | 'municipal',
    ip?: string,
    userAgent?: string
  ): Promise<AuditLog | null> {
    return this.log({
      usuarioId,
      usuarioTipo,
      acao: 'PASSWORD_CHANGE',
      descricao: 'Senha alterada',
      ip,
      userAgent,
    })
  }

  /**
   * Registra criação de registro
   */
  static async logCreate(
    ctx: HttpContext,
    tabela: string,
    registroId: number,
    dados: Record<string, any>
  ): Promise<AuditLog | null> {
    // Remove campos sensíveis
    const dadosSeguros = this.sanitizeDados(dados)

    return this.logFromContext(ctx, {
      acao: 'CREATE',
      tabela,
      registroId,
      dadosNovos: dadosSeguros,
    })
  }

  /**
   * Registra atualização de registro
   */
  static async logUpdate(
    ctx: HttpContext,
    tabela: string,
    registroId: number,
    dadosAnteriores: Record<string, any>,
    dadosNovos: Record<string, any>
  ): Promise<AuditLog | null> {
    // Remove campos sensíveis
    const anterioresSeguros = this.sanitizeDados(dadosAnteriores)
    const novosSeguros = this.sanitizeDados(dadosNovos)

    return this.logFromContext(ctx, {
      acao: 'UPDATE',
      tabela,
      registroId,
      dadosAnteriores: anterioresSeguros,
      dadosNovos: novosSeguros,
    })
  }

  /**
   * Registra exclusão de registro
   */
  static async logDelete(
    ctx: HttpContext,
    tabela: string,
    registroId: number,
    dadosAnteriores?: Record<string, any>
  ): Promise<AuditLog | null> {
    const dadosSeguros = dadosAnteriores ? this.sanitizeDados(dadosAnteriores) : undefined

    return this.logFromContext(ctx, {
      acao: 'DELETE',
      tabela,
      registroId,
      dadosAnteriores: dadosSeguros,
    })
  }

  /**
   * Registra exportação de dados
   */
  static async logExport(
    ctx: HttpContext,
    tipo: string,
    descricao: string
  ): Promise<AuditLog | null> {
    return this.logFromContext(ctx, {
      acao: 'EXPORT',
      descricao: `Exportação ${tipo}: ${descricao}`,
    })
  }

  /**
   * Registra importação de dados
   */
  static async logImport(
    ctx: HttpContext,
    tipo: string,
    quantidade: number
  ): Promise<AuditLog | null> {
    return this.logFromContext(ctx, {
      acao: 'IMPORT',
      descricao: `Importação ${tipo}: ${quantidade} registros`,
      dadosNovos: { tipo, quantidade },
    })
  }

  /**
   * Registra sincronização
   */
  static async logSync(
    ctx: HttpContext,
    tipo: string,
    detalhes: Record<string, any>
  ): Promise<AuditLog | null> {
    return this.logFromContext(ctx, {
      acao: 'SYNC',
      descricao: `Sincronização: ${tipo}`,
      dadosNovos: detalhes,
    })
  }

  /**
   * Registra backup
   */
  static async logBackup(
    ctx: HttpContext,
    arquivo: string,
    tamanho?: number
  ): Promise<AuditLog | null> {
    return this.logFromContext(ctx, {
      acao: 'BACKUP',
      descricao: `Backup criado: ${arquivo}`,
      dadosNovos: { arquivo, tamanho },
    })
  }

  /**
   * Registra alteração de configuração
   */
  static async logConfigChange(
    ctx: HttpContext,
    chave: string,
    valorAnterior: any,
    valorNovo: any
  ): Promise<AuditLog | null> {
    return this.logFromContext(ctx, {
      acao: 'CONFIG_CHANGE',
      tabela: 'configuracoes',
      dadosAnteriores: { [chave]: valorAnterior },
      dadosNovos: { [chave]: valorNovo },
    })
  }

  /**
   * Remove campos sensíveis dos dados
   */
  private static sanitizeDados(dados: Record<string, any>): Record<string, any> {
    const camposSensiveis = [
      'senha',
      'password',
      'secret',
      'token',
      'template_biometrico',
      'foto_base64',
      'descriptor',
    ]

    const resultado: Record<string, any> = {}

    for (const [chave, valor] of Object.entries(dados)) {
      if (camposSensiveis.some((campo) => chave.toLowerCase().includes(campo))) {
        resultado[chave] = '[REDACTED]'
      } else if (valor && typeof valor === 'object' && !Array.isArray(valor)) {
        resultado[chave] = this.sanitizeDados(valor)
      } else {
        resultado[chave] = valor
      }
    }

    return resultado
  }

  /**
   * Busca logs de auditoria com filtros
   */
  static async buscar(filtros: {
    usuarioId?: number
    usuarioTipo?: 'master' | 'municipal'
    acao?: AuditAction
    tabela?: string
    dataInicio?: Date
    dataFim?: Date
    limite?: number
    offset?: number
  }): Promise<{ logs: AuditLog[]; total: number }> {
    let query = AuditLog.query().orderBy('created_at', 'desc')

    if (filtros.usuarioId) {
      query = query.where('usuario_id', filtros.usuarioId)
    }

    if (filtros.usuarioTipo) {
      query = query.where('usuario_tipo', filtros.usuarioTipo)
    }

    if (filtros.acao) {
      query = query.where('acao', filtros.acao)
    }

    if (filtros.tabela) {
      query = query.where('tabela', filtros.tabela)
    }

    if (filtros.dataInicio) {
      query = query.where('created_at', '>=', filtros.dataInicio)
    }

    if (filtros.dataFim) {
      query = query.where('created_at', '<=', filtros.dataFim)
    }

    // Clona para contar
    const totalQuery = query.clone()
    const totalResult = await totalQuery.count('* as total')
    const total = Number(totalResult[0].$extras.total)

    // Aplica paginação
    if (filtros.limite) {
      query = query.limit(filtros.limite)
    }

    if (filtros.offset) {
      query = query.offset(filtros.offset)
    }

    const logs = await query

    return { logs, total }
  }
}
