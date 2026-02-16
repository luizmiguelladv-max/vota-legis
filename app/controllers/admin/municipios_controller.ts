import type { HttpContext } from '@adonisjs/core/http'
import Municipio from '#models/municipio'
import AuditService from '#services/audit_service'
import DatabaseManagerService from '#services/database_manager_service'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export default class MunicipiosController {
  /**
   * Cria o schema do banco de dados para um município
   */
  private async criarSchemaMunicipio(schemaName: string): Promise<void> {
    // Obtém o diretório atual usando import.meta.url
    const __filename = fileURLToPath(import.meta.url)
    const __dirname = path.dirname(__filename)

    // Caminho para o arquivo SQL do schema
    const sqlFilePath = path.resolve(__dirname, '../../../database/migrations/tenant/schema_municipio.sql')

    // Lê o conteúdo do arquivo SQL
    const sqlContent = fs.readFileSync(sqlFilePath, 'utf-8')

    // Usa o pool central para criar o schema
    const pool = DatabaseManagerService.createCentralPool()
    const client = await pool.connect()

    try {
      // Cria o schema
      await client.query(`CREATE SCHEMA IF NOT EXISTS ${schemaName}`)

      // Define o search_path para o novo schema e executa as migrações
      await client.query(`SET search_path TO ${schemaName}`)

      // Divide o SQL em statements e executa cada um
      // Remove comentários e divide por ';'
      const statements = sqlContent
        .split(';')
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && !s.startsWith('--'))

      for (const statement of statements) {
        if (statement.trim()) {
          try {
            await client.query(statement)
          } catch (error: any) {
            // Ignora erros de "já existe" para permitir re-execução
            if (!error.message.includes('already exists') && !error.message.includes('duplicate key')) {
              console.error(`[MunicipiosController] Erro ao executar statement:`, error.message)
            }
          }
        }
      }

      // Restaura o search_path para public
      await client.query('SET search_path TO public')

      console.log(`[MunicipiosController] Schema "${schemaName}" criado com sucesso`)
    } finally {
      client.release()
      await pool.end()
    }
  }

  /**
   * Lista todos os municípios
   */
  async listar({ response }: HttpContext) {
    try {
      const municipios = await Municipio.query().orderBy('nome', 'asc')

      return response.json({
        data: municipios.map((m) => ({
          id: m.id,
          codigoIbge: m.codigoIbge,
          nome: m.nome,
          uf: m.uf,
          slug: m.slug,
          logoUrl: m.logoUrl,
          corPrimaria: m.corPrimaria,
          corSecundaria: m.corSecundaria,
          status: m.status,
          ativo: m.ativo,
          dbSchema: m.dbSchema,
          createdAt: m.createdAt,
          updatedAt: m.updatedAt,
        })),
      })
    } catch (error: any) {
      console.error('[MunicipiosController] Erro ao listar municípios:', error)
      return response.internalServerError({
        error: 'Erro ao listar municípios',
        details: error.message,
      })
    }
  }

  /**
   * Obtém um município específico
   */
  async obter({ params, response }: HttpContext) {
    try {
      const municipio = await Municipio.find(params.id)

      if (!municipio) {
        return response.notFound({ error: 'Município não encontrado' })
      }

      return response.json(municipio)
    } catch (error: any) {
      console.error('[MunicipiosController] Erro ao obter município:', error)
      return response.internalServerError({
        error: 'Erro ao obter município',
        details: error.message,
      })
    }
  }

  /**
   * Cria um novo município
   */
  async criar({ request, response, tenant }: HttpContext) {
    const dados = request.only([
      'codigoIbge',
      'nome',
      'uf',
      'slug',
      'logoUrl',
      'corPrimaria',
      'corSecundaria',
      'dbHost',
      'dbPort',
      'dbName',
      'dbUser',
      'dbPassword',
      'dbSchema',
      'dbConnectionString',
    ])

    try {
      // Valida campos obrigatórios
      if (!dados.nome || !dados.uf) {
        return response.badRequest({ error: 'Nome e UF são obrigatórios' })
      }

      // Gera slug se não informado
      if (!dados.slug) {
        dados.slug = dados.nome
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/[^a-z0-9]+/g, '_')
      }

      // Define schema se não informado
      if (!dados.dbSchema) {
        dados.dbSchema = dados.slug
      }

      const municipio = await Municipio.create({
        ...dados,
        status: 'PENDENTE',
        ativo: true,
      })

      // Cria o schema do banco de dados automaticamente
      try {
        await this.criarSchemaMunicipio(dados.dbSchema)

        // Atualiza o status para ATIVO após criar o schema
        municipio.status = 'ATIVO'
        municipio.bancoCriadoEm = new Date()
        await municipio.save()
      } catch (schemaError: any) {
        console.error('[MunicipiosController] Erro ao criar schema:', schemaError)
        // Atualiza o status para indicar erro
        municipio.status = 'ERRO'
        municipio.statusMensagem = `Erro ao criar schema: ${schemaError.message}`
        await municipio.save()
      }

      // Registra auditoria
      await AuditService.logFromContext(
        { request, tenant } as HttpContext,
        {
          acao: 'CREATE',
          tabela: 'municipios',
          registroId: municipio.id,
          dadosNovos: { nome: municipio.nome, uf: municipio.uf, dbSchema: municipio.dbSchema },
        }
      )

      return response.created({
        success: true,
        message: municipio.status === 'ATIVO'
          ? 'Município criado com sucesso e banco de dados configurado'
          : 'Município criado, mas houve erro ao configurar o banco de dados',
        municipio,
      })
    } catch (error: any) {
      console.error('[MunicipiosController] Erro ao criar município:', error)
      return response.internalServerError({
        error: 'Erro ao criar município',
        details: error.message,
      })
    }
  }

  /**
   * Atualiza um município
   */
  async atualizar({ params, request, response, tenant }: HttpContext) {
    const dados = request.only([
      'codigoIbge',
      'nome',
      'uf',
      'slug',
      'logoUrl',
      'corPrimaria',
      'corSecundaria',
      'status',
      'ativo',
      'dbHost',
      'dbPort',
      'dbName',
      'dbUser',
      'dbPassword',
      'dbSchema',
      'dbConnectionString',
    ])

    try {
      const municipio = await Municipio.find(params.id)

      if (!municipio) {
        return response.notFound({ error: 'Município não encontrado' })
      }

      const dadosAnteriores = {
        nome: municipio.nome,
        uf: municipio.uf,
        status: municipio.status,
      }

      municipio.merge(dados)
      await municipio.save()

      // Registra auditoria
      await AuditService.logFromContext(
        { request, tenant } as HttpContext,
        {
          acao: 'UPDATE',
          tabela: 'municipios',
          registroId: municipio.id,
          dadosAnteriores,
          dadosNovos: { nome: municipio.nome, uf: municipio.uf, status: municipio.status },
        }
      )

      return response.json({
        success: true,
        message: 'Município atualizado com sucesso',
        municipio,
      })
    } catch (error: any) {
      console.error('[MunicipiosController] Erro ao atualizar município:', error)
      return response.internalServerError({
        error: 'Erro ao atualizar município',
        details: error.message,
      })
    }
  }

  /**
   * Exclui um município
   */
  async excluir({ params, request, response, tenant }: HttpContext) {
    try {
      const municipio = await Municipio.find(params.id)

      if (!municipio) {
        return response.notFound({ error: 'Município não encontrado' })
      }

      const dadosAnteriores = {
        id: municipio.id,
        nome: municipio.nome,
        uf: municipio.uf,
      }

      await municipio.delete()

      // Registra auditoria
      await AuditService.logFromContext(
        { request, tenant } as HttpContext,
        {
          acao: 'DELETE',
          tabela: 'municipios',
          registroId: params.id,
          dadosAnteriores,
        }
      )

      return response.json({
        success: true,
        message: 'Município excluído com sucesso',
      })
    } catch (error: any) {
      console.error('[MunicipiosController] Erro ao excluir município:', error)
      return response.internalServerError({
        error: 'Erro ao excluir município',
        details: error.message,
      })
    }
  }

  /**
   * Obtém estatísticas de um município
   */
  async estatisticas({ params, response }: HttpContext) {
    try {
      const municipioId = Number(params.id)
      const municipio = await Municipio.find(municipioId)

      if (!municipio) {
        return response.notFound({ error: 'Município não encontrado' })
      }

      // Busca estatísticas do município
      const stats = {
        funcionarios: 0,
        equipamentos: 0,
        registrosHoje: 0,
        registrosMes: 0,
      }

      try {
        // Total de funcionários
        const funcResult = await DatabaseManagerService.queryMunicipio(
          municipioId,
          'SELECT COUNT(*) as total FROM funcionarios WHERE ativo = true'
        )
        stats.funcionarios = parseInt(funcResult.rows[0]?.total || '0')

        // Total de equipamentos
        const eqResult = await DatabaseManagerService.queryMunicipio(
          municipioId,
          'SELECT COUNT(*) as total FROM equipamentos WHERE ativo = true'
        )
        stats.equipamentos = parseInt(eqResult.rows[0]?.total || '0')

        // Registros hoje
        const hojeResult = await DatabaseManagerService.queryMunicipio(
          municipioId,
          "SELECT COUNT(*) as total FROM registros_ponto WHERE DATE(data_hora) = CURRENT_DATE"
        )
        stats.registrosHoje = parseInt(hojeResult.rows[0]?.total || '0')

        // Registros do mês
        const mesResult = await DatabaseManagerService.queryMunicipio(
          municipioId,
          `SELECT COUNT(*) as total FROM registros_ponto
           WHERE EXTRACT(MONTH FROM data_hora) = EXTRACT(MONTH FROM CURRENT_DATE)
           AND EXTRACT(YEAR FROM data_hora) = EXTRACT(YEAR FROM CURRENT_DATE)`
        )
        stats.registrosMes = parseInt(mesResult.rows[0]?.total || '0')
      } catch {
        // Se falhar ao buscar stats, retorna zeros
      }

      return response.json({
        municipio: {
          id: municipio.id,
          nome: municipio.nome,
          uf: municipio.uf,
        },
        stats,
      })
    } catch (error: any) {
      console.error('[MunicipiosController] Erro ao obter estatísticas:', error)
      return response.internalServerError({
        error: 'Erro ao obter estatísticas',
        details: error.message,
      })
    }
  }
}
