/**
 * Serviço para cálculo de horas trabalhadas e processamento de ponto
 *
 * Regras:
 * - Registros são agrupados por dia
 * - Registros alternados são considerados entrada/saída
 * - Tolerância de entrada/saída configurável
 * - Cálculo de atrasos, horas extras e horas faltantes
 */

import { dbManager } from '#services/database_manager_service'
import { DateTime } from 'luxon'

interface RegistroPonto {
  id: number
  funcionario_id: number
  data_hora: Date | string
  tipo: string
  sentido: string | null
  origem: string
}

interface Jornada {
  id: number
  carga_horaria_diaria: number // em minutos
  tolerancia_entrada: number
  tolerancia_saida: number
  // Novos campos para suportar plantão e horário corrido
  tipo: 'NORMAL' | 'PLANTAO' | 'CORRIDA' // NORMAL = seg-sex, PLANTAO = escala, CORRIDA = sem intervalo
  horas_plantao: number | null // Para plantão: horas trabalhadas (12, 24)
  horas_folga: number | null // Para plantão: horas de folga (36, 72)
  tem_intervalo: boolean // Se tem intervalo para refeição
  duracao_intervalo: number // Duração do intervalo em minutos
  marcacoes_dia: number // 2 = entrada/saída, 4 = com intervalo
}

interface JornadaHorario {
  dia_semana: number
  entrada_1: string | null
  saida_1: string | null
  entrada_2: string | null
  saida_2: string | null
  folga: boolean
}

interface DiaTrabalhado {
  data: string
  diaSemana: number
  registros: DateTime[]
  horasPrevistas: number // em minutos
  horasTrabalhadas: number // em minutos
  atraso: number // em minutos
  horaExtra: number // em minutos
  horaFaltante: number // em minutos
  feriado: boolean
  folga: boolean
  falta: boolean
  ocorrencias: string[]
}

interface EspelhoCalculado {
  funcionario_id: number
  mes: number
  ano: number
  dias: DiaTrabalhado[]
  totais: {
    diasUteis: number
    diasTrabalhados: number
    horasPrevistas: number
    horasTrabalhadas: number
    atrasos: number
    horasExtras: number
    horasFaltantes: number
    faltas: number
  }
}

