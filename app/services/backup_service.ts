import { spawn } from 'child_process'
import fs from 'fs/promises'
import path from 'path'
import { DateTime } from 'luxon'
import DatabaseManagerService from '#services/database_manager_service'
import Municipio from '#models/municipio'

/**
 * Interface para informações de backup
 */
interface BackupInfo {
  id: string
  nome: string
  tipo: 'COMPLETO' | 'MUNICIPIO' | 'ESTRUTURA'
  tamanho: number
  tamanhoFormatado: string
  dataHora: Date
  municipioId?: number
  municipioNome?: string
  status: 'PENDENTE' | 'EM_ANDAMENTO' | 'CONCLUIDO' | 'ERRO'
  erro?: string
}

/**
 * Interface para resultado de restauração
 */
interface RestoreResult {
  success: boolean
  message: string
  erro?: string
}

/**
 * Serviço de Backup do Banco de Dados
 */
export default class BackupService {
  private static backupDir = path.join(process.cwd(), 'storage', 'backups')
  private static backupsEmAndamento: Map<string, BackupInfo> = new Map()

  /**
   * Inicializa o diretório de backups
   */
  static async inicializar(): Promise<void> {
    try {
      await fs.mkdir(this.backupDir, { recursive: true })
    } catch (error) {
      console.error('[BackupService] Erro ao criar diretório de backups:', error)
    }
  }

  /**
   * Lista todos os backups disponíveis
   */
  static async listarBackups(): Promise<BackupInfo[]> {
    await this.inicializar()

    try {
      const arquivos = await fs.readdir(this.backupDir)
      const backups: BackupInfo[] = []

      for (const arquivo of arquivos) {
        if (arquivo.endsWith('.sql') || arquivo.endsWith('.sql.gz')) {
          const filePath = path.join(this.backupDir, arquivo)
          const stats = await fs.stat(filePath)

          // Extrai informações do nome do arquivo
          // Formato: backup_[tipo]_[municipioId?]_YYYYMMDD_HHmmss.sql
          const partes = arquivo.replace('.sql.gz', '').replace('.sql', '').split('_')

          let tipo: 'COMPLETO' | 'MUNICIPIO' | 'ESTRUTURA' = 'COMPLETO'
          let municipioId: number | undefined
          let municipioNome: string | undefined

          if (partes[1] === 'municipio' && partes[2]) {
            tipo = 'MUNICIPIO'
            municipioId = parseInt(partes[2])
            // Busca nome do município
            const municipio = await Municipio.find(municipioId)
            municipioNome = municipio?.nome
          } else if (partes[1] === 'estrutura') {
            tipo = 'ESTRUTURA'
          }

          backups.push({
            id: arquivo,
            nome: arquivo,
            tipo,
            tamanho: stats.size,
            tamanhoFormatado: this.formatarTamanho(stats.size),
            dataHora: stats.mtime,
            municipioId,
            municipioNome,
            status: 'CONCLUIDO',
          })
        }
      }

      // Ordena por data (mais recente primeiro)
      backups.sort((a, b) => b.dataHora.getTime() - a.dataHora.getTime())

      return backups
    } catch (error) {
      console.error('[BackupService] Erro ao listar backups:', error)
      return []
    }
  }

  /**
   * Cria backup completo do banco de dados
   */
  static async criarBackupCompleto(): Promise<BackupInfo> {
    await this.inicializar()

    const timestamp = DateTime.now().toFormat('yyyyMMdd_HHmmss')
    const nomeArquivo = `backup_completo_${timestamp}.sql`
    const filePath = path.join(this.backupDir, nomeArquivo)

    const backupInfo: BackupInfo = {
      id: nomeArquivo,
      nome: nomeArquivo,
      tipo: 'COMPLETO',
      tamanho: 0,
      tamanhoFormatado: '0 B',
      dataHora: new Date(),
      status: 'EM_ANDAMENTO',
    }

    this.backupsEmAndamento.set(nomeArquivo, backupInfo)

    try {
      // Obtém configuração do banco de dados
      const dbConfig = await this.obterConfigBanco()

      // Executa pg_dump
      await this.executarPgDump(dbConfig, filePath)

      // Atualiza informações
      const stats = await fs.stat(filePath)
      backupInfo.tamanho = stats.size
      backupInfo.tamanhoFormatado = this.formatarTamanho(stats.size)
      backupInfo.status = 'CONCLUIDO'

      console.log(`[BackupService] Backup completo criado: ${nomeArquivo}`)

      return backupInfo
    } catch (error: any) {
      backupInfo.status = 'ERRO'
      backupInfo.erro = error.message
      console.error('[BackupService] Erro ao criar backup completo:', error)
      throw error
    } finally {
      this.backupsEmAndamento.delete(nomeArquivo)
    }
  }

