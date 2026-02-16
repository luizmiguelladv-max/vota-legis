import type { HttpContext } from '@adonisjs/core/http'
import { dbManager } from '#services/database_manager_service'
import { cacheService } from '#services/cache_service'
import type { Funcionario, DataTableResponse } from '#models/tenant/types'
import AuditLog from '#models/audit_log'

export default class FuncionariosController {
  /**
   * Lista funcionários com suporte a DataTables server-side
   */
  async index({ request, response, tenant }: HttpContext) {
    if (!tenant?.municipioId) {
      return response.unauthorized({ error: 'Município não selecionado' })
    }

    // Usa queryTenant para respeitar o schema da entidade quando logado em uma

    // Parâmetros do DataTables
    const draw = request.input('draw', 1)
    const start = request.input('start', 0)
    const length = request.input('length', 10)
    const searchValue = request.input('search[value]', '')

    // Filtros adicionais
    const lotacaoId = request.input('lotacao_id')
    const secretariaId = request.input('secretaria_id')
    const situacao = request.input('situacao', 'ativos') // ativos, inativos, todos

    // Ordenação
    const orderColumn = request.input('order[0][column]', '0')
    const orderDir = request.input('order[0][dir]', 'asc')

    // Mapeamento de colunas para ordenação
    const columns = ['f.matricula', 'f.nome', 'f.cpf', 'c.nome', 'l.nome', 'f.data_admissao']
    const orderBy = columns[Number(orderColumn)] || 'f.nome'

    try {
      // Query base
      let baseQuery = `
        FROM funcionarios f
        LEFT JOIN lotacoes l ON l.id = f.lotacao_id
        LEFT JOIN secretarias s ON s.id = l.secretaria_id
        LEFT JOIN cargos c ON c.id = f.cargo_id
        LEFT JOIN jornadas j ON j.id = f.jornada_id
        WHERE 1=1
      `
      const params: any[] = []
      let paramIndex = 1

      // Filtro de situação
      if (situacao === 'ativos') {
        baseQuery += ` AND f.ativo = true`
      } else if (situacao === 'inativos') {
        baseQuery += ` AND f.ativo = false`
      }

      // Filtro de lotação
      if (lotacaoId) {
        baseQuery += ` AND f.lotacao_id = $${paramIndex++}`
        params.push(lotacaoId)
      }

      // Filtro de secretaria
      if (secretariaId) {
        baseQuery += ` AND s.id = $${paramIndex++}`
        params.push(secretariaId)
      }

      // Filtro de busca
      if (searchValue) {
        baseQuery += ` AND (
          f.nome ILIKE $${paramIndex} OR
          f.matricula ILIKE $${paramIndex} OR
          f.cpf ILIKE $${paramIndex}
        )`
        params.push(`%${searchValue}%`)
        paramIndex++
      }

      // Total de registros (sem filtros)
      const [totalResult] = await dbManager.queryTenant<{ count: number }>(
        tenant,
        `SELECT COUNT(*) as count FROM funcionarios`
      )
      const recordsTotal = Number(totalResult?.count || 0)

      // Total filtrado
      const [filteredResult] = await dbManager.queryTenant<{ count: number }>(
        tenant,
        `SELECT COUNT(*) as count ${baseQuery}`,
        params
      )
      const recordsFiltered = Number(filteredResult?.count || 0)

      // Busca dados paginados
      const dataQuery = `
        SELECT
          f.id, f.matricula, f.cpf, f.pis, f.nome, f.data_nascimento, f.sexo,
          f.lotacao_id, f.cargo_id, f.tipo_vinculo_id, f.jornada_id,
          f.data_admissao, f.data_demissao, f.foto_url, f.ativo,
          f.created_at, f.updated_at,
          c.nome as cargo_nome,
          l.nome as lotacao_nome,
          s.nome as secretaria_nome,
          j.nome as jornada_nome
        ${baseQuery}
        ORDER BY ${orderBy} ${orderDir.toUpperCase()}
        LIMIT $${paramIndex++} OFFSET $${paramIndex}
      `
      params.push(length, start)

      const data = await dbManager.queryTenant(tenant, dataQuery, params)

      const result: DataTableResponse<any> = {
        draw: Number(draw),
        recordsTotal,
        recordsFiltered,
        data,
      }

      return response.json(result)
    } catch (error) {
      console.error('Erro ao listar funcionários:', error)
      return response.internalServerError({ error: 'Erro ao listar funcionários' })
    }
  }