export class CalculoPontoService {
  /**
   * Calcula as horas trabalhadas de um funcionário em um período
   */
  async calcularEspelho(
    municipioId: number,
    funcionarioId: number,
    mes: number,
    ano: number,
    diaFechamentoCustom?: number // Permite passar dia de fechamento customizado
  ): Promise<EspelhoCalculado> {
    // Define período
    const inicioMes = DateTime.local(ano, mes, 1).startOf('day')
    const fimMesOriginal = inicioMes.endOf('month')
    const hoje = DateTime.now().endOf('day') // endOf para incluir registros de hoje
    // Não conta dias futuros - usa o menor entre fim do mês e hoje
    const fimMes = fimMesOriginal < hoje ? fimMesOriginal : hoje

    // Busca configuração de dia de fechamento (padrão: último dia do mês)
    let diaFechamento = diaFechamentoCustom
    if (!diaFechamento) {
      const configFechamento = await dbManager.queryMunicipioOne<{ valor: string }>(
        municipioId,
        `SELECT valor FROM configuracoes WHERE chave = 'dia_fechamento'`,
        []
      )
      diaFechamento = configFechamento ? parseInt(configFechamento.valor) : 0 // 0 = fim do mês
    }

    // Data de fechamento do período atual
    const dataFechamento = diaFechamento > 0 && diaFechamento <= 28
      ? DateTime.local(ano, mes, diaFechamento).endOf('day')
      : fimMesOriginal

    // Busca data de início do sistema da entidade
    const entidade = await dbManager.queryMunicipioOne<{ data_inicio_sistema: Date | null }>(
      municipioId,
      `SELECT data_inicio_sistema FROM public.entidades WHERE municipio_id = $1 LIMIT 1`,
      [municipioId]
    )
    const dataInicioSistema = entidade?.data_inicio_sistema
      ? DateTime.fromJSDate(entidade.data_inicio_sistema, { zone: 'America/Sao_Paulo' }).startOf('day')
      : null
    console.log(`[Espelho] dataInicioSistema=`, dataInicioSistema?.toISODate())

    // Busca funcionário e jornada
    const funcionario = await dbManager.queryMunicipioOne<{
      id: number
      nome: string
      jornada_id: number
      data_admissao: string
      data_demissao: string | null
    }>(
      municipioId,
      `SELECT id, nome, jornada_id, data_admissao, data_demissao
       FROM funcionarios WHERE id = $1`,
      [funcionarioId]
    )

    if (!funcionario) {
      throw new Error('Funcionário não encontrado')
    }

    // Busca jornada com todos os campos
    const jornada = await dbManager.queryMunicipioOne<Jornada>(
      municipioId,
      `SELECT id, carga_horaria_diaria, tolerancia_entrada, tolerancia_saida,
              COALESCE(tipo, 'NORMAL') as tipo,
              horas_plantao, horas_folga,
              COALESCE(tem_intervalo, true) as tem_intervalo,
              COALESCE(duracao_intervalo, 60) as duracao_intervalo,
              COALESCE(marcacoes_dia, 4) as marcacoes_dia
       FROM jornadas WHERE id = $1`,
      [funcionario.jornada_id]
    )

    // Valores padrão se não tiver jornada
    const cargaHorariaDiaria = jornada?.carga_horaria_diaria || 480 // 8h
    const toleranciaEntrada = jornada?.tolerancia_entrada || 10
    const toleranciaSaida = jornada?.tolerancia_saida || 10
    const tipoJornada = jornada?.tipo || 'NORMAL'
    const temIntervalo = jornada?.tem_intervalo ?? true
    const marcacoesDia = jornada?.marcacoes_dia || (temIntervalo ? 4 : 2)

    // Busca horários da jornada por dia da semana
    const horarios = await dbManager.queryMunicipio<JornadaHorario>(
      municipioId,
      `SELECT dia_semana, entrada_1, saida_1, entrada_2, saida_2, folga
       FROM jornada_horarios WHERE jornada_id = $1`,
      [funcionario.jornada_id || 0]
    )

    // Mapa de horários por dia da semana
    const horariosMap = new Map<number, JornadaHorario>()
    horarios.forEach((h) => horariosMap.set(h.dia_semana, h))

    // Busca feriados do período
    const feriados = await dbManager.queryMunicipio<{ data: string }>(
      municipioId,
      `SELECT TO_CHAR(data, 'YYYY-MM-DD') as data FROM feriados
       WHERE data BETWEEN $1 AND $2
       OR (recorrente = true AND EXTRACT(MONTH FROM data) = $3)`,
      [inicioMes.toISODate(), fimMes.toISODate(), mes]
    )
    const feriadosSet = new Set(feriados.map((f) => f.data))

    // Busca folgas programadas do funcionário no período
    const folgasProgramadas = await dbManager.queryMunicipio<{ data: string; tipo: string; motivo: string | null }>(
      municipioId,
      `SELECT TO_CHAR(data, 'YYYY-MM-DD') as data, tipo, motivo FROM folgas_programadas
       WHERE funcionario_id = $1 AND data BETWEEN $2 AND $3`,
      [funcionarioId, inicioMes.toISODate(), fimMes.toISODate()]
    )
    const folgasProgramadasMap = new Map(folgasProgramadas.map((f) => [f.data, f]))

    // Busca registros do período
    const registros = await dbManager.queryMunicipio<RegistroPonto>(
      municipioId,
      `SELECT id, funcionario_id, data_hora, tipo, sentido, origem
       FROM registros_ponto
       WHERE funcionario_id = $1
       AND data_hora >= $2 AND data_hora <= $3
       ORDER BY data_hora`,
      [funcionarioId, inicioMes.toISO(), fimMes.toISO()]
    )

    // Agrupa registros por dia
    const registrosPorDia = CalculoPontoService.agruparRegistrosPorDia(registros)

    // Para jornada tipo PLANTAO, precisamos calcular a escala
    // Ex: 12x36 = trabalha 12h, folga 36h | 24x72 = trabalha 24h, folga 72h
    let escalaPlantao: Map<string, boolean> | null = null
    if (tipoJornada === 'PLANTAO' && jornada?.horas_plantao && jornada?.horas_folga) {
      escalaPlantao = await this.calcularEscalaPlantao(
        municipioId,
        funcionarioId,
        jornada.horas_plantao,
        jornada.horas_folga,
        inicioMes,
        fimMes
      )
    }

    // Processa cada dia do mês
    const dias: DiaTrabalhado[] = []
    let diaAtual = inicioMes

    while (diaAtual <= fimMes) {
      const dataStr = diaAtual.toISODate()!
      const diaSemana = CalculoPontoService.getDiaSemana(diaAtual)

      // Verifica se é anterior à data de início do sistema
      const isAntesDaDataInicio = dataInicioSistema && diaAtual < dataInicioSistema

      // Verifica se é feriado
      const isFeriado = feriadosSet.has(dataStr)

      // Verifica se é folga programada (escala de folgas)
      const folgaProgramada = folgasProgramadasMap.get(dataStr)
      const isFolgaProgramada = !!folgaProgramada

      // Registros do dia (acessando como objeto, não Map)
      const registrosDia = registrosPorDia[dataStr] || []

      // Determina se é dia de trabalho com base no tipo de jornada
      let isDiaTrabalho = false
      let horasPrevistasDia = 0
      const horarioDia = horariosMap.get(diaSemana)

      // Se é anterior à data de início do sistema, não conta como dia de trabalho
      if (isAntesDaDataInicio) {
        dias.push({
          data: dataStr,
          diaSemana,
          registros: [],
          horasPrevistas: 0,
          horasTrabalhadas: 0,
          atraso: 0,
          horaExtra: 0,
          horaFaltante: 0,
          feriado: false,
          folga: true,
          falta: false,
          ocorrencias: ['ANTES DO INÍCIO DO SISTEMA'],
        })
        diaAtual = diaAtual.plus({ days: 1 })
        continue
      }

      if (tipoJornada === 'PLANTAO' && escalaPlantao) {
        // Para plantão, verifica a escala calculada
        isDiaTrabalho = escalaPlantao.get(dataStr) === true && !isFolgaProgramada
        if (isDiaTrabalho) {
          // Horas previstas = horas do plantão (em minutos)
          horasPrevistasDia = (jornada?.horas_plantao || 12) * 60
        }
      } else {
        // Para NORMAL e CORRIDA, verifica configuração da jornada para o dia
        // Só é folga se: não tem horário configurado OU campo folga = true OU folga programada
        const isFolga = !horarioDia || horarioDia.folga === true || isFolgaProgramada
        isDiaTrabalho = !isFolga && !isFeriado
        if (isDiaTrabalho && horarioDia) {
          // Calcula horas previstas baseado nos horários configurados para o dia
          horasPrevistasDia = CalculoPontoService.calcularHorasPrevistasDia(horarioDia)
        } else if (isDiaTrabalho) {
          horasPrevistasDia = cargaHorariaDiaria
        }
      }

      // Se não é dia de trabalho (folga, feriado ou escala de plantão)
      if (!isDiaTrabalho || isFeriado) {
        const horasTrabalhadasDia = CalculoPontoService.calcularHorasTrabalhadas(registrosDia)
        dias.push({
          data: dataStr,
          diaSemana,
          registros: registrosDia,
          horasPrevistas: 0,
          horasTrabalhadas: horasTrabalhadasDia,
          atraso: 0,
          horaExtra: horasTrabalhadasDia, // Trabalho em folga/feriado = hora extra
          horaFaltante: 0,
          feriado: isFeriado,
          folga: !isDiaTrabalho && !isFeriado,
          falta: false,
          ocorrencias: this.gerarOcorrenciasFolga(isFeriado, tipoJornada, horasTrabalhadasDia, folgaProgramada),
        })
      } else {
        // Dia de trabalho
        const horasTrabalhadas = CalculoPontoService.calcularHorasTrabalhadas(registrosDia)

        // Calcula atraso (se entrou depois do horário + tolerância)
        let atraso = 0
        if (horarioDia?.entrada_1 && registrosDia.length > 0) {
          const [h, m] = horarioDia.entrada_1.split(':').map(Number)
          const horarioPrevisto = diaAtual.set({ hour: h, minute: m })
          const primeiroRegistro = registrosDia[0]
          const diffMinutos = primeiroRegistro.diff(horarioPrevisto, 'minutes').minutes

          if (diffMinutos > toleranciaEntrada) {
            atraso = Math.round(diffMinutos - toleranciaEntrada)
          }
        }

        // Calcula horas extras ou faltantes
        let horaExtra = 0
        let horaFaltante = 0
        const diff = horasTrabalhadas - horasPrevistasDia

        if (diff > toleranciaSaida) {
          horaExtra = Math.round(diff - toleranciaSaida)
        } else if (diff < -toleranciaSaida) {
          horaFaltante = Math.abs(Math.round(diff + toleranciaSaida))
        }

        // Verifica falta (nenhum registro no dia de trabalho)
        const isFalta = CalculoPontoService.identificarFalta(registrosDia, false, false)

        // Verifica marcações esperadas baseado na jornada configurada para o dia
        // Se não tem período da tarde, espera só 2 marcações (entrada e saída)
        let marcacoesEsperadas = marcacoesDia
        if (horarioDia && (!horarioDia.entrada_2 || !horarioDia.saida_2)) {
          marcacoesEsperadas = 2 // Só manhã = 2 marcações
        }
        const registrosImpares = registrosDia.length % 2 !== 0
        const marcacoesIncompletas = registrosDia.length > 0 && registrosDia.length < marcacoesEsperadas

        const ocorrencias: string[] = []
        if (isFalta) ocorrencias.push('FALTA')
        if (atraso > 0) ocorrencias.push(`ATRASO ${atraso}min`)
        if (horaExtra > 0) ocorrencias.push(`HORA EXTRA ${CalculoPontoService.minutosParaHHMM(horaExtra)}`)
        if (horaFaltante > 0) ocorrencias.push(`HORA FALTANTE ${CalculoPontoService.minutosParaHHMM(horaFaltante)}`)
        if (registrosImpares) ocorrencias.push('REGISTRO IMPAR')
        if (marcacoesIncompletas && !registrosImpares) {
          ocorrencias.push(`MARCACOES INCOMPLETAS (${registrosDia.length}/${marcacoesEsperadas})`)
        }
        if (tipoJornada === 'PLANTAO') ocorrencias.push('PLANTAO')

        dias.push({
          data: dataStr,
          diaSemana,
          registros: registrosDia,
          horasPrevistas: horasPrevistasDia,
          horasTrabalhadas,
          atraso,
          horaExtra,
          horaFaltante,
          feriado: false,
          folga: false,
          falta: isFalta,
          ocorrencias,
        })
      }

      diaAtual = diaAtual.plus({ days: 1 })
    }

    // Verifica se há turno noturno que cruza o dia de fechamento
    // (entrada no dia do fechamento, saída no dia seguinte)
    // Aplica para qualquer jornada (NORMAL, PLANTAO, CORRIDA)
    let horasParaProximoPeriodo = 0
    let observacoesFechamento: string[] = []

    // Usa dataFechamento (último dia do mês ou dia customizado)
    const resultadoFechamento = await this.calcularHorasTurnoComFechamento(
      municipioId,
      funcionarioId,
      dataFechamento,
      mes,
      ano
    )
    horasParaProximoPeriodo = resultadoFechamento.horasParaProximoPeriodo
    observacoesFechamento = resultadoFechamento.registrosAfetados

    // Se houver horas para o próximo período, adiciona observação no dia do fechamento
    if (horasParaProximoPeriodo > 0) {
      const diaFechamentoStr = dataFechamento.toISODate()
      const diaEncontrado = dias.find(d => d.data === diaFechamentoStr)
      if (diaEncontrado) {
        diaEncontrado.ocorrencias.push(
          `TURNO CRUZA FECHAMENTO: ${CalculoPontoService.minutosParaHHMM(horasParaProximoPeriodo)} para próximo período`
        )
      }
    }

    // Calcula totais
    const horasTrabalhadasBruto = dias.reduce((acc, d) => acc + d.horasTrabalhadas, 0)
    // Subtrai as horas que vão para o próximo período
    const horasTrabalhadasLiquido = horasTrabalhadasBruto - horasParaProximoPeriodo

    const totais = {
      diasUteis: dias.filter((d) => !d.folga && !d.feriado).length,
      diasTrabalhados: dias.filter((d) => d.horasTrabalhadas > 0).length,
      horasPrevistas: dias.reduce((acc, d) => acc + d.horasPrevistas, 0),
      horasTrabalhadas: horasTrabalhadasLiquido, // Já descontando horas do próximo período
      horasTrabalhadasBruto, // Total bruto sem desconto
      horasParaProximoPeriodo, // Horas que vão para o próximo mês
      atrasos: dias.reduce((acc, d) => acc + d.atraso, 0),
      horasExtras: dias.reduce((acc, d) => acc + d.horaExtra, 0),
      horasFaltantes: dias.reduce((acc, d) => acc + d.horaFaltante, 0),
      faltas: dias.filter((d) => d.falta).length,
      observacoesFechamento, // Detalhes dos plantões que cruzaram o fechamento
    }

    return {
      funcionario_id: funcionarioId,
      mes,
      ano,
      dias,
      totais,
    }
  }