  /**
   * Cria backup de um município específico
   */
  static async criarBackupMunicipio(municipioId: number): Promise<BackupInfo> {
    await this.inicializar()

    const municipio = await Municipio.find(municipioId)
    if (!municipio) {
      throw new Error('Município não encontrado')
    }

    const timestamp = DateTime.now().toFormat('yyyyMMdd_HHmmss')
    const nomeArquivo = `backup_municipio_${municipioId}_${timestamp}.sql`
    const filePath = path.join(this.backupDir, nomeArquivo)

    const backupInfo: BackupInfo = {
      id: nomeArquivo,
      nome: nomeArquivo,
      tipo: 'MUNICIPIO',
      tamanho: 0,
      tamanhoFormatado: '0 B',
      dataHora: new Date(),
      municipioId,
      municipioNome: municipio.nome,
      status: 'EM_ANDAMENTO',
    }

    this.backupsEmAndamento.set(nomeArquivo, backupInfo)

    try {
      // Obtém configuração do banco de dados
      const dbConfig = await this.obterConfigBanco()

      // Executa pg_dump apenas para o schema do município
      const schema = municipio.dbSchema || municipio.slug
      await this.executarPgDump(dbConfig, filePath, schema)

      // Atualiza informações
      const stats = await fs.stat(filePath)
      backupInfo.tamanho = stats.size
      backupInfo.tamanhoFormatado = this.formatarTamanho(stats.size)
      backupInfo.status = 'CONCLUIDO'

      console.log(`[BackupService] Backup do município ${municipio.nome} criado: ${nomeArquivo}`)

      return backupInfo
    } catch (error: any) {
      backupInfo.status = 'ERRO'
      backupInfo.erro = error.message
      console.error(`[BackupService] Erro ao criar backup do município ${municipioId}:`, error)
      throw error
    } finally {
      this.backupsEmAndamento.delete(nomeArquivo)
    }
  }

  /**
   * Cria backup apenas da estrutura (sem dados)
   */
  static async criarBackupEstrutura(): Promise<BackupInfo> {
    await this.inicializar()

    const timestamp = DateTime.now().toFormat('yyyyMMdd_HHmmss')
    const nomeArquivo = `backup_estrutura_${timestamp}.sql`
    const filePath = path.join(this.backupDir, nomeArquivo)

    const backupInfo: BackupInfo = {
      id: nomeArquivo,
      nome: nomeArquivo,
      tipo: 'ESTRUTURA',
      tamanho: 0,
      tamanhoFormatado: '0 B',
      dataHora: new Date(),
      status: 'EM_ANDAMENTO',
    }

    this.backupsEmAndamento.set(nomeArquivo, backupInfo)

    try {
      // Obtém configuração do banco de dados
      const dbConfig = await this.obterConfigBanco()

      // Executa pg_dump apenas com estrutura
      await this.executarPgDump(dbConfig, filePath, undefined, true)

      // Atualiza informações
      const stats = await fs.stat(filePath)
      backupInfo.tamanho = stats.size
      backupInfo.tamanhoFormatado = this.formatarTamanho(stats.size)
      backupInfo.status = 'CONCLUIDO'

      console.log(`[BackupService] Backup de estrutura criado: ${nomeArquivo}`)

      return backupInfo
    } catch (error: any) {
      backupInfo.status = 'ERRO'
      backupInfo.erro = error.message
      console.error('[BackupService] Erro ao criar backup de estrutura:', error)
      throw error
    } finally {
      this.backupsEmAndamento.delete(nomeArquivo)
    }
  }