  /**
   * Lista funcionários para select/dropdown
   */
  async select({ response, tenant }: HttpContext) {
    if (!tenant?.municipioId) {
      return response.unauthorized({ error: 'Município não selecionado' })
    }

    try {
      const funcionarios = await dbManager.queryTenant(
        tenant,
        `SELECT id, matricula, nome FROM funcionarios
         WHERE ativo = true
         ORDER BY nome`
      )

      return response.json(funcionarios)
    } catch (error) {
      return response.internalServerError({ error: 'Erro ao carregar funcionários' })
    }
  }

  /**
   * Busca funcionário por matrícula ou CPF
   */
  async buscar({ request, response, tenant }: HttpContext) {
    if (!tenant?.municipioId) {
      return response.unauthorized({ error: 'Município não selecionado' })
    }

    const { termo } = request.qs()

    if (!termo) {
      return response.badRequest({ error: 'Informe matrícula ou CPF' })
    }

    try {
      const funcionario = await dbManager.queryTenantOne(
        tenant,
        `SELECT f.*, c.nome as cargo_nome, l.nome as lotacao_nome
         FROM funcionarios f
         LEFT JOIN cargos c ON c.id = f.cargo_id
         LEFT JOIN lotacoes l ON l.id = f.lotacao_id
         WHERE f.matricula = $1 OR f.cpf = $1`,
        [termo]
      )

      if (!funcionario) {
        return response.notFound({ error: 'Funcionário não encontrado' })
      }

      return response.json(funcionario)
    } catch (error) {
      return response.internalServerError({ error: 'Erro ao buscar funcionário' })
    }
  }

  /**
   * Retorna um funcionário específico
   */
  async show({ params, response, tenant }: HttpContext) {
    if (!tenant?.municipioId) {
      return response.unauthorized({ error: 'Município não selecionado' })
    }

    try {
      const funcionario = await dbManager.queryTenantOne(
        tenant,
        `SELECT f.*,
                c.nome as cargo_nome,
                l.nome as lotacao_nome,
                l.secretaria_id as secretaria_id,
                s.nome as secretaria_nome,
                s.unidade_gestora_id as unidade_gestora_id,
                j.nome as jornada_nome,
                tv.nome as tipo_vinculo_nome
         FROM funcionarios f
         LEFT JOIN cargos c ON c.id = f.cargo_id
         LEFT JOIN lotacoes l ON l.id = f.lotacao_id
         LEFT JOIN secretarias s ON s.id = l.secretaria_id
         LEFT JOIN jornadas j ON j.id = f.jornada_id
         LEFT JOIN tipos_vinculo tv ON tv.id = f.tipo_vinculo_id
         WHERE f.id = $1`,
        [params.id]
      )

      if (!funcionario) {
        return response.notFound({ error: 'Funcionário não encontrado' })
      }

      return response.json(funcionario)
    } catch (error) {
      return response.internalServerError({ error: 'Erro ao buscar funcionário' })
    }
  }

