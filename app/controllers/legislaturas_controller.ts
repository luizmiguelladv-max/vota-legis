import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'

export default class LegislaturasController {
  /**
   * Lista todas as legislaturas
   */
  async index({ view, tenant }: HttpContext) {
    const schemaName = tenant!.schemaName

    const result = await db.rawQuery(`
      SELECT l.*,
        (SELECT COUNT(*) FROM "${schemaName}".vereadores v WHERE v.legislatura_id = l.id) as total_vereadores,
        (SELECT COUNT(*) FROM "${schemaName}".sessoes s WHERE s.legislatura_id = l.id) as total_sessoes
      FROM "${schemaName}".legislaturas l
      ORDER BY l.numero DESC
    `)

    return view.render('pages/legislaturas/index', {
      legislaturas: result.rows
    })
  }

  /**
   * Formulario de nova legislatura
   */
  async create({ view }: HttpContext) {
    return view.render('pages/legislaturas/create')
  }

  /**
   * Salva nova legislatura
   */
  async store({ request, response, session, tenant }: HttpContext) {
    const schemaName = tenant!.schemaName
    const data = request.only(['numero', 'data_inicio', 'data_fim', 'atual', 'descricao'])

    try {
      // Verifica se número já existe
      const existente = await db.rawQuery(`
        SELECT id FROM "${schemaName}".legislaturas WHERE numero = $1
      `, [data.numero])

      if (existente.rows.length > 0) {
        session.flash('error', 'Já existe uma legislatura com este número')
        return response.redirect().back()
      }

      // Se marcou como atual, desmarca as outras
      if (data.atual === 'true') {
        await db.rawQuery(`
          UPDATE "${schemaName}".legislaturas SET atual = false WHERE atual = true
        `)
      }

      await db.rawQuery(`
        INSERT INTO "${schemaName}".legislaturas (numero, data_inicio, data_fim, atual, descricao, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
      `, [
        data.numero,
        data.data_inicio || null,
        data.data_fim || null,
        data.atual === 'true',
        data.descricao || null
      ])

      session.flash('success', 'Legislatura cadastrada com sucesso')
      return response.redirect().toRoute('legislaturas.index')
    } catch (error) {
      console.error('Erro ao criar legislatura:', error)
      session.flash('error', 'Erro ao cadastrar legislatura')
      return response.redirect().back()
    }
  }

  /**
   * Exibe detalhes da legislatura
   */
  async show({ params, view, response, session, tenant }: HttpContext) {
    const schemaName = tenant!.schemaName

    const result = await db.rawQuery(`
      SELECT * FROM "${schemaName}".legislaturas WHERE id = $1
    `, [params.id])

    if (result.rows.length === 0) {
      session.flash('error', 'Legislatura não encontrada')
      return response.redirect().toRoute('legislaturas.index')
    }

    // Busca vereadores da legislatura
    const vereadores = await db.rawQuery(`
      SELECT v.id, v.nome, v.nome_parlamentar, v.status, v.cargo,
        p.sigla as partido_sigla
      FROM "${schemaName}".vereadores v
      LEFT JOIN "${schemaName}".partidos p ON v.partido_id = p.id
      WHERE v.legislatura_id = $1
      ORDER BY v.nome ASC
    `, [params.id])

    // Busca estatísticas de sessões
    const estatisticas = await db.rawQuery(`
      SELECT
        COUNT(*) as total_sessoes,
        COUNT(CASE WHEN status = 'realizada' THEN 1 END) as sessoes_realizadas,
        COUNT(CASE WHEN status = 'cancelada' THEN 1 END) as sessoes_canceladas
      FROM "${schemaName}".sessoes
      WHERE legislatura_id = $1
    `, [params.id])

    return view.render('pages/legislaturas/show', {
      legislatura: result.rows[0],
      vereadores: vereadores.rows,
      estatisticas: estatisticas.rows[0]
    })
  }

  /**
   * Formulario de edicao
   */
  async edit({ params, view, response, session, tenant }: HttpContext) {
    const schemaName = tenant!.schemaName

    const result = await db.rawQuery(`
      SELECT * FROM "${schemaName}".legislaturas WHERE id = $1
    `, [params.id])

    if (result.rows.length === 0) {
      session.flash('error', 'Legislatura não encontrada')
      return response.redirect().toRoute('legislaturas.index')
    }

    return view.render('pages/legislaturas/edit', {
      legislatura: result.rows[0]
    })
  }