  /**
   * Calcula a escala de plantão para um funcionário
   */
  private async calcularEscalaPlantao(
    municipioId: number,
    funcionarioId: number,
    horasTrabalho: number,
    horasFolga: number,
    inicioMes: DateTime,
    fimMes: DateTime
  ): Promise<Map<string, boolean>> {
    const escala = new Map<string, boolean>()

    // Busca o último dia trabalhado antes do início do mês
    const ultimoRegistro = await dbManager.queryMunicipioOne<{ data_hora: string }>(
      municipioId,
      `SELECT data_hora FROM registros_ponto
       WHERE funcionario_id = $1 AND data_hora < $2
       ORDER BY data_hora DESC LIMIT 1`,
      [funcionarioId, inicioMes.toISO()]
    )

    let diaReferencia: DateTime
    if (ultimoRegistro) {
      // data_hora pode ser Date (do PostgreSQL) ou string
      // Usa timezone de São Paulo para garantir data correta
      const dataHora = ultimoRegistro.data_hora
      const zone = 'America/Sao_Paulo'
      diaReferencia = (dataHora instanceof Date
        ? DateTime.fromJSDate(dataHora, { zone })
        : DateTime.fromISO(dataHora, { zone })).startOf('day')
    } else {
      // Se não houver registros, assume o primeiro dia do mês como referência
      diaReferencia = inicioMes
    }

    let diaAtual = diaReferencia
    while (diaAtual <= fimMes) {
      // Dia de trabalho
      escala.set(diaAtual.toISODate()!, true)

      // Avança para o próximo dia de trabalho
      const proximoDiaTrabalho = diaAtual.plus({ hours: horasTrabalho + horasFolga })
      diaAtual = proximoDiaTrabalho.startOf('day')
    }

    return escala
  }