  /**
   * Cria um novo funcionário
   */
  async store({ request, response, tenant }: HttpContext) {
    if (!tenant?.municipioId) {
      return response.unauthorized({ error: 'Município não selecionado' })
    }

    // Verifica permissão (ADMIN ou RH)
    if (!tenant.isSuperAdmin && !['ADMIN', 'RH'].includes(tenant.usuario?.perfil || '')) {
      return response.forbidden({ error: 'Sem permissão para cadastrar funcionários' })
    }

    const data = request.only([
      'matricula',
      'cpf',
      'pis',
      'nome',
      'data_nascimento',
      'sexo',
      'lotacao_id',
      'cargo_id',
      'tipo_vinculo_id',
      'jornada_id',
      'data_admissao',
      'foto_url',
    ])

    try {
      // Verifica duplicidade de matrícula
      const existeMatricula = await dbManager.queryTenantOne(
        tenant,
        `SELECT id FROM funcionarios WHERE matricula = $1`,
        [data.matricula]
      )

      if (existeMatricula) {
        return response.badRequest({ error: 'Matrícula já cadastrada' })
      }

      // Verifica duplicidade de CPF
      const existeCpf = await dbManager.queryTenantOne(
        tenant,
        `SELECT id FROM funcionarios WHERE cpf = $1`,
        [data.cpf]
      )

      if (existeCpf) {
        return response.badRequest({ error: 'CPF já cadastrado' })
      }

      // Insere funcionário
      const [result] = await dbManager.queryTenant<{ id: number }>(
        tenant,
        `INSERT INTO funcionarios (
          matricula, cpf, pis, nome, data_nascimento, sexo,
          lotacao_id, cargo_id, tipo_vinculo_id, jornada_id,
          data_admissao, foto_url, intervalo_presenca
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        RETURNING id`,
        [
          data.matricula,
          data.cpf,
          data.pis || null,
          data.nome,
          data.data_nascimento || null,
          data.sexo || null,
          data.lotacao_id || null,
          data.cargo_id || null,
          data.tipo_vinculo_id || null,
          data.jornada_id || null,
          data.data_admissao,
          data.foto_url || null,
          data.intervalo_presenca || null,
        ]
      )

      // Registra auditoria
      await AuditLog.registrar({
        usuarioId: tenant.usuario?.id,
        usuarioTipo: tenant.isSuperAdmin ? 'master' : 'municipal',
        acao: 'CRIAR',
        tabela: 'funcionarios',
        registroId: result.id,
        dadosNovos: data,
        ip: request.ip(),
        userAgent: request.header('user-agent'),
      })

      // Invalida cache de funcionários
      cacheService.clearEntidade(tenant.municipioId, 'funcionarios', tenant.entidadeId)

      // Sincroniza automaticamente com REPs (em background, não bloqueia resposta)
      this.sincronizarComReps(result.id).catch(err =>
        console.error('[Funcionários] Erro ao sincronizar com REP:', err)
      )

      return response.created({ success: true, id: result.id })
    } catch (error) {
      console.error('Erro ao criar funcionário:', error)
      return response.internalServerError({ error: 'Erro ao criar funcionário' })
    }
  }

