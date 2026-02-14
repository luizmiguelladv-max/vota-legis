import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Municipio from './municipio.js'

/**
 * Model Entidade - Representa uma entidade pública ou privada
 *
 * Cada entidade tem seu próprio schema no banco de dados.
 *
 * TIPOS:
 * - PUBLICA: Órgãos públicos (Prefeitura, Câmara, Autarquia, Fundo)
 * - PRIVADA: Empresas privadas (Empresa, Indústria, Comércio, Serviços)
 */
export default class Entidade extends BaseModel {
  static table = 'public.entidades'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare municipioId: number

  // Tipo e Categoria
  @column()
  declare tipo: 'PUBLICA' | 'PRIVADA'

  @column()
  declare categoria: 'PREFEITURA' | 'CAMARA' | 'AUTARQUIA' | 'FUNDO' | 'CONSORCIO' | 'EMPRESA' | 'INDUSTRIA' | 'COMERCIO' | 'SERVICOS'

  // Identificação
  @column()
  declare nome: string

  @column()
  declare nomeCurto: string | null

  @column()
  declare cnpj: string | null

  @column()
  declare razaoSocial: string | null

  @column()
  declare inscricaoEstadual: string | null

  @column()
  declare inscricaoMunicipal: string | null

  // Endereço
  @column()
  declare endereco: string | null

  @column()
  declare cidade: string | null

  @column()
  declare uf: string | null

  @column()
  declare cep: string | null

  // Contato
  @column()
  declare telefone: string | null

  @column()
  declare email: string | null

  // Configurações do banco
  @column()
  declare dbSchema: string | null

  @column()
  declare dbHost: string | null

  @column()
  declare dbPort: number

  @column()
  declare dbName: string | null

  @column()
  declare dbUser: string | null

  @column({ serializeAs: null })
  declare dbPassword: string | null

  @column()
  declare dbConnectionString: string | null

  @column.dateTime()
  declare bancoCriadoEm: DateTime | null

  // Módulos habilitados
  @column()
  declare moduloFacial: boolean

  @column()
  declare moduloDigital: boolean

  @column()
  declare moduloREP: boolean

  @column()
  declare moduloApp: boolean

  @column()
  declare moduloBancoHoras: boolean

  // Visual
  @column()
  declare logoUrl: string | null

  @column()
  declare corPrimaria: string

  @column()
  declare corSecundaria: string

  // Status
  @column()
  declare status: 'ATIVO' | 'PENDENTE' | 'SUSPENSO' | 'INATIVO'

  @column()
  declare ativo: boolean

  @column.date()
  declare dataInicioSistema: DateTime | null

  @column()
  declare diaFechamentoEspelho: number | null

  @column()
  declare modoManutencao: boolean

  @column()
  declare mensagemManutencao: string | null

  // Configurações extras
  @column()
  declare configuracoes: Record<string, any>

  // Timestamps
  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  // Relacionamentos
  @belongsTo(() => Municipio)
  declare municipio: BelongsTo<typeof Municipio>

  // Métodos auxiliares
  get isAtivo(): boolean {
    return this.ativo && this.status === 'ATIVO'
  }

  get isPublica(): boolean {
    return this.tipo === 'PUBLICA'
  }

  get isPrivada(): boolean {
    return this.tipo === 'PRIVADA'
  }

  get connectionConfig() {
    if (this.dbConnectionString) {
      return { connectionString: this.dbConnectionString }
    }
    return {
      host: this.dbHost,
      port: this.dbPort,
      database: this.dbName,
      user: this.dbUser,
      password: this.dbPassword,
    }
  }

  /**
   * Retorna o nome do schema baseado no slug do município e categoria
   * Ex: santo_andre_prefeitura, santo_andre_camara
   */
  static gerarDbSchema(municipioSlug: string, categoria: string): string {
    return `${municipioSlug}_${categoria.toLowerCase()}`
  }
}