  /**
   * Gera ocorrências para dias de folga/feriado
   */
  private gerarOcorrenciasFolga(
    isFeriado: boolean,
    tipoJornada: string,
    horasTrabalhadas: number,
    folgaProgramada?: { tipo: string; motivo: string | null } | null
  ): string[] {
    const ocorrencias: string[] = []
    if (isFeriado) {
      ocorrencias.push('FERIADO')
    } else if (folgaProgramada) {
      const tipoFolga = folgaProgramada.tipo || 'FOLGA'
      const motivo = folgaProgramada.motivo ? ` - ${folgaProgramada.motivo}` : ''
      ocorrencias.push(`${tipoFolga} PROGRAMADA${motivo}`)
    } else {
      ocorrencias.push('FOLGA')
    }

    if (horasTrabalhadas > 0) {
      ocorrencias.push(`TRABALHO EM FOLGA/FERIADO (${CalculoPontoService.minutosParaHHMM(horasTrabalhadas)})`)
    }
    if (tipoJornada === 'PLANTAO') ocorrencias.push('PLANTAO')

    return ocorrencias
  }

  /**
   * Calcula as horas previstas para um dia baseado nos horários configurados
   * Se não tem horário da tarde configurado, conta apenas a manhã
   */
  public static calcularHorasPrevistasDia(horarioDia: JornadaHorario): number {
    let totalMinutos = 0

    // Período da manhã (entrada_1 e saida_1)
    if (horarioDia.entrada_1 && horarioDia.saida_1) {
      const [h1, m1] = horarioDia.entrada_1.split(':').map(Number)
      const [h2, m2] = horarioDia.saida_1.split(':').map(Number)
      totalMinutos += (h2 * 60 + m2) - (h1 * 60 + m1)
    }

    // Período da tarde (entrada_2 e saida_2) - só conta se estiver configurado
    if (horarioDia.entrada_2 && horarioDia.saida_2) {
      const [h3, m3] = horarioDia.entrada_2.split(':').map(Number)
      const [h4, m4] = horarioDia.saida_2.split(':').map(Number)
      totalMinutos += (h4 * 60 + m4) - (h3 * 60 + m3)
    }

    return totalMinutos
  }