  /**
   * Atualiza um funcionário
   */
  async update({ params, request, response, tenant }: HttpContext) {
    if (!tenant?.municipioId) {
      return response.unauthorized({ error: 'Município não selecionado' })
    }

    // Verifica permissão
    if (!tenant.isSuperAdmin && !['ADMIN', 'RH'].includes(tenant.usuario?.perfil || '')) {
      return response.forbidden({ error: 'Sem permissão para editar funcionários' })
    }

    const data = request.only([
      'matricula',
      'cpf',
      'pis',
      'nome',
      'data_nascimento',
      'sexo',
      'lotacao_id',
      'cargo_id',
      'tipo_vinculo_id',
      'jornada_id',
      'data_admissao',
      'data_demissao',
      'foto_url',
      'ativo',
      'intervalo_presenca',
    ])
    
    console.log('[Funcionarios Update] Dados recebidos:', JSON.stringify(data))

    try {
      // Busca dados anteriores
      const anterior = await dbManager.queryTenantOne<Funcionario>(
        tenant,
        `SELECT * FROM funcionarios WHERE id = $1`,
        [params.id]
      )

      if (!anterior) {
        return response.notFound({ error: 'Funcionário não encontrado' })
      }

      // Verifica duplicidade de matrícula
      if (data.matricula && data.matricula !== anterior.matricula) {
        const existeMatricula = await dbManager.queryTenantOne(
          tenant,
          `SELECT id FROM funcionarios WHERE matricula = $1 AND id != $2`,
          [data.matricula, params.id]
        )
        if (existeMatricula) {
          return response.badRequest({ error: 'Matrícula já cadastrada' })
        }
      }

      // Verifica duplicidade de CPF
      if (data.cpf && data.cpf !== anterior.cpf) {
        const existeCpf = await dbManager.queryTenantOne(
          tenant,
          `SELECT id FROM funcionarios WHERE cpf = $1 AND id != $2`,
          [data.cpf, params.id]
        )
        if (existeCpf) {
          return response.badRequest({ error: 'CPF já cadastrado' })
        }
      }

      // Atualiza
      await dbManager.queryTenant(
        tenant,
        `UPDATE funcionarios SET
          matricula = $1, cpf = $2, pis = $3, nome = $4,
          data_nascimento = $5, sexo = $6, lotacao_id = $7,
          cargo_id = $8, tipo_vinculo_id = $9, jornada_id = $10,
          data_admissao = $11, data_demissao = $12, foto_url = $13,
          ativo = $14, intervalo_presenca = $15, updated_at = NOW()
         WHERE id = $16`,
        [
          data.matricula || anterior.matricula,
          data.cpf || anterior.cpf,
          data.pis ?? anterior.pis,
          data.nome || anterior.nome,
          data.data_nascimento ?? anterior.data_nascimento,
          data.sexo ?? anterior.sexo,
          data.lotacao_id ?? anterior.lotacao_id,
          data.cargo_id ?? anterior.cargo_id,
          data.tipo_vinculo_id ?? anterior.tipo_vinculo_id,
          data.jornada_id ?? anterior.jornada_id,
          data.data_admissao || anterior.data_admissao,
          data.data_demissao ?? anterior.data_demissao,
          data.foto_url ?? anterior.foto_url,
          data.ativo ?? anterior.ativo,
          'intervalo_presenca' in data ? data.intervalo_presenca : anterior.intervalo_presenca,
          params.id,
        ]
      )

      // Registra auditoria
      await AuditLog.registrar({
        usuarioId: tenant.usuario?.id,
        usuarioTipo: tenant.isSuperAdmin ? 'master' : 'municipal',
        acao: 'ATUALIZAR',
        tabela: 'funcionarios',
        registroId: Number(params.id),
        dadosAnteriores: anterior,
        dadosNovos: data,
        ip: request.ip(),
        userAgent: request.header('user-agent'),
      })

      // Invalida cache de funcionários
      cacheService.clearEntidade(tenant.municipioId, 'funcionarios', tenant.entidadeId)

      // Se PIS mudou, exclui o antigo e cadastra o novo
      const pisAnterior = anterior?.pis?.replace(/\D/g, '')
      const pisNovo = data.pis?.replace(/\D/g, '')

      if (pisAnterior && pisNovo && pisAnterior !== pisNovo) {
        // PIS mudou - exclui o antigo de todos os REPs
        this.excluirDeReps(pisAnterior).catch((err: unknown) =>
          console.error('[Funcionários] Erro ao excluir PIS antigo dos REPs:', err)
        )
      }

      // Se funcionário foi desativado, exclui do REP
      const foiDesativado = anterior?.ativo === true && data.ativo === false
      if (foiDesativado && pisNovo) {
        this.excluirDeReps(pisNovo).catch((err: unknown) =>
          console.error('[Funcionários] Erro ao excluir funcionário desativado dos REPs:', err)
        )
      } else if (data.ativo !== false) {
        // Só sincroniza se não foi desativado
        this.sincronizarComReps(Number(params.id)).catch((err: unknown) =>
          console.error('[Funcionários] Erro ao sincronizar com REP:', err)
        )
      }

      return response.json({ success: true })
    } catch (error) {
      console.error('Erro ao atualizar funcionário:', error)
      return response.internalServerError({ error: 'Erro ao atualizar funcionário' })
    }
  }

