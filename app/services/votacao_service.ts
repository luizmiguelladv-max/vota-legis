/**
 * Votação Service - Lógica de negócio para votações
 */

import db from '@adonisjs/lucid/services/db'
import sseService, { SSE_EVENTS } from './sse_service.js'

interface VotacaoConfig {
  tipo: 'nominal' | 'secreta' | 'simbolica'
  quorumTipo: 'maioria_simples' | 'maioria_absoluta' | 'dois_tercos' | 'unanimidade'
  tempoLimite?: number // segundos, null = sem limite
  permitirAbstencao: boolean
}

interface Voto {
  vereadorId: number
  voto: 'sim' | 'nao' | 'abstencao'
  horaVoto: Date
  ip?: string
  dispositivo?: string
}

interface ResultadoVotacao {
  aprovado: boolean
  votosSim: number
  votosNao: number
  votosAbstencao: number
  totalVotos: number
  quorumNecessario: number
  quorumAtingido: boolean
}

export default class VotacaoService {
  private schemaName: string
  private municipioId: number

  constructor(municipioId: number) {
    this.municipioId = municipioId
    this.schemaName = `camara_${municipioId}`
  }

  /**
   * Inicia uma nova votação
   */
  async iniciarVotacao(
    sessaoId: number,
    materiaId: number | null,
    descricao: string,
    config: VotacaoConfig
  ): Promise<number> {
    // Verifica se já existe votação em andamento
    const emAndamento = await db.rawQuery(`
      SELECT id FROM "${this.schemaName}".votacoes
      WHERE sessao_id = $1 AND status = 'em_andamento'
    `, [sessaoId])

    if (emAndamento.rows.length > 0) {
      throw new Error('Já existe uma votação em andamento nesta sessão')
    }

    // Busca próximo número da votação
    const ultimaVotacao = await db.rawQuery(`
      SELECT COALESCE(MAX(numero_votacao), 0) + 1 as proximo
      FROM "${this.schemaName}".votacoes
      WHERE sessao_id = $1
    `, [sessaoId])

    const numeroVotacao = ultimaVotacao.rows[0].proximo

    // Cria a votação
	    const result = await db.rawQuery(`
	      INSERT INTO "${this.schemaName}".votacoes (
	        sessao_id, materia_id, numero_votacao, tipo, quorum_tipo,
	        descricao, status, hora_inicio, created_at, updated_at
	      )
	      VALUES ($1, $2, $3, $4, $5, $6, 'em_andamento', NOW(), NOW(), NOW())
	      RETURNING id
	    `, [
	      sessaoId,
	      materiaId,
	      numeroVotacao,
	      config.tipo,
	      config.quorumTipo,
	      descricao,
	    ])

    const votacaoId = result.rows[0].id

    // Se tiver matéria, atualiza status na ordem do dia
    if (materiaId) {
      await db.rawQuery(`
        UPDATE "${this.schemaName}".ordem_dia
        SET situacao = 'em_votacao'
        WHERE sessao_id = $1 AND materia_id = $2
      `, [sessaoId, materiaId])
    }

    // Busca informações para broadcast
    const votacaoInfo = await this.getVotacaoDetalhes(votacaoId)

    // Broadcast para todos
    sseService.broadcast(sessaoId, this.municipioId, SSE_EVENTS.VOTACAO_INICIADA, {
      votacao: votacaoInfo,
      config
    })

    return votacaoId
  }