  /**
   * Calcula o total de horas trabalhadas em um dia
   */
  public static calcularHorasTrabalhadas(registros: DateTime[]): number {
    let totalMinutos = 0
    for (let i = 0; i < registros.length; i += 2) {
      if (registros[i + 1]) {
        const diff = registros[i + 1].diff(registros[i], 'minutes').minutes
        totalMinutos += diff
      }
    }
    return Math.round(totalMinutos)
  }

  /**
   * Calcula o atraso em minutos, considerando a tolerância
   */
  public static calcularAtraso(
    horaEntrada: DateTime,
    horaPrevistoEntrada: DateTime,
    tolerancia: number
  ): number {
    const diffMinutos = horaEntrada.diff(horaPrevistoEntrada, 'minutes').minutes
    return diffMinutos > tolerancia ? Math.round(diffMinutos - tolerancia) : 0
  }

  /**
   * Calcula a hora extra em minutos
   */
  public static calcularHoraExtra(horasTrabalhadas: number, horasPrevistas: number): number {
    const diff = horasTrabalhadas - horasPrevistas
    return diff > 0 ? diff : 0
  }

  /**
   * Calcula a hora faltante em minutos
   */
  public static calcularHoraFaltante(horasTrabalhadas: number, horasPrevistas: number): number {
    const diff = horasPrevistas - horasTrabalhadas
    return diff > 0 ? diff : 0
  }

  /**
   * Identifica se o dia foi uma falta
   */
  public static identificarFalta(
    registros: DateTime[],
    ehFolga: boolean,
    ehFeriado: boolean
  ): boolean {
    return registros.length === 0 && !ehFolga && !ehFeriado
  }

  /**
   * Converte minutos para formato HH:MM
   */
  public static minutosParaHHMM(minutos: number): string {
    if (minutos === 0) return '00:00'
    const h = Math.floor(minutos / 60)
      .toString()
      .padStart(2, '0')
    const m = (minutos % 60).toString().padStart(2, '0')
    return `${h}:${m}`
  }

  /**
   * Agrupa registros por dia
   * Usa timezone de São Paulo para garantir que registros noturnos não sejam
   * atribuídos ao dia seguinte
   */
  public static agruparRegistrosPorDia(registros: RegistroPonto[]): Record<string, DateTime[]> {
    const agrupados: Record<string, DateTime[]> = {}
    const zone = 'America/Sao_Paulo'

    for (const registro of registros) {
      // data_hora pode ser Date (do PostgreSQL) ou string (de JSON)
      // Sempre usa timezone de São Paulo para garantir agrupamento correto
      let dt: DateTime
      if (registro.data_hora instanceof Date) {
        dt = DateTime.fromJSDate(registro.data_hora, { zone })
      } else {
        dt = DateTime.fromISO(registro.data_hora as string, { zone })
      }

      const data = dt.toISODate()!
      if (!agrupados[data]) {
        agrupados[data] = []
      }
      agrupados[data].push(dt)
    }
    return agrupados
  }

  /**
   * Obtém o dia da semana (0=Dom, 1=Seg, ...)
   */
  public static getDiaSemana(data: DateTime): number {
    return data.weekday % 7
  }

  /**
   * Verifica se é um dia útil
   */
  public static isDiaUtil(data: DateTime, ehFeriado: boolean): boolean {
    const diaSemana = this.getDiaSemana(data)
    return diaSemana >= 1 && diaSemana <= 5 && !ehFeriado
  }