  /**
   * Exclui um funcionário permanentemente
   * Só permite exclusão se o funcionário não tiver registros de ponto
   */
  async destroy({ params, request, response, tenant }: HttpContext) {
    if (!tenant?.municipioId) {
      return response.unauthorized({ error: 'Município não selecionado' })
    }

    try {
      // Verifica se funcionário existe
      const [funcionario] = await dbManager.queryTenant(
        tenant,
        `SELECT id, nome, pis, cpf FROM funcionarios WHERE id = $1`,
        [params.id]
      )

      if (!funcionario) {
        return response.notFound({ error: 'Funcionário não encontrado' })
      }

      // Verifica se tem registros de ponto
      const [contagem] = await dbManager.queryTenant(
        tenant,
        `SELECT COUNT(*) as total FROM registros_ponto WHERE funcionario_id = $1`,
        [params.id]
      )

      const totalRegistros = parseInt(contagem?.total || 0)
      if (totalRegistros > 0) {
        return response.badRequest({
          error: `Este funcionário possui ${totalRegistros} registro(s) de ponto e não pode ser excluído. Desative-o em vez disso.`
        })
      }

      // Verifica se tem espelhos de ponto
      try {
        const [contagemEspelhos] = await dbManager.queryTenant(
          tenant,
          `SELECT COUNT(*) as total FROM espelhos_ponto WHERE funcionario_id = $1`,
          [params.id]
        )
        if (parseInt(contagemEspelhos?.total || 0) > 0) {
          return response.badRequest({
            error: `Este funcionário possui espelhos de ponto e não pode ser excluído. Desative-o em vez disso.`
          })
        }
      } catch (e) {
        // Tabela pode não existir em alguns tenants
      }

      // Exclui dependências (resiliente - ignora tabelas inexistentes)
      const tabelasDependentes = [
        `DELETE FROM funcionario_jornadas WHERE funcionario_id = $1`,
        `DELETE FROM funcionario_templates WHERE funcionario_id = $1`,
        `DELETE FROM funcionarios_fotos WHERE funcionario_id = $1`,
        `DELETE FROM digitais_funcionarios WHERE funcionario_id = $1`,
        `DELETE FROM faces_funcionarios WHERE funcionario_id = $1`,
        `DELETE FROM ocorrencias WHERE funcionario_id = $1`,
        `DELETE FROM anomalias WHERE funcionario_id = $1`,
        `DELETE FROM afastamentos WHERE funcionario_id = $1`,
        `DELETE FROM banco_horas WHERE funcionario_id = $1`,
        `DELETE FROM folgas_programadas WHERE funcionario_id = $1`,
        `DELETE FROM funcionarios_setor WHERE funcionario_id = $1`,
      ]
      
      for (const sql of tabelasDependentes) {
        try {
          await dbManager.queryTenant(tenant, sql, [params.id])
        } catch (e) {
          // Tabela pode não existir em alguns tenants - ignora
        }
      }

      // Remove vínculo com usuário (não exclui o usuário)
      try {
        await dbManager.queryTenant(tenant,
          `UPDATE usuarios SET funcionario_id = NULL WHERE funcionario_id = $1`, [params.id])
      } catch (e) {
        // Ignora se tabela não existir
      }

      // Exclui o funcionário
      await dbManager.queryTenant(
        tenant,
        `DELETE FROM funcionarios WHERE id = $1`,
        [params.id]
      )

      // Registra auditoria
      await AuditLog.registrar({
        usuarioId: tenant.usuario?.id,
        usuarioTipo: tenant.isSuperAdmin ? 'master' : 'municipal',
        acao: 'EXCLUIR',
        tabela: 'funcionarios',
        registroId: Number(params.id),
        dadosAnteriores: funcionario,
        ip: request.ip(),
        userAgent: request.header('user-agent'),
      })

      // Invalida cache
      cacheService.clearEntidade(tenant.municipioId, 'funcionarios', tenant.entidadeId)

      // Exclui do REP também
      const pis = funcionario.pis?.replace(/\D/g, '') || funcionario.cpf?.replace(/\D/g, '')
      if (pis) {
        this.excluirDeReps(pis).catch((err: unknown) =>
          console.error('[Funcionários] Erro ao excluir do REP:', err)
        )
      }

      return response.json({ success: true, message: 'Funcionário excluído permanentemente' })
    } catch (error) {
      console.error('Erro ao excluir funcionário:', error)
      return response.internalServerError({ error: 'Erro ao excluir funcionário' })
    }
  }