  /**
   * Registra um voto
   */
  async registrarVoto(
    votacaoId: number,
    vereadorId: number,
    voto: 'sim' | 'nao' | 'abstencao',
    ip?: string,
    dispositivo?: string
  ): Promise<boolean> {
    // Verifica se votação está em andamento
    const votacao = await db.rawQuery(`
      SELECT v.*, s.id as sessao_id
      FROM "${this.schemaName}".votacoes v
      JOIN "${this.schemaName}".sessoes s ON v.sessao_id = s.id
      WHERE v.id = $1
    `, [votacaoId])

    if (votacao.rows.length === 0) {
      throw new Error('Votação não encontrada')
    }

    if (votacao.rows[0].status !== 'em_andamento') {
      throw new Error('Esta votação já foi encerrada')
    }

    const sessaoId = votacao.rows[0].sessao_id

    // Verifica se vereador está presente na sessão
    const presenca = await db.rawQuery(`
      SELECT id FROM "${this.schemaName}".sessao_presencas
      WHERE sessao_id = $1 AND vereador_id = $2 AND presente = true
    `, [sessaoId, vereadorId])

    if (presenca.rows.length === 0) {
      throw new Error('Vereador não está presente na sessão')
    }

    // Verifica se já votou
    const jaVotou = await db.rawQuery(`
      SELECT id FROM "${this.schemaName}".votos
      WHERE votacao_id = $1 AND vereador_id = $2
    `, [votacaoId, vereadorId])

    if (jaVotou.rows.length > 0) {
      throw new Error('Vereador já registrou seu voto')
    }

    // Registra o voto
    await db.rawQuery(`
      INSERT INTO "${this.schemaName}".votos (
        votacao_id, vereador_id, voto, hora_voto, ip, dispositivo, created_at
      )
      VALUES ($1, $2, $3, NOW(), $4, $5, NOW())
    `, [votacaoId, vereadorId, voto, ip, dispositivo])

    // Atualiza contagem na votação
    await this.atualizarContagem(votacaoId)

    // Busca informações do vereador
    const vereador = await db.rawQuery(`
      SELECT v.nome, v.nome_parlamentar, p.sigla as partido
      FROM "${this.schemaName}".vereadores v
      LEFT JOIN "${this.schemaName}".partidos p ON v.partido_id = p.id
      WHERE v.id = $1
    `, [vereadorId])

    // Broadcast do voto (se nominal, inclui info do vereador)
    const tipoVotacao = votacao.rows[0].tipo
    const eventoData: any = {
      votacaoId,
      totalVotos: await this.getTotalVotos(votacaoId)
    }

    if (tipoVotacao === 'nominal') {
      eventoData.vereador = {
        id: vereadorId,
        nome: vereador.rows[0]?.nome_parlamentar || vereador.rows[0]?.nome,
        partido: vereador.rows[0]?.partido,
        voto
      }
    }

    sseService.broadcast(sessaoId, this.municipioId, SSE_EVENTS.VOTO_REGISTRADO, eventoData)

    // Verifica se todos votaram
    await this.verificarTodosVotaram(votacaoId, sessaoId)

    return true
  }

  /**
   * Encerra a votação e calcula resultado
   */
  async encerrarVotacao(votacaoId: number): Promise<ResultadoVotacao> {
    const votacao = await db.rawQuery(`
      SELECT v.*, s.id as sessao_id
      FROM "${this.schemaName}".votacoes v
      JOIN "${this.schemaName}".sessoes s ON v.sessao_id = s.id
      WHERE v.id = $1
    `, [votacaoId])

    if (votacao.rows.length === 0) {
      throw new Error('Votação não encontrada')
    }

    if (votacao.rows[0].status !== 'em_andamento') {
      throw new Error('Esta votação já foi encerrada')
    }

    const sessaoId = votacao.rows[0].sessao_id

    // Conta votos
    const contagem = await db.rawQuery(`
      SELECT
        COUNT(*) FILTER (WHERE voto = 'sim') as votos_sim,
        COUNT(*) FILTER (WHERE voto = 'nao') as votos_nao,
        COUNT(*) FILTER (WHERE voto = 'abstencao') as votos_abstencao,
        COUNT(*) as total_votos
      FROM "${this.schemaName}".votos
      WHERE votacao_id = $1
    `, [votacaoId])

    const votos = contagem.rows[0]

    // Calcula quórum necessário
    const quorumInfo = await this.calcularQuorum(sessaoId, votacao.rows[0].quorum_tipo)

    // Determina resultado
    const resultado = this.determinarResultado(parseInt(votos.votos_sim), quorumInfo.quorumNecessario)

    // Atualiza votação
    await db.rawQuery(`
      UPDATE "${this.schemaName}".votacoes
      SET status = 'encerrada',
          hora_fim = NOW(),
          votos_sim = $1,
          votos_nao = $2,
          votos_abstencao = $3,
          total_votos = $4,
          resultado = $5,
          updated_at = NOW()
      WHERE id = $6
    `, [
      votos.votos_sim,
      votos.votos_nao,
      votos.votos_abstencao,
      votos.total_votos,
      resultado.aprovado ? 'aprovado' : 'rejeitado',
      votacaoId
    ])

    // Se tiver matéria, atualiza na ordem do dia
    if (votacao.rows[0].materia_id) {
      await db.rawQuery(`
        UPDATE "${this.schemaName}".ordem_dia
        SET situacao = 'votado',
            resultado = $1,
            votos_sim = $2,
            votos_nao = $3,
            votos_abstencao = $4
        WHERE sessao_id = $5 AND materia_id = $6
      `, [
        resultado.aprovado ? 'aprovado' : 'rejeitado',
        votos.votos_sim,
        votos.votos_nao,
        votos.votos_abstencao,
        sessaoId,
        votacao.rows[0].materia_id
      ])
    }

    // Busca votos para broadcast (se nominal)
    let votosDetalhes: any[] = []
    if (votacao.rows[0].tipo === 'nominal') {
      const votosResult = await db.rawQuery(`
        SELECT vo.voto, ve.nome, ve.nome_parlamentar, p.sigla as partido
        FROM "${this.schemaName}".votos vo
        JOIN "${this.schemaName}".vereadores ve ON vo.vereador_id = ve.id
        LEFT JOIN "${this.schemaName}".partidos p ON ve.partido_id = p.id
        WHERE vo.votacao_id = $1
        ORDER BY vo.hora_voto
      `, [votacaoId])
      votosDetalhes = votosResult.rows
    }

    // Broadcast resultado
    sseService.broadcast(sessaoId, this.municipioId, SSE_EVENTS.VOTACAO_ENCERRADA, {
      votacaoId,
      resultado: {
        ...resultado,
        votosSim: parseInt(votos.votos_sim),
        votosNao: parseInt(votos.votos_nao),
        votosAbstencao: parseInt(votos.votos_abstencao),
        totalVotos: parseInt(votos.total_votos),
        quorumNecessario: quorumInfo.quorumNecessario,
        quorumAtingido: quorumInfo.quorumAtingido
      },
      votos: votosDetalhes
    })

    return {
      aprovado: resultado.aprovado,
      votosSim: parseInt(votos.votos_sim),
      votosNao: parseInt(votos.votos_nao),
      votosAbstencao: parseInt(votos.votos_abstencao),
      totalVotos: parseInt(votos.total_votos),
      quorumNecessario: quorumInfo.quorumNecessario,
      quorumAtingido: quorumInfo.quorumAtingido
    }
  }