  /**
   * Processa o período para múltiplos funcionários
   * Calcula espelho de ponto de todos os funcionários do município
   */
  async processarPeriodo(
    municipioId: number,
    mes: number,
    ano: number,
    funcionarioIds?: number[]
  ): Promise<{ processados: number; erros: number; detalhes: any[] }> {
    const { dbManager } = await import('#services/database_manager_service')

    let processados = 0
    let erros = 0
    const detalhes: any[] = []

    try {
      // Busca funcionários ativos do município
      let query = `
        SELECT id, nome FROM funcionarios
        WHERE ativo = true
      `
      const params: any[] = []

      if (funcionarioIds && funcionarioIds.length > 0) {
        query += ` AND id = ANY($1)`
        params.push(funcionarioIds)
      }

      query += ` ORDER BY nome`

      const funcionarios = await dbManager.queryMunicipio(municipioId, query, params)

      // Processa cada funcionário
      for (const func of funcionarios) {
        try {
          const espelho = await this.calcularEspelho(municipioId, func.id, mes, ano)

          // Salva ou atualiza o espelho
          await this.salvarEspelho(municipioId, func.id, mes, ano, espelho)

          processados++
          detalhes.push({
            funcionarioId: func.id,
            nome: func.nome,
            status: 'OK',
            horasTrabalhadas: espelho.totais.horasTrabalhadas
          })
        } catch (err: any) {
          erros++
          console.error(`[Espelho] Erro ao processar funcionário ${func.id} (${func.nome}):`, err.message)
          detalhes.push({
            funcionarioId: func.id,
            nome: func.nome,
            status: 'ERRO',
            erro: err.message
          })
        }
      }

      return { processados, erros, detalhes }
    } catch (err: any) {
      console.error('Erro ao processar período:', err)
      throw err
    }
  }

  /**
   * Salva ou atualiza o espelho de ponto no banco
   */
  private async salvarEspelho(
    municipioId: number,
    funcionarioId: number,
    mes: number,
    ano: number,
    espelho: EspelhoCalculado
  ): Promise<void> {
    const { dbManager } = await import('#services/database_manager_service')

    // Verifica se já existe
    const existe = await dbManager.queryMunicipio(
      municipioId,
      `SELECT id FROM espelhos_ponto WHERE funcionario_id = $1 AND mes = $2 AND ano = $3`,
      [funcionarioId, mes, ano]
    )

    // Prepara dados para salvar (nomes de colunas conforme tabela)
    const diasTrabalhados = espelho.totais.diasTrabalhados
    const horasTrabalhadas = espelho.totais.horasTrabalhadas
    const horasExtras = espelho.totais.horasExtras
    const horasFalta = espelho.totais.horasFaltantes
    const horasFaltantes = espelho.totais.horasFaltantes
    const atrasos = espelho.totais.atrasos
    const faltas = espelho.totais.faltas
    const diasJson = JSON.stringify(espelho.dias)
    // Estrutura de dados completa para o frontend
    const dadosJson = JSON.stringify({
      dias: espelho.dias,
      totais: espelho.totais
    })

    if (existe.length > 0) {
      await dbManager.queryMunicipio(
        municipioId,
        `UPDATE espelhos_ponto SET
          dias_trabalhados = $1,
          horas_trabalhadas = $2,
          horas_extras = $3,
          horas_falta = $4,
          horas_faltantes = $5,
          atrasos = $6,
          faltas = $7,
          dias = $8,
          dados = $9,
          updated_at = NOW()
        WHERE id = $10`,
        [diasTrabalhados, horasTrabalhadas, horasExtras, horasFalta, horasFaltantes, atrasos, faltas, diasJson, dadosJson, existe[0].id]
      )
    } else {
      await dbManager.queryMunicipio(
        municipioId,
        `INSERT INTO espelhos_ponto
          (funcionario_id, mes, ano, dias_trabalhados, horas_trabalhadas, horas_extras,
           horas_falta, horas_faltantes, atrasos, faltas, dias, dados, status, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'ABERTO', NOW(), NOW())`,
        [funcionarioId, mes, ano, diasTrabalhados, horasTrabalhadas, horasExtras, horasFalta, horasFaltantes, atrasos, faltas, diasJson, dadosJson]
      )
    }

    // Contabilização automática do banco de horas
    await this.atualizarBancoHoras(municipioId, funcionarioId, mes, ano, horasExtras, horasFaltantes)
  }