  /**
   * Vincula jornada ao funcionário
   */
  async vincularJornada({ params, request, response, tenant }: HttpContext) {
    if (!tenant?.municipioId) {
      return response.unauthorized({ error: 'Município não selecionado' })
    }

    const { jornada_id, data_inicio } = request.only(['jornada_id', 'data_inicio'])

    try {
      // Encerra jornada anterior (se houver)
      await dbManager.queryTenant(
        tenant,
        `UPDATE funcionario_jornadas
         SET data_fim = $1
         WHERE funcionario_id = $2 AND data_fim IS NULL`,
        [data_inicio, params.id]
      )

      // Cria novo vínculo de jornada
      await dbManager.queryTenant(
        tenant,
        `INSERT INTO funcionario_jornadas (funcionario_id, jornada_id, data_inicio)
         VALUES ($1, $2, $3)`,
        [params.id, jornada_id, data_inicio]
      )

      // Atualiza jornada atual no funcionário
      await dbManager.queryTenant(
        tenant,
        `UPDATE funcionarios SET jornada_id = $1, updated_at = NOW() WHERE id = $2`,
        [jornada_id, params.id]
      )

      return response.json({ success: true })
    } catch (error) {
      return response.internalServerError({ error: 'Erro ao vincular jornada' })
    }
  }

  /**
   * Vincula jornada a múltiplos funcionários (ação em massa)
   */
  async vincularJornadaMassa({ request, response, tenant }: HttpContext) {
    if (!tenant?.municipioId) {
      return response.unauthorized({ error: 'Município não selecionado' })
    }

    // Verifica permissão (ADMIN ou RH)
    if (!tenant.isSuperAdmin && !['ADMIN', 'RH'].includes(tenant.usuario?.perfil || '')) {
      return response.forbidden({ error: 'Sem permissão para esta ação' })
    }

    const { funcionario_ids, jornada_id } = request.only(['funcionario_ids', 'jornada_id'])

    if (!funcionario_ids || !Array.isArray(funcionario_ids) || funcionario_ids.length === 0) {
      return response.badRequest({ error: 'Nenhum funcionário selecionado' })
    }

    if (!jornada_id) {
      return response.badRequest({ error: 'Jornada não informada' })
    }

    try {
      // Atualiza todos os funcionários de uma vez
      const placeholders = funcionario_ids.map((_, i) => `$${i + 2}`).join(', ')
      await dbManager.queryTenant(
        tenant,
        `UPDATE funcionarios SET jornada_id = $1, updated_at = NOW() WHERE id IN (${placeholders})`,
        [jornada_id, ...funcionario_ids]
      )

      // Invalida cache
      cacheService.clearEntidade(tenant.municipioId, 'funcionarios', tenant.entidadeId)

      return response.json({ success: true, atualizados: funcionario_ids.length })
    } catch (error) {
      console.error('Erro ao vincular jornadas em massa:', error)
      return response.internalServerError({ error: 'Erro ao vincular jornadas' })
    }
  }

  /**
   * Sincroniza um funcionário com todos os REPs online
   * Chamado automaticamente após criar/atualizar funcionário
   */
  private async sincronizarComReps(funcionarioId: number): Promise<void> {
    try {
      // Chama o REP Proxy para sincronizar com todos os REPs
      const response = await fetch('http://localhost:3334/sincronizar_tudo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ funcionario_id: funcionarioId })
      })

      if (response.ok) {
        const result = await response.json() as { sucessos?: number }
        console.log(`[Funcionários] Sincronizado ID ${funcionarioId} com REPs: ${result.sucessos || 0} OK`)
      }
    } catch (error: unknown) {
      // REP Proxy pode estar offline - não é erro crítico
      console.log('[Funcionários] REP Proxy indisponível para sincronização automática')
    }
  }

  /**
   * Exclui um PIS de todos os REPs online
   * Chamado quando o PIS do funcionário muda
   */
  private async excluirDeReps(pis: string): Promise<void> {
    try {
      const response = await fetch('http://localhost:3334/excluir_todos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pis })
      })

      if (response.ok) {
        const result = await response.json() as { sucessos?: number }
        console.log(`[Funcionários] PIS ${pis} excluído de ${result.sucessos || 0} REPs`)
      }
    } catch (error: unknown) {
      console.log('[Funcionários] REP Proxy indisponível para exclusão automática')
    }
  }
}