  /**
   * Calcula quórum baseado no tipo
   */
  private async calcularQuorum(
    sessaoId: number,
    quorumTipo: string
  ): Promise<{ quorumNecessario: number; quorumAtingido: boolean; presentes: number }> {
    // Total de vereadores presentes
    const presentes = await db.rawQuery(`
      SELECT COUNT(*) as total
      FROM "${this.schemaName}".sessao_presencas
      WHERE sessao_id = $1 AND presente = true
    `, [sessaoId])

    const totalPresentes = parseInt(presentes.rows[0].total)

    // Total de vereadores ativos (para maioria absoluta)
    const ativos = await db.rawQuery(`
      SELECT COUNT(*) as total
      FROM "${this.schemaName}".vereadores
      WHERE status = 'ativo'
    `, [])

    const totalAtivos = parseInt(ativos.rows[0].total)

    let quorumNecessario: number

    switch (quorumTipo) {
      case 'maioria_simples':
        // Mais da metade dos presentes
        quorumNecessario = Math.floor(totalPresentes / 2) + 1
        break
      case 'maioria_absoluta':
        // Mais da metade do total de membros
        quorumNecessario = Math.floor(totalAtivos / 2) + 1
        break
      case 'dois_tercos':
        // 2/3 do total de membros
        quorumNecessario = Math.ceil((totalAtivos * 2) / 3)
        break
      case 'unanimidade':
        // Todos os presentes
        quorumNecessario = totalPresentes
        break
      default:
        quorumNecessario = Math.floor(totalPresentes / 2) + 1
    }

    return {
      quorumNecessario,
      quorumAtingido: totalPresentes >= quorumNecessario,
      presentes: totalPresentes
    }
  }

  /**
   * Determina se foi aprovado
   */
  private determinarResultado(
    votosSim: number,
    quorumNecessario: number
  ): { aprovado: boolean } {
    // Verifica se atingiu o quórum mínimo de votos SIM
    return {
      aprovado: votosSim >= quorumNecessario
    }
  }

  /**
   * Atualiza contagem de votos
   */
  private async atualizarContagem(votacaoId: number): Promise<void> {
    await db.rawQuery(`
      UPDATE "${this.schemaName}".votacoes
      SET votos_sim = (SELECT COUNT(*) FROM "${this.schemaName}".votos WHERE votacao_id = $1 AND voto = 'sim'),
          votos_nao = (SELECT COUNT(*) FROM "${this.schemaName}".votos WHERE votacao_id = $1 AND voto = 'nao'),
          votos_abstencao = (SELECT COUNT(*) FROM "${this.schemaName}".votos WHERE votacao_id = $1 AND voto = 'abstencao'),
          total_votos = (SELECT COUNT(*) FROM "${this.schemaName}".votos WHERE votacao_id = $1),
          updated_at = NOW()
      WHERE id = $1
    `, [votacaoId])
  }

  /**
   * Retorna total de votos
   */
  private async getTotalVotos(votacaoId: number): Promise<{ sim: number; nao: number; abstencao: number; total: number }> {
    const result = await db.rawQuery(`
      SELECT
        COUNT(*) FILTER (WHERE voto = 'sim') as sim,
        COUNT(*) FILTER (WHERE voto = 'nao') as nao,
        COUNT(*) FILTER (WHERE voto = 'abstencao') as abstencao,
        COUNT(*) as total
      FROM "${this.schemaName}".votos
      WHERE votacao_id = $1
    `, [votacaoId])

    return {
      sim: parseInt(result.rows[0].sim),
      nao: parseInt(result.rows[0].nao),
      abstencao: parseInt(result.rows[0].abstencao),
      total: parseInt(result.rows[0].total)
    }
  }