  /**
   * Atualiza o banco de horas automaticamente após processar o espelho
   */
  private async atualizarBancoHoras(
    municipioId: number,
    funcionarioId: number,
    mes: number,
    ano: number,
    horasExtras: number,
    horasFaltantes: number
  ): Promise<void> {
    const { dbManager } = await import('#services/database_manager_service')

    try {
      // Verifica se banco de horas está ativo
      const configResult = await dbManager.queryMunicipio<{ ativo: boolean }>(
        municipioId,
        `SELECT ativo FROM banco_horas_config WHERE id = 1`
      )
      
      if (!configResult.length || configResult[0].ativo === false) {
        return // Banco de horas desativado
      }

      const dataReferencia = `${ano}-${String(mes).padStart(2, '0')}-01`
      const descricaoMes = `Espelho ${String(mes).padStart(2, '0')}/${ano}`

      // Remove registros anteriores do mesmo período (para recalcular)
      await dbManager.queryMunicipio(
        municipioId,
        `DELETE FROM banco_horas 
         WHERE funcionario_id = $1 
         AND data = $2 
         AND origem = 'ESPELHO'`,
        [funcionarioId, dataReferencia]
      )

      // Busca saldo atual (antes das novas operações)
      const saldoResult = await dbManager.queryMunicipio<{ saldo: number }>(
        municipioId,
        `SELECT COALESCE(SUM(
            CASE 
                WHEN tipo_operacao = 'CREDITO' THEN minutos
                WHEN tipo_operacao IN ('DEBITO', 'COMPENSACAO', 'PAGAMENTO') THEN -ABS(minutos)
                ELSE minutos
            END
        ), 0) as saldo
        FROM banco_horas
        WHERE funcionario_id = $1`,
        [funcionarioId]
      )
      let saldoAtual = saldoResult.length > 0 ? saldoResult[0].saldo : 0

      // Registra horas extras como crédito (se houver)
      if (horasExtras > 0) {
        const novoSaldo = saldoAtual + horasExtras
        await dbManager.queryMunicipio(
          municipioId,
          `INSERT INTO banco_horas
            (funcionario_id, data, tipo_operacao, minutos, saldo_anterior, saldo_atual, origem, descricao, aprovado, created_at)
           VALUES ($1, $2, 'CREDITO', $3, $4, $5, 'ESPELHO', $6, true, NOW())`,
          [funcionarioId, dataReferencia, horasExtras, saldoAtual, novoSaldo, `Horas extras - ${descricaoMes}`]
        )
        saldoAtual = novoSaldo
      }

      // Registra horas faltantes como débito (se houver)
      if (horasFaltantes > 0) {
        const novoSaldo = saldoAtual - horasFaltantes
        await dbManager.queryMunicipio(
          municipioId,
          `INSERT INTO banco_horas
            (funcionario_id, data, tipo_operacao, minutos, saldo_anterior, saldo_atual, origem, descricao, aprovado, created_at)
           VALUES ($1, $2, 'DEBITO', $3, $4, $5, 'ESPELHO', $6, true, NOW())`,
          [funcionarioId, dataReferencia, horasFaltantes, saldoAtual, novoSaldo, `Horas faltantes - ${descricaoMes}`]
        )
      }

      console.log(`[Banco de Horas] Atualizado func=${funcionarioId} mes=${mes}/${ano} extras=${horasExtras}min faltantes=${horasFaltantes}min`)
    } catch (error: any) {
      console.error('[Banco de Horas] Erro ao atualizar:', error.message)
      // Não propaga o erro para não quebrar o processamento do espelho
    }
  }

  /**
   * Calcula horas trabalhadas considerando plantões que cruzam o fechamento
   *
   * Se um plantão começa antes do fechamento e termina depois:
   * - Horas até 23:59:59 do dia do fechamento = período atual
   * - Horas de 00:00:00 em diante = próximo período
   *
   * @param registros Array de registros de entrada/saída (DateTime)
   * @param dataFechamento Data limite do período
   * @returns { horasPeriodoAtual: number, horasProximoPeriodo: number }
   */
  public static calcularHorasComFechamento(
    registros: DateTime[],
    dataFechamento: DateTime
  ): { horasPeriodoAtual: number; horasProximoPeriodo: number } {
    let horasPeriodoAtual = 0
    let horasProximoPeriodo = 0

    for (let i = 0; i < registros.length; i += 2) {
      const entrada = registros[i]
      const saida = registros[i + 1]

      if (!saida) continue

      // Verifica se o plantão cruza o fechamento
      const fimDiaFechamento = dataFechamento.endOf('day')
      const inicioDiaAposFechamento = dataFechamento.plus({ days: 1 }).startOf('day')

      if (entrada <= fimDiaFechamento && saida > fimDiaFechamento) {
        // Plantão cruza o fechamento - divide as horas
        // Horas até a meia-noite do dia do fechamento
        const minutosAteFechamento = fimDiaFechamento.diff(entrada, 'minutes').minutes
        horasPeriodoAtual += Math.max(0, Math.round(minutosAteFechamento))

        // Horas do dia seguinte em diante
        const minutosAposFechamento = saida.diff(inicioDiaAposFechamento, 'minutes').minutes
        horasProximoPeriodo += Math.max(0, Math.round(minutosAposFechamento))
      } else if (entrada <= fimDiaFechamento && saida <= fimDiaFechamento) {
        // Plantão totalmente dentro do período atual
        const minutos = saida.diff(entrada, 'minutes').minutes
        horasPeriodoAtual += Math.round(minutos)
      } else {
        // Plantão totalmente no próximo período
        const minutos = saida.diff(entrada, 'minutes').minutes
        horasProximoPeriodo += Math.round(minutos)
      }
    }

    return { horasPeriodoAtual, horasProximoPeriodo }
  }