  /**
   * Atualiza legislatura
   */
  async update({ params, request, response, session, tenant }: HttpContext) {
    const schemaName = tenant!.schemaName
    const data = request.only(['numero', 'data_inicio', 'data_fim', 'atual', 'descricao'])

    try {
      // Verifica se número já existe em outra legislatura
      const existente = await db.rawQuery(`
        SELECT id FROM "${schemaName}".legislaturas WHERE numero = $1 AND id != $2
      `, [data.numero, params.id])

      if (existente.rows.length > 0) {
        session.flash('error', 'Já existe outra legislatura com este número')
        return response.redirect().back()
      }

      // Se marcou como atual, desmarca as outras
      if (data.atual === 'true') {
        await db.rawQuery(`
          UPDATE "${schemaName}".legislaturas SET atual = false WHERE atual = true AND id != $1
        `, [params.id])
      }

      await db.rawQuery(`
        UPDATE "${schemaName}".legislaturas
        SET numero = $1, data_inicio = $2, data_fim = $3, atual = $4, descricao = $5, updated_at = NOW()
        WHERE id = $6
      `, [
        data.numero,
        data.data_inicio || null,
        data.data_fim || null,
        data.atual === 'true',
        data.descricao || null,
        params.id
      ])

      session.flash('success', 'Legislatura atualizada com sucesso')
      return response.redirect().toRoute('legislaturas.index')
    } catch (error) {
      console.error('Erro ao atualizar legislatura:', error)
      session.flash('error', 'Erro ao atualizar legislatura')
      return response.redirect().back()
    }
  }

  /**
   * Remove legislatura
   */
  async destroy({ params, response, session, tenant }: HttpContext) {
    const schemaName = tenant!.schemaName

    try {
      // Verifica se há vereadores vinculados
      const vereadores = await db.rawQuery(`
        SELECT COUNT(*) as total FROM "${schemaName}".vereadores WHERE legislatura_id = $1
      `, [params.id])

      if (parseInt(vereadores.rows[0].total) > 0) {
        session.flash('error', 'Não é possível excluir legislatura com vereadores vinculados')
        return response.redirect().toRoute('legislaturas.index')
      }

      // Verifica se há sessões vinculadas
      const sessoes = await db.rawQuery(`
        SELECT COUNT(*) as total FROM "${schemaName}".sessoes WHERE legislatura_id = $1
      `, [params.id])

      if (parseInt(sessoes.rows[0].total) > 0) {
        session.flash('error', 'Não é possível excluir legislatura com sessões vinculadas')
        return response.redirect().toRoute('legislaturas.index')
      }

      await db.rawQuery(`
        DELETE FROM "${schemaName}".legislaturas WHERE id = $1
      `, [params.id])

      session.flash('success', 'Legislatura excluída com sucesso')
    } catch (error) {
      console.error('Erro ao excluir legislatura:', error)
      session.flash('error', 'Erro ao excluir legislatura')
    }

    return response.redirect().toRoute('legislaturas.index')
  }

  /**
   * Define legislatura como atual
   */
  async definirAtual({ params, response, session, tenant }: HttpContext) {
    const schemaName = tenant!.schemaName

    try {
      // Desmarca todas
      await db.rawQuery(`
        UPDATE "${schemaName}".legislaturas SET atual = false WHERE atual = true
      `)

      // Marca a selecionada
      await db.rawQuery(`
        UPDATE "${schemaName}".legislaturas SET atual = true WHERE id = $1
      `, [params.id])

      session.flash('success', 'Legislatura atual definida com sucesso')
    } catch (error) {
      console.error('Erro ao definir legislatura atual:', error)
      session.flash('error', 'Erro ao definir legislatura atual')
    }

    return response.redirect().toRoute('legislaturas.index')
  }

  /**
   * API: Lista legislaturas (JSON)
   */
  async list({ response, tenant }: HttpContext) {
    const schemaName = tenant!.schemaName

    const result = await db.rawQuery(`
      SELECT id, numero, data_inicio, data_fim, atual, descricao
      FROM "${schemaName}".legislaturas
      ORDER BY numero DESC
    `)

    return response.json(result.rows)
  }
}