  /**
   * Exclui um backup
   */
  static async excluirBackup(nomeArquivo: string): Promise<boolean> {
    try {
      const filePath = path.join(this.backupDir, nomeArquivo)
      await fs.unlink(filePath)
      console.log(`[BackupService] Backup excluído: ${nomeArquivo}`)
      return true
    } catch (error) {
      console.error(`[BackupService] Erro ao excluir backup ${nomeArquivo}:`, error)
      return false
    }
  }

  /**
   * Baixa um backup
   */
  static async obterCaminhoBackup(nomeArquivo: string): Promise<string | null> {
    const filePath = path.join(this.backupDir, nomeArquivo)
    try {
      await fs.access(filePath)
      return filePath
    } catch {
      return null
    }
  }

  /**
   * Exporta dados de um município em formato JSON
   */
  static async exportarDadosMunicipio(municipioId: number): Promise<object> {
    const municipio = await Municipio.find(municipioId)
    if (!municipio) {
      throw new Error('Município não encontrado')
    }

    // Busca todas as tabelas do schema
    const tabelas = [
      'unidades_gestoras',
      'secretarias',
      'lotacoes',
      'tipos_vinculo',
      'cargos',
      'jornadas',
      'jornada_horarios',
      'funcionarios',
      'equipamentos',
      'feriados',
      'tipos_ocorrencia',
      'ocorrencias',
      'registros_ponto',
      'espelhos_ponto',
      'usuarios',
    ]

    const dados: Record<string, any[]> = {}

    for (const tabela of tabelas) {
      try {
        const result = await DatabaseManagerService.queryMunicipio(
          municipioId,
          `SELECT * FROM ${tabela}`
        )
        dados[tabela] = result.rows
      } catch (error) {
        console.warn(`[BackupService] Tabela ${tabela} não encontrada ou erro ao exportar`)
        dados[tabela] = []
      }
    }

    return {
      municipio: {
        id: municipio.id,
        nome: municipio.nome,
        uf: municipio.uf,
        codigoIbge: municipio.codigoIbge,
      },
      exportadoEm: new Date().toISOString(),
      dados,
    }
  }

  /**
   * Obtém configuração do banco de dados
   */
  private static async obterConfigBanco(): Promise<{
    host: string
    port: number
    database: string
    user: string
    password: string
  }> {
    // Tenta obter do primeiro município ou usar variáveis de ambiente
    const municipio = await Municipio.query().first()

    if (municipio?.dbHost) {
      return {
        host: municipio.dbHost,
        port: municipio.dbPort || 5432,
        database: municipio.dbName || 'ponto_eletronico',
        user: municipio.dbUser || 'postgres',
        password: municipio.dbPassword || '',
      }
    }

    // Fallback para variáveis de ambiente
    return {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432'),
      database: process.env.DB_DATABASE || 'ponto_eletronico',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || '',
    }
  }