  /**
   * Busca os plantões de um funcionário para integrar no cálculo
   * Considera plantões cadastrados no sistema de plantões
   */
  async buscarPlantoesDoFuncionario(
    municipioId: number,
    funcionarioId: number,
    dataInicio: DateTime,
    dataFim: DateTime
  ): Promise<Array<{
    data: string
    turno: string
    horario_inicio: string
    horario_fim: string
    status: string
  }>> {
    const { dbManager } = await import('#services/database_manager_service')

    try {
      const plantoes = await dbManager.queryMunicipio<any>(
        municipioId,
        `SELECT
          p.data::text,
          p.turno,
          p.status,
          sl.horario_inicio::text,
          sl.horario_fim::text
         FROM plantoes p
         JOIN escalas_plantao ep ON p.escala_id = ep.id
         JOIN setores_lotacao sl ON ep.setor_lotacao_id = sl.id
         WHERE p.funcionario_id = $1
         AND p.data BETWEEN $2 AND $3
         AND p.status IN ('CONFIRMADO', 'TROCADO')
         ORDER BY p.data`,
        [funcionarioId, dataInicio.toISODate(), dataFim.toISODate()]
      )
      return plantoes
    } catch {
      // Tabela pode não existir ainda
      return []
    }
  }

  /**
   * Verifica se há turno noturno que cruza o dia de fechamento
   * e retorna as horas divididas entre os períodos
   * Funciona para qualquer tipo de jornada (NORMAL, PLANTAO, CORRIDA)
   */
  async calcularHorasTurnoComFechamento(
    municipioId: number,
    funcionarioId: number,
    dataFechamento: DateTime,
    mes: number,
    ano: number
  ): Promise<{ horasParaProximoPeriodo: number; registrosAfetados: string[] }> {
    const { dbManager } = await import('#services/database_manager_service')

    // Busca registros do dia do fechamento
    const registros = await dbManager.queryMunicipio<{
      data_hora: string
      sentido: string
    }>(
      municipioId,
      `SELECT data_hora, sentido FROM registros_ponto
       WHERE funcionario_id = $1
       AND data_hora::date = $2
       ORDER BY data_hora`,
      [funcionarioId, dataFechamento.toISODate()]
    )

    if (registros.length === 0) {
      return { horasParaProximoPeriodo: 0, registrosAfetados: [] }
    }

    // Busca o próximo registro (saída do dia seguinte)
    const diaApos = dataFechamento.plus({ days: 1 })
    const registrosSaida = await dbManager.queryMunicipio<{
      data_hora: string
      sentido: string
    }>(
      municipioId,
      `SELECT data_hora, sentido FROM registros_ponto
       WHERE funcionario_id = $1
       AND data_hora::date = $2
       AND data_hora < $3
       ORDER BY data_hora`,
      [funcionarioId, diaApos.toISODate(), diaApos.set({ hour: 12 }).toISO()]
    )

    let horasParaProximoPeriodo = 0
    const registrosAfetados: string[] = []

    // Verifica se há entrada no dia do fechamento com saída no dia seguinte
    const ultimaEntrada = registros.filter(r => r.sentido === 'E' || registros.indexOf(r) % 2 === 0).pop()
    const primeiraSaida = registrosSaida[0]

    if (ultimaEntrada && primeiraSaida) {
      // data_hora pode ser Date (do PostgreSQL) ou string
      // Usa timezone de São Paulo para garantir data correta
      const zone = 'America/Sao_Paulo'
      const dtEntrada = ultimaEntrada.data_hora instanceof Date
        ? DateTime.fromJSDate(ultimaEntrada.data_hora, { zone })
        : DateTime.fromISO(ultimaEntrada.data_hora, { zone })
      const dtSaida = primeiraSaida.data_hora instanceof Date
        ? DateTime.fromJSDate(primeiraSaida.data_hora, { zone })
        : DateTime.fromISO(primeiraSaida.data_hora, { zone })

      // Se a entrada é no dia do fechamento e a saída é no dia seguinte
      if (dtEntrada.toISODate() === dataFechamento.toISODate() &&
          dtSaida.toISODate() === diaApos.toISODate()) {

        // Horas que devem ir para o próximo período (00:00 até a saída)
        const inicioDia = diaApos.startOf('day')
        horasParaProximoPeriodo = Math.round(dtSaida.diff(inicioDia, 'minutes').minutes)
        registrosAfetados.push(
          `Turno ${dtEntrada.toFormat('dd/MM HH:mm')} - ${dtSaida.toFormat('dd/MM HH:mm')}: ` +
          `${CalculoPontoService.minutosParaHHMM(horasParaProximoPeriodo)} vão para o próximo período`
        )
      }
    }

    return { horasParaProximoPeriodo, registrosAfetados }
  }
}

// Exporta uma instância para uso direto
export const calculoPontoService = new CalculoPontoService()