  /**
   * Verifica se todos os presentes já votaram
   */
  private async verificarTodosVotaram(votacaoId: number, sessaoId: number): Promise<void> {
    const presentes = await db.rawQuery(`
      SELECT COUNT(*) as total
      FROM "${this.schemaName}".sessao_presencas
      WHERE sessao_id = $1 AND presente = true
    `, [sessaoId])

    const votaram = await db.rawQuery(`
      SELECT COUNT(*) as total
      FROM "${this.schemaName}".votos
      WHERE votacao_id = $1
    `, [votacaoId])

    if (parseInt(votaram.rows[0].total) >= parseInt(presentes.rows[0].total)) {
      // Notifica que todos votaram
      sseService.broadcast(sessaoId, this.municipioId, SSE_EVENTS.VOTACAO_ATUALIZADA, {
        votacaoId,
        todosVotaram: true,
        aguardandoEncerramento: true
      })
    }
  }

  /**
   * Busca detalhes da votação
   */
  async getVotacaoDetalhes(votacaoId: number): Promise<any> {
    const result = await db.rawQuery(`
      SELECT v.*,
        m.numero as materia_numero,
        tm.prefixo as materia_prefixo,
        m.ano as materia_ano,
        m.ementa as materia_ementa
      FROM "${this.schemaName}".votacoes v
      LEFT JOIN "${this.schemaName}".materias m ON v.materia_id = m.id
      LEFT JOIN "${this.schemaName}".tipos_materia tm ON m.tipo_materia_id = tm.id
      WHERE v.id = $1
    `, [votacaoId])

    return result.rows[0]
  }

  /**
   * Busca votação em andamento da sessão
   */
  async getVotacaoEmAndamento(sessaoId: number): Promise<any | null> {
    const result = await db.rawQuery(`
      SELECT v.*,
        m.numero as materia_numero,
        tm.prefixo as materia_prefixo,
        m.ano as materia_ano,
        m.ementa as materia_ementa
      FROM "${this.schemaName}".votacoes v
      LEFT JOIN "${this.schemaName}".materias m ON v.materia_id = m.id
      LEFT JOIN "${this.schemaName}".tipos_materia tm ON m.tipo_materia_id = tm.id
      WHERE v.sessao_id = $1 AND v.status = 'em_andamento'
    `, [sessaoId])

    if (result.rows.length === 0) return null

    // Busca votos (se nominal)
    let votos: any[] = []
    if (result.rows[0].tipo === 'nominal') {
      const votosResult = await db.rawQuery(`
        SELECT vo.voto, vo.vereador_id, ve.nome, ve.nome_parlamentar, p.sigla as partido
        FROM "${this.schemaName}".votos vo
        JOIN "${this.schemaName}".vereadores ve ON vo.vereador_id = ve.id
        LEFT JOIN "${this.schemaName}".partidos p ON ve.partido_id = p.id
        WHERE vo.votacao_id = $1
        ORDER BY vo.hora_voto
      `, [result.rows[0].id])
      votos = votosResult.rows
    }

    return {
      ...result.rows[0],
      votos
    }
  }

  /**
   * Verifica se vereador já votou
   */
  async vereadorJaVotou(votacaoId: number, vereadorId: number): Promise<boolean> {
    const result = await db.rawQuery(`
      SELECT id FROM "${this.schemaName}".votos
      WHERE votacao_id = $1 AND vereador_id = $2
    `, [votacaoId, vereadorId])

    return result.rows.length > 0
  }

  /**
   * Lista vereadores que ainda não votaram
   */
  async getVereadoresAguardando(votacaoId: number, sessaoId: number): Promise<any[]> {
    const result = await db.rawQuery(`
      SELECT ve.id, ve.nome, ve.nome_parlamentar, ve.foto_url, p.sigla as partido
      FROM "${this.schemaName}".sessao_presencas sp
      JOIN "${this.schemaName}".vereadores ve ON sp.vereador_id = ve.id
      LEFT JOIN "${this.schemaName}".partidos p ON ve.partido_id = p.id
      WHERE sp.sessao_id = $1
        AND sp.presente = true
        AND ve.id NOT IN (
          SELECT vereador_id FROM "${this.schemaName}".votos WHERE votacao_id = $2
        )
      ORDER BY ve.nome_parlamentar, ve.nome
    `, [sessaoId, votacaoId])

    return result.rows
  }
}