  /**
   * Executa pg_dump
   */
  private static async executarPgDump(
    config: { host: string; port: number; database: string; user: string; password: string },
    outputPath: string,
    schema?: string,
    estruturaApenas: boolean = false
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const args = [
        '-h',
        config.host,
        '-p',
        config.port.toString(),
        '-U',
        config.user,
        '-d',
        config.database,
        '-f',
        outputPath,
        '--no-owner',
        '--no-acl',
      ]

      if (schema) {
        args.push('-n', schema)
      }

      if (estruturaApenas) {
        args.push('--schema-only')
      }

      const env = { ...process.env, PGPASSWORD: config.password }

      const proc = spawn('pg_dump', args, { env })

      let stderr = ''

      proc.stderr.on('data', (data) => {
        stderr += data.toString()
      })

      proc.on('close', (code) => {
        if (code === 0) {
          resolve()
        } else {
          reject(new Error(`pg_dump falhou com código ${code}: ${stderr}`))
        }
      })

      proc.on('error', (error) => {
        // Se pg_dump não estiver disponível, cria arquivo vazio com aviso
        if ((error as any).code === 'ENOENT') {
          console.warn(
            '[BackupService] pg_dump não encontrado. Criando backup via SQL export...'
          )
          // Fallback: cria backup via queries SQL
          this.criarBackupViaSql(config, outputPath, schema, estruturaApenas)
            .then(resolve)
            .catch(reject)
        } else {
          reject(error)
        }
      })
    })
  }

  /**
   * Cria backup via consultas SQL (fallback quando pg_dump não está disponível)
   */
  private static async criarBackupViaSql(
    _config: { host: string; port: number; database: string; user: string; password: string },
    outputPath: string,
    schema?: string,
    estruturaApenas: boolean = false
  ): Promise<void> {
    const linhas: string[] = []

    linhas.push('-- Backup gerado pelo Sistema de Ponto Eletrônico')
    linhas.push(`-- Data: ${DateTime.now().toFormat('dd/MM/yyyy HH:mm:ss')}`)
    linhas.push(`-- Tipo: ${estruturaApenas ? 'Estrutura' : 'Completo'}`)
    if (schema) {
      linhas.push(`-- Schema: ${schema}`)
    }
    linhas.push('')

    // Se for backup de município específico
    if (schema) {
      const municipio = await Municipio.query().where('db_schema', schema).orWhere('slug', schema).first()

      if (municipio) {
        linhas.push(`-- Município: ${municipio.nome}`)
        linhas.push('')

        // Exporta dados das tabelas
        const tabelas = [
          'unidades_gestoras',
          'secretarias',
          'lotacoes',
          'tipos_vinculo',
          'cargos',
          'jornadas',
          'funcionarios',
          'equipamentos',
          'feriados',
          'tipos_ocorrencia',
          'ocorrencias',
          'registros_ponto',
        ]

        for (const tabela of tabelas) {
          try {
            const result = await DatabaseManagerService.queryMunicipio(
              municipio.id,
              `SELECT * FROM ${tabela}`
            )

            if (result.rows.length > 0 && !estruturaApenas) {
              linhas.push(`-- Tabela: ${schema}.${tabela}`)
              linhas.push(`-- Registros: ${result.rows.length}`)

              for (const row of result.rows) {
                const colunas = Object.keys(row).join(', ')
                const valores = Object.values(row)
                  .map((v) => (v === null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`))
                  .join(', ')

                linhas.push(`INSERT INTO ${schema}.${tabela} (${colunas}) VALUES (${valores});`)
              }
              linhas.push('')
            }
          } catch {
            // Ignora tabelas que não existem
          }
        }
      }
    } else {
      linhas.push('-- Backup completo requer pg_dump instalado')
      linhas.push('-- Este é um arquivo placeholder')
    }

    await fs.writeFile(outputPath, linhas.join('\n'), 'utf-8')
  }

  /**
   * Formata tamanho em bytes para formato legível
   */
  private static formatarTamanho(bytes: number): string {
    const unidades = ['B', 'KB', 'MB', 'GB']
    let i = 0
    let tamanho = bytes

    while (tamanho >= 1024 && i < unidades.length - 1) {
      tamanho /= 1024
      i++
    }

    return `${tamanho.toFixed(1)} ${unidades[i]}`
  }

  /**
   * Obtém backups em andamento
   */
  static obterBackupsEmAndamento(): BackupInfo[] {
    return Array.from(this.backupsEmAndamento.values())
  }

  /**
   * Limpa backups antigos (mantém últimos N backups por tipo)
   */
  static async limparBackupsAntigos(manterUltimos: number = 5): Promise<number> {
    const backups = await this.listarBackups()
    let excluidos = 0

    // Agrupa por tipo
    const porTipo: Record<string, BackupInfo[]> = {}
    for (const backup of backups) {
      const tipo = backup.tipo
      if (!porTipo[tipo]) {
        porTipo[tipo] = []
      }
      porTipo[tipo].push(backup)
    }

    // Exclui backups antigos de cada tipo
    for (const tipo of Object.keys(porTipo)) {
      const backupsTipo = porTipo[tipo]
      if (backupsTipo.length > manterUltimos) {
        const paraExcluir = backupsTipo.slice(manterUltimos)
        for (const backup of paraExcluir) {
          if (await this.excluirBackup(backup.id)) {
            excluidos++
          }
        }
      }
    }

    return excluidos
  }
}
