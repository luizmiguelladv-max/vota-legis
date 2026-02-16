import DatabaseManagerService from '#services/database_manager_service'
import { DateTime } from 'luxon'

/**
 * Interface para registro de ponto no formato AFD
 */
interface RegistroPontoAFD {
  nsr: number
  tipo_registro: number
  data_hora: Date
  pis: string
  funcionario_nome?: string
}

/**
 * Interface para funcionário
 */
interface Funcionario {
  id: number
  matricula: string
  cpf: string
  pis: string
  nome: string
  cargo_nome?: string
  lotacao_nome?: string
  jornada_nome?: string
}

/**
 * Interface para dados do empregador
 */
interface DadosEmpregador {
  tipo_identificador: number // 1=CNPJ, 2=CPF
  identificador: string // CNPJ ou CPF (14 ou 11 dígitos)
  cei: string // CEI/CAEPF (12 dígitos, zeros se não tiver)
  razao_social: string
  local: string
}

/**
 * Interface para dados do REP
 */
interface DadosREP {
  numero_fabricacao: string
  tipo: string // REP-C, REP-A, REP-P
  marca: string
  modelo: string
}

/**
 * Serviço de Relatórios
 * Gera relatórios AFD, AEJ e outros conforme Portaria 671/2021
 */
export default class RelatorioService {
  /**
   * Gera arquivo AFD (Arquivo Fonte de Dados) conforme Portaria 671
   * Formato texto com registros de largura fixa
   */
  static async gerarAFD(
    municipioId: number,
    dataInicio: Date,
    dataFim: Date,
    empregador: DadosEmpregador,
    rep?: DadosREP
  ): Promise<string> {
    const linhas: string[] = []

    // ===== REGISTRO TIPO 1 - CABEÇALHO =====
    // Posição 1: Tipo de registro (1)
    // Posição 2: Tipo do identificador do empregador (1=CNPJ, 2=CPF)
    // Posição 3-16: CNPJ/CPF do empregador (14 dígitos, zeros à esquerda)
    // Posição 17-28: CEI do empregador (12 dígitos, zeros se não tiver)
    // Posição 29-178: Razão social (150 caracteres)
    // Posição 179-195: Número de fabricação do REP (17 caracteres)
    // Posição 196-203: Data inicial (DDMMAAAA)
    // Posição 204-211: Data final (DDMMAAAA)
    // Posição 212-223: Data e hora geração (DDMMAAAAhhmm)
    // Total: 223 caracteres

    const dataInicioFormatada = DateTime.fromJSDate(dataInicio).toFormat('ddMMyyyy')
    const dataFimFormatada = DateTime.fromJSDate(dataFim).toFormat('ddMMyyyy')
    const dataHoraGeracao = DateTime.now().toFormat('ddMMyyyyHHmm')

    const cabecalho =
      '1' + // Tipo registro
      empregador.tipo_identificador.toString() + // Tipo identificador
      empregador.identificador.padStart(14, '0') + // CNPJ/CPF
      empregador.cei.padStart(12, '0') + // CEI
      empregador.razao_social.substring(0, 150).padEnd(150, ' ') + // Razão social
      (rep?.numero_fabricacao || '').padStart(17, '0') + // Número fabricação REP
      dataInicioFormatada + // Data inicial
      dataFimFormatada + // Data final
      dataHoraGeracao // Data/hora geração

    linhas.push(cabecalho)

    // ===== REGISTRO TIPO 2 - INCLUSÃO/ALTERAÇÃO DE EMPREGADO =====
    // Não obrigatório, mas útil para identificação
    // Por hora vamos pular este tipo

    // ===== REGISTRO TIPO 3 - MARCAÇÃO DE PONTO =====
    // Posição 1: Tipo de registro (3)
    // Posição 2-10: NSR (9 dígitos)
    // Posição 11-22: Data e hora marcação (DDMMAAAAhhmm)
    // Posição 23-34: PIS do empregado (12 dígitos)
    // Total: 34 caracteres

    const registros = await this.buscarRegistrosPonto(municipioId, dataInicio, dataFim)

    for (const registro of registros) {
      const dataHoraMarcacao = DateTime.fromJSDate(registro.data_hora).toFormat('ddMMyyyyHHmm')

      const linha =
        '3' + // Tipo registro
        registro.nsr.toString().padStart(9, '0') + // NSR
        dataHoraMarcacao + // Data/hora marcação
        registro.pis.replace(/\D/g, '').padStart(12, '0') // PIS

      linhas.push(linha)
    }

    // ===== REGISTRO TIPO 9 - TRAILER =====
    // Posição 1: Tipo de registro (9)
    // Posição 2-10: Quantidade de registros tipo 2 (9 dígitos)
    // Posição 11-19: Quantidade de registros tipo 3 (9 dígitos)
    // Posição 20-28: Quantidade de registros tipo 4 (9 dígitos)
    // Posição 29-37: Quantidade de registros tipo 5 (9 dígitos)
    // Total: 37 caracteres

    const trailer =
      '9' +
      '0'.padStart(9, '0') + // Tipo 2
      registros.length.toString().padStart(9, '0') + // Tipo 3 (marcações)
      '0'.padStart(9, '0') + // Tipo 4
      '0'.padStart(9, '0') // Tipo 5

    linhas.push(trailer)

    return linhas.join('\r\n')
  }

  /**
   * Gera arquivo AEJ (Arquivo Eletrônico de Jornada) conforme Portaria 671
   */
  static async gerarAEJ(
    municipioId: number,
    dataInicio: Date,
    dataFim: Date,
    empregador: DadosEmpregador
  ): Promise<string> {
    const linhas: string[] = []

    // ===== REGISTRO TIPO 1 - CABEÇALHO =====
    // Posição 1: Tipo de registro (1)
    // Posição 2: Tipo do identificador (1=CNPJ, 2=CPF)
    // Posição 3-16: CNPJ/CPF (14 dígitos)
    // Posição 17-166: Razão social (150 caracteres)
    // Posição 167-174: Data inicial (DDMMAAAA)
    // Posição 175-182: Data final (DDMMAAAA)
    // Posição 183-194: Data/hora geração (DDMMAAAAhhmm)
    // Total: 194 caracteres

    const dataInicioFormatada = DateTime.fromJSDate(dataInicio).toFormat('ddMMyyyy')
    const dataFimFormatada = DateTime.fromJSDate(dataFim).toFormat('ddMMyyyy')
    const dataHoraGeracao = DateTime.now().toFormat('ddMMyyyyHHmm')

    const cabecalho =
      '1' +
      empregador.tipo_identificador.toString() +
      empregador.identificador.padStart(14, '0') +
      empregador.razao_social.substring(0, 150).padEnd(150, ' ') +
      dataInicioFormatada +
      dataFimFormatada +
      dataHoraGeracao

    linhas.push(cabecalho)

    // ===== REGISTRO TIPO 2 - IDENTIFICAÇÃO DO TRABALHADOR =====
    // Posição 1: Tipo de registro (2)
    // Posição 2-12: CPF do trabalhador (11 dígitos)
    // Posição 13-24: PIS do trabalhador (12 dígitos)
    // Posição 25-76: Nome do trabalhador (52 caracteres)
    // Total: 76 caracteres

    const funcionarios = await this.buscarFuncionarios(municipioId)

    for (const func of funcionarios) {
      const linhaFunc =
        '2' +
        func.cpf.replace(/\D/g, '').padStart(11, '0') +
        func.pis.replace(/\D/g, '').padStart(12, '0') +
        func.nome.substring(0, 52).padEnd(52, ' ')

      linhas.push(linhaFunc)

      // ===== REGISTRO TIPO 3 - MARCAÇÕES DO DIA =====
      // Posição 1: Tipo de registro (3)
      // Posição 2-9: Data (DDMMAAAA)
      // Posição 10-13: Marcação 1 (hhmm) ou espaços
      // Posição 14-17: Marcação 2 (hhmm) ou espaços
      // ... até 16 marcações (posição 70-73)
      // Total: 73 caracteres

      const registrosPorDia = await this.buscarRegistrosPorFuncionarioDia(
        municipioId,
        func.id,
        dataInicio,
        dataFim
      )

      for (const [data, marcacoes] of Object.entries(registrosPorDia)) {
        const dataFormatada = DateTime.fromISO(data).toFormat('ddMMyyyy')

        // Formata até 16 marcações
        let marcacoesStr = ''
        for (let i = 0; i < 16; i++) {
          if (marcacoes[i]) {
            marcacoesStr += DateTime.fromJSDate(marcacoes[i]).toFormat('HHmm')
          } else {
            marcacoesStr += '    ' // 4 espaços para marcação vazia
          }
        }

        const linhaDia = '3' + dataFormatada + marcacoesStr

        linhas.push(linhaDia)
      }
    }

    // ===== REGISTRO TIPO 9 - TRAILER =====
    // Posição 1: Tipo de registro (9)
    // Posição 2-10: Quantidade de registros tipo 2 (9 dígitos)
    // Posição 11-19: Quantidade de registros tipo 3 (9 dígitos)
    // Total: 19 caracteres

    const qtdTipo2 = funcionarios.length
    const qtdTipo3 = linhas.filter((l) => l.startsWith('3')).length

    const trailer =
      '9' + qtdTipo2.toString().padStart(9, '0') + qtdTipo3.toString().padStart(9, '0')

    linhas.push(trailer)

    return linhas.join('\r\n')
  }

  /**
   * Busca registros de ponto no período
   */
  private static async buscarRegistrosPonto(
    municipioId: number,
    dataInicio: Date,
    dataFim: Date
  ): Promise<RegistroPontoAFD[]> {
    const query = `
      SELECT
        rp.nsr,
        3 as tipo_registro,
        rp.data_hora,
        f.pis,
        f.nome as funcionario_nome
      FROM registros_ponto rp
      JOIN funcionarios f ON f.id = rp.funcionario_id
      WHERE rp.data_hora >= $1
        AND rp.data_hora <= $2
        AND f.pis IS NOT NULL
      ORDER BY rp.nsr ASC
    `

    const result = await DatabaseManagerService.queryMunicipio(municipioId, query, [
      dataInicio,
      dataFim,
    ])

    return result.rows.map((row: any) => ({
      nsr: row.nsr || 0,
      tipo_registro: row.tipo_registro,
      data_hora: row.data_hora,
      pis: row.pis || '',
      funcionario_nome: row.funcionario_nome,
    }))
  }

  /**
   * Busca funcionários ativos
   */
  private static async buscarFuncionarios(municipioId: number): Promise<Funcionario[]> {
    const query = `
      SELECT
        f.id,
        f.matricula,
        f.cpf,
        f.pis,
        f.nome,
        c.nome as cargo_nome,
        l.nome as lotacao_nome,
        j.nome as jornada_nome
      FROM funcionarios f
      LEFT JOIN cargos c ON c.id = f.cargo_id
      LEFT JOIN lotacoes l ON l.id = f.lotacao_id
      LEFT JOIN jornadas j ON j.id = f.jornada_id
      WHERE f.ativo = true
        AND f.pis IS NOT NULL
      ORDER BY f.nome ASC
    `

    const result = await DatabaseManagerService.queryMunicipio(municipioId, query)

    return result.rows.map((row: any) => ({
      id: row.id,
      matricula: row.matricula || '',
      cpf: row.cpf || '',
      pis: row.pis || '',
      nome: row.nome || '',
      cargo_nome: row.cargo_nome,
      lotacao_nome: row.lotacao_nome,
      jornada_nome: row.jornada_nome,
    }))
  }

  /**
   * Busca registros de ponto agrupados por dia para um funcionário
   */
  private static async buscarRegistrosPorFuncionarioDia(
    municipioId: number,
    funcionarioId: number,
    dataInicio: Date,
    dataFim: Date
  ): Promise<Record<string, Date[]>> {
    const query = `
      SELECT
        DATE(data_hora) as data,
        data_hora
      FROM registros_ponto
      WHERE funcionario_id = $1
        AND data_hora >= $2
        AND data_hora <= $3
      ORDER BY data_hora ASC
    `

    const result = await DatabaseManagerService.queryMunicipio(municipioId, query, [
      funcionarioId,
      dataInicio,
      dataFim,
    ])

    const porDia: Record<string, Date[]> = {}

    for (const row of result.rows) {
      const dataKey = DateTime.fromJSDate(row.data).toISODate()!
      if (!porDia[dataKey]) {
        porDia[dataKey] = []
      }
      porDia[dataKey].push(row.data_hora)
    }

    return porDia
  }

  /**
   * Gera nome do arquivo AFD conforme padrão
   */
  static gerarNomeArquivoAFD(cnpj: string, dataInicio: Date, dataFim: Date): string {
    const cnpjLimpo = cnpj.replace(/\D/g, '')
    const inicio = DateTime.fromJSDate(dataInicio).toFormat('yyyyMMdd')
    const fim = DateTime.fromJSDate(dataFim).toFormat('yyyyMMdd')
    return `AFD_${cnpjLimpo}_${inicio}_${fim}.txt`
  }

  /**
   * Gera nome do arquivo AEJ conforme padrão
   */
  static gerarNomeArquivoAEJ(cnpj: string, dataInicio: Date, dataFim: Date): string {
    const cnpjLimpo = cnpj.replace(/\D/g, '')
    const inicio = DateTime.fromJSDate(dataInicio).toFormat('yyyyMMdd')
    const fim = DateTime.fromJSDate(dataFim).toFormat('yyyyMMdd')
    return `AEJ_${cnpjLimpo}_${inicio}_${fim}.txt`
  }

  /**
   * Gera relatório de frequência
   */
  static async gerarFrequencia(
    municipioId: number,
    mes: number,
    ano: number,
    funcionarioId?: number,
    lotacaoId?: number
  ): Promise<{
    funcionarios: FrequenciaFuncionario[]
    resumo: ResumoFrequencia
    periodo: { mes: number; ano: number; mesNome: string }
  }> {
    const dataInicio = DateTime.local(ano, mes, 1).startOf('month')
    const dataFim = dataInicio.endOf('month')
    const mesNome = dataInicio.setLocale('pt-BR').toFormat('MMMM/yyyy')

    // Busca funcionários
    let queryFunc = `
      SELECT f.id, f.matricula, f.nome, f.cpf,
             c.nome as cargo_nome,
             l.nome as lotacao_nome,
             j.carga_horaria_diaria,
             j.horario_entrada,
             COALESCE(j.tolerancia_entrada, 10) as tolerancia_entrada
      FROM funcionarios f
      LEFT JOIN cargos c ON c.id = f.cargo_id
      LEFT JOIN lotacoes l ON l.id = f.lotacao_id
      LEFT JOIN jornadas j ON j.id = f.jornada_id
      WHERE f.ativo = true
    `
    const params: any[] = []

    if (funcionarioId) {
      params.push(funcionarioId)
      queryFunc += ` AND f.id = $${params.length}`
    }
    if (lotacaoId) {
      params.push(lotacaoId)
      queryFunc += ` AND f.lotacao_id = $${params.length}`
    }
    queryFunc += ` ORDER BY f.nome`

    const funcionariosResult = await DatabaseManagerService.queryMunicipio(municipioId, queryFunc, params)

    // Busca feriados do período
    const feriadosQuery = `
      SELECT data FROM feriados
      WHERE data >= $1 AND data <= $2 AND ativo = true
    `
    const feriadosResult = await DatabaseManagerService.queryMunicipio(municipioId, feriadosQuery, [
      dataInicio.toJSDate(),
      dataFim.toJSDate(),
    ])
    const feriados = new Set(feriadosResult.rows.map((r: any) => DateTime.fromJSDate(r.data).toISODate()))

    // Calcula dias úteis do mês
    let diasUteisMes = 0
    let dataAtual = dataInicio
    while (dataAtual <= dataFim) {
      const ehFimDeSemana = dataAtual.weekday === 6 || dataAtual.weekday === 7
      const ehFeriado = feriados.has(dataAtual.toISODate()!)
      if (!ehFimDeSemana && !ehFeriado) diasUteisMes++
      dataAtual = dataAtual.plus({ days: 1 })
    }

    const funcionarios: FrequenciaFuncionario[] = []
    let totalPresencas = 0
    let totalFaltas = 0
    let totalAtrasos = 0
    let totalHorasTrabalhadas = 0
    let totalHorasExtras = 0

    // OTIMIZACAO: Busca todos os pontos de uma vez (evita N+1 queries)
    const funcionarioIds = funcionariosResult.rows.map((f: any) => f.id)
    if (funcionarioIds.length === 0) {
      return {
        funcionarios: [],
        resumo: { totalFuncionarios: 0, totalPresencas: 0, totalFaltas: 0, totalAtrasos: 0, mediaPresenca: 0, diasUteis: diasUteisMes, totalHorasTrabalhadas: 0, totalHorasExtras: 0 },
        periodo: { mes, ano, mesNome }
      }
    }

    // Batch query para pontos de todos os funcionarios
    const pontosQuery = `
      SELECT funcionario_id, DATE(data_hora) as data, COUNT(*) as total_marcacoes,
             MIN(data_hora) as primeira_entrada
      FROM registros_ponto
      WHERE funcionario_id = ANY($1)
        AND data_hora >= $2
        AND data_hora <= $3
      GROUP BY funcionario_id, DATE(data_hora)
    `
    const pontosBatch = await DatabaseManagerService.queryMunicipio(municipioId, pontosQuery, [
      funcionarioIds,
      dataInicio.toJSDate(),
      dataFim.toJSDate(),
    ])

    // Indexa pontos por funcionario
    const pontosPorFuncionario = new Map<number, Map<string, any>>()
    for (const ponto of pontosBatch.rows) {
      if (!pontosPorFuncionario.has(ponto.funcionario_id)) {
        pontosPorFuncionario.set(ponto.funcionario_id, new Map())
      }
      const dataStr = DateTime.fromJSDate(ponto.data).toISODate()!
      pontosPorFuncionario.get(ponto.funcionario_id)!.set(dataStr, ponto)
    }

    // Batch query para ocorrencias de todos os funcionarios
    const ocorrenciasQuery = `
      SELECT o.funcionario_id, o.data_inicio, o.data_fim, t.abona
      FROM ocorrencias o
      JOIN tipos_ocorrencia t ON t.id = o.tipo_ocorrencia_id
      WHERE o.funcionario_id = ANY($1)
        AND o.data_inicio <= $2
        AND o.data_fim >= $3
    `
    const ocorrenciasBatch = await DatabaseManagerService.queryMunicipio(municipioId, ocorrenciasQuery, [
      funcionarioIds,
      dataFim.toJSDate(),
      dataInicio.toJSDate(),
    ])

    // Indexa ocorrencias por funcionario
    const ocorrenciasPorFuncionario = new Map<number, any[]>()
    for (const oc of ocorrenciasBatch.rows) {
      if (!ocorrenciasPorFuncionario.has(oc.funcionario_id)) {
        ocorrenciasPorFuncionario.set(oc.funcionario_id, [])
      }
      ocorrenciasPorFuncionario.get(oc.funcionario_id)!.push(oc)
    }

    // Batch query para horas trabalhadas (usando espelho ou estimativa)
    const horasBatchQuery = `
      SELECT funcionario_id,
             COALESCE(SUM(horas_trabalhadas), 0) / 60.0 as horas
      FROM espelhos_ponto
      WHERE funcionario_id = ANY($1)
        AND mes = $2 AND ano = $3
      GROUP BY funcionario_id
    `
    const horasBatch = await DatabaseManagerService.queryMunicipio(municipioId, horasBatchQuery, [
      funcionarioIds, mes, ano
    ])

    // Indexa horas por funcionario
    const horasPorFuncionario = new Map<number, number>()
    for (const h of horasBatch.rows) {
      horasPorFuncionario.set(h.funcionario_id, Number(h.horas) || 0)
    }

    for (const func of funcionariosResult.rows) {
      // Usa dados do batch em vez de queries individuais
      const pontosMap = pontosPorFuncionario.get(func.id) || new Map()
      const ocorrencias = ocorrenciasPorFuncionario.get(func.id) || []

      // Conta dias abonados
      let diasAbonados = 0
      for (const oc of ocorrencias) {
        if (oc.abona) {
          let d = DateTime.fromJSDate(oc.data_inicio)
          const fim = DateTime.fromJSDate(oc.data_fim)
          while (d <= fim && d <= dataFim) {
            if (d >= dataInicio) {
              const ehFimDeSemana = d.weekday === 6 || d.weekday === 7
              const ehFeriado = feriados.has(d.toISODate()!)
              if (!ehFimDeSemana && !ehFeriado) diasAbonados++
            }
            d = d.plus({ days: 1 })
          }
        }
      }

      const diasComMarcacao = new Set(pontosMap.keys())

      // Calcula presenças e faltas
      let presencas = 0
      let faltas = 0
      dataAtual = dataInicio

      while (dataAtual <= dataFim) {
        const ehFimDeSemana = dataAtual.weekday === 6 || dataAtual.weekday === 7
        const ehFeriado = feriados.has(dataAtual.toISODate()!)

        if (!ehFimDeSemana && !ehFeriado) {
          if (diasComMarcacao.has(dataAtual.toISODate()!)) {
            presencas++
          } else {
            faltas++
          }
        }
        dataAtual = dataAtual.plus({ days: 1 })
      }

      // Desconta dias abonados das faltas
      faltas = Math.max(0, faltas - diasAbonados)

      // Calcula atrasos baseado na jornada (usando dados do batch)
      let atrasosFuncionario = 0
      if (func.horario_entrada) {
        const [horaEntrada, minutoEntrada] = func.horario_entrada.split(':').map(Number)
        const tolerancia = func.tolerancia_entrada || 10

        // Usa primeira_entrada do batch query
        for (const [dataStr, ponto] of pontosMap.entries()) {
          const dataMarcacao = DateTime.fromISO(dataStr)
          const ehFimDeSemana = dataMarcacao.weekday === 6 || dataMarcacao.weekday === 7
          const ehFeriado = feriados.has(dataStr)

          if (!ehFimDeSemana && !ehFeriado && ponto.primeira_entrada) {
            const primeiraMarcacao = DateTime.fromJSDate(ponto.primeira_entrada)
            const horarioEsperado = dataMarcacao.set({
              hour: horaEntrada,
              minute: minutoEntrada,
              second: 0,
            })
            const horarioComTolerancia = horarioEsperado.plus({ minutes: tolerancia })

            if (primeiraMarcacao > horarioComTolerancia) {
              atrasosFuncionario++
            }
          }
        }
      }

      // Calcula horas trabalhadas baseado no espelho (usando batch query)
      const cargaHorariaDiaria = func.carga_horaria_diaria || 480 // minutos
      const horasPrevistas = (diasUteisMes * cargaHorariaDiaria) / 60
      const horasTrabalhadas = Math.round((horasPorFuncionario.get(func.id) || (presencas * cargaHorariaDiaria / 60)) * 100) / 100
      const horasExtras = Math.max(0, horasTrabalhadas - horasPrevistas)

      const percentualPresenca = diasUteisMes > 0 ? Math.round((presencas / diasUteisMes) * 100) : 0

      funcionarios.push({
        id: func.id,
        matricula: func.matricula,
        nome: func.nome,
        cpf: func.cpf,
        cargo: func.cargo_nome || '-',
        lotacao: func.lotacao_nome || '-',
        diasUteis: diasUteisMes,
        presencas,
        faltas,
        abonos: diasAbonados,
        atrasos: atrasosFuncionario,
        horasTrabalhadas,
        horasExtras,
        percentualPresenca,
      })

      totalPresencas += presencas
      totalFaltas += faltas
      totalAtrasos += atrasosFuncionario
      totalHorasTrabalhadas += horasTrabalhadas
      totalHorasExtras += horasExtras
    }

    const totalFuncionarios = funcionarios.length
    const mediaPresenca = totalFuncionarios > 0
      ? Math.round((totalPresencas / (totalFuncionarios * diasUteisMes)) * 100)
      : 0

    return {
      funcionarios,
      resumo: {
        totalFuncionarios,
        diasUteis: diasUteisMes,
        totalPresencas,
        totalFaltas,
        totalAtrasos,
        totalHorasTrabalhadas: Math.round(totalHorasTrabalhadas * 100) / 100,
        totalHorasExtras: Math.round(totalHorasExtras * 100) / 100,
        mediaPresenca,
      },
      periodo: { mes, ano, mesNome },
    }
  }

  /**
   * Gera relatório de horas extras
   */
  static async gerarHorasExtras(
    municipioId: number,
    dataInicio: Date,
    dataFim: Date,
    funcionarioId?: number,
    lotacaoId?: number
  ): Promise<{
    registros: HorasExtrasRegistro[]
    resumo: ResumoHorasExtras
    periodo: { dataInicio: string; dataFim: string }
  }> {
    const dtInicio = DateTime.fromJSDate(dataInicio)
    const dtFim = DateTime.fromJSDate(dataFim)

    // Busca funcionários com suas jornadas
    let queryFunc = `
      SELECT f.id, f.matricula, f.nome, f.cpf,
             c.nome as cargo_nome,
             l.nome as lotacao_nome,
             j.carga_horaria_diaria,
             j.nome as jornada_nome
      FROM funcionarios f
      LEFT JOIN cargos c ON c.id = f.cargo_id
      LEFT JOIN lotacoes l ON l.id = f.lotacao_id
      LEFT JOIN jornadas j ON j.id = f.jornada_id
      WHERE f.ativo = true
    `
    const params: any[] = []

    if (funcionarioId) {
      params.push(funcionarioId)
      queryFunc += ` AND f.id = $${params.length}`
    }
    if (lotacaoId) {
      params.push(lotacaoId)
      queryFunc += ` AND f.lotacao_id = $${params.length}`
    }
    queryFunc += ` ORDER BY f.nome`

    const funcionariosResult = await DatabaseManagerService.queryMunicipio(municipioId, queryFunc, params)

    // Busca feriados
    const feriadosQuery = `SELECT data FROM feriados WHERE data >= $1 AND data <= $2 AND ativo = true`
    const feriadosResult = await DatabaseManagerService.queryMunicipio(municipioId, feriadosQuery, [dataInicio, dataFim])
    const feriados = new Set(feriadosResult.rows.map((r: any) => DateTime.fromJSDate(r.data).toISODate()))

    const registros: HorasExtrasRegistro[] = []
    let totalHorasExtras50 = 0
    let totalHorasExtras100 = 0

    for (const func of funcionariosResult.rows) {
      const cargaHorariaDiaria = func.carga_horaria_diaria || 480 // em minutos

      // Busca registros de ponto agrupados por dia
      const pontosQuery = `
        SELECT DATE(data_hora) as data,
               array_agg(data_hora ORDER BY data_hora) as marcacoes
        FROM registros_ponto
        WHERE funcionario_id = $1
          AND data_hora >= $2
          AND data_hora <= $3
        GROUP BY DATE(data_hora)
        ORDER BY data
      `
      const pontosResult = await DatabaseManagerService.queryMunicipio(municipioId, pontosQuery, [
        func.id,
        dataInicio,
        dataFim,
      ])

      let horasExtras50Func = 0
      let horasExtras100Func = 0
      const diasComExtra: { data: string; horas: number; tipo: string }[] = []

      for (const dia of pontosResult.rows) {
        const dataStr = DateTime.fromJSDate(dia.data).toISODate()!
        const marcacoes = dia.marcacoes as Date[]
        const dt = DateTime.fromISO(dataStr)
        const ehFimDeSemana = dt.weekday === 6 || dt.weekday === 7
        const ehFeriado = feriados.has(dataStr)

        // Calcula horas trabalhadas no dia
        let minutosTrabalhados = 0
        for (let i = 0; i < marcacoes.length - 1; i += 2) {
          const entrada = DateTime.fromJSDate(marcacoes[i])
          const saida = marcacoes[i + 1] ? DateTime.fromJSDate(marcacoes[i + 1]) : entrada
          minutosTrabalhados += saida.diff(entrada, 'minutes').minutes
        }

        // Calcula extras
        if (ehFimDeSemana || ehFeriado) {
          // Hora extra 100% (fim de semana/feriado)
          const horasExtras = minutosTrabalhados / 60
          if (horasExtras > 0) {
            horasExtras100Func += horasExtras
            diasComExtra.push({ data: dataStr, horas: horasExtras, tipo: '100%' })
          }
        } else {
          // Hora extra 50% (dia útil)
          const excedente = minutosTrabalhados - cargaHorariaDiaria
          if (excedente > 0) {
            const horasExtras = excedente / 60
            horasExtras50Func += horasExtras
            diasComExtra.push({ data: dataStr, horas: horasExtras, tipo: '50%' })
          }
        }
      }

      if (horasExtras50Func > 0 || horasExtras100Func > 0) {
        registros.push({
          funcionarioId: func.id,
          matricula: func.matricula,
          nome: func.nome,
          cargo: func.cargo_nome || '-',
          lotacao: func.lotacao_nome || '-',
          jornada: func.jornada_nome || '-',
          horasExtras50: Math.round(horasExtras50Func * 100) / 100,
          horasExtras100: Math.round(horasExtras100Func * 100) / 100,
          totalHorasExtras: Math.round((horasExtras50Func + horasExtras100Func) * 100) / 100,
          diasComExtra,
        })

        totalHorasExtras50 += horasExtras50Func
        totalHorasExtras100 += horasExtras100Func
      }
    }

    return {
      registros,
      resumo: {
        totalFuncionarios: registros.length,
        totalHorasExtras50: Math.round(totalHorasExtras50 * 100) / 100,
        totalHorasExtras100: Math.round(totalHorasExtras100 * 100) / 100,
        totalGeralHorasExtras: Math.round((totalHorasExtras50 + totalHorasExtras100) * 100) / 100,
      },
      periodo: {
        dataInicio: dtInicio.toFormat('dd/MM/yyyy'),
        dataFim: dtFim.toFormat('dd/MM/yyyy'),
      },
    }
  }

  /**
   * Gera relatório de ocorrências
   */
  static async gerarOcorrencias(
    municipioId: number,
    dataInicio: Date,
    dataFim: Date,
    funcionarioId?: number,
    tipoOcorrenciaId?: number,
    lotacaoId?: number
  ): Promise<{
    ocorrencias: OcorrenciaRelatorio[]
    resumoPorTipo: { tipo: string; quantidade: number; diasTotal: number }[]
    resumo: ResumoOcorrencias
    periodo: { dataInicio: string; dataFim: string }
  }> {
    const dtInicio = DateTime.fromJSDate(dataInicio)
    const dtFim = DateTime.fromJSDate(dataFim)

    let query = `
      SELECT o.id, o.data_inicio, o.data_fim, o.observacao,
             f.id as funcionario_id, f.matricula, f.nome as funcionario_nome, f.cpf,
             l.nome as lotacao_nome,
             t.id as tipo_id, t.nome as tipo_nome, t.abona
      FROM ocorrencias o
      JOIN funcionarios f ON f.id = o.funcionario_id
      JOIN tipos_ocorrencia t ON t.id = o.tipo_ocorrencia_id
      LEFT JOIN lotacoes l ON l.id = f.lotacao_id
      WHERE o.data_inicio <= $1 AND o.data_fim >= $2
    `
    const params: any[] = [dataFim, dataInicio]

    if (funcionarioId) {
      params.push(funcionarioId)
      query += ` AND o.funcionario_id = $${params.length}`
    }
    if (tipoOcorrenciaId) {
      params.push(tipoOcorrenciaId)
      query += ` AND o.tipo_ocorrencia_id = $${params.length}`
    }
    if (lotacaoId) {
      params.push(lotacaoId)
      query += ` AND f.lotacao_id = $${params.length}`
    }
    query += ` ORDER BY o.data_inicio DESC, f.nome`

    const result = await DatabaseManagerService.queryMunicipio(municipioId, query, params)

    const ocorrencias: OcorrenciaRelatorio[] = []
    const resumoPorTipoMap: Record<string, { quantidade: number; diasTotal: number }> = {}
    let totalDias = 0
    let totalAbonadas = 0

    for (const row of result.rows) {
      const inicio = DateTime.fromJSDate(row.data_inicio)
      const fim = DateTime.fromJSDate(row.data_fim)
      const dias = Math.ceil(fim.diff(inicio, 'days').days) + 1

      ocorrencias.push({
        id: row.id,
        funcionarioId: row.funcionario_id,
        matricula: row.matricula,
        funcionarioNome: row.funcionario_nome,
        cpf: row.cpf,
        lotacao: row.lotacao_nome || '-',
        tipoId: row.tipo_id,
        tipoNome: row.tipo_nome,
        abona: row.abona,
        dataInicio: inicio.toFormat('dd/MM/yyyy'),
        dataFim: fim.toFormat('dd/MM/yyyy'),
        dias,
        observacao: row.observacao || '',
      })

      // Agrupa por tipo
      if (!resumoPorTipoMap[row.tipo_nome]) {
        resumoPorTipoMap[row.tipo_nome] = { quantidade: 0, diasTotal: 0 }
      }
      resumoPorTipoMap[row.tipo_nome].quantidade++
      resumoPorTipoMap[row.tipo_nome].diasTotal += dias

      totalDias += dias
      if (row.abona) totalAbonadas++
    }

    const resumoPorTipo = Object.entries(resumoPorTipoMap).map(([tipo, data]) => ({
      tipo,
      quantidade: data.quantidade,
      diasTotal: data.diasTotal,
    }))

    return {
      ocorrencias,
      resumoPorTipo,
      resumo: {
        totalOcorrencias: ocorrencias.length,
        totalDias,
        totalAbonadas,
        totalNaoAbonadas: ocorrencias.length - totalAbonadas,
      },
      periodo: {
        dataInicio: dtInicio.toFormat('dd/MM/yyyy'),
        dataFim: dtFim.toFormat('dd/MM/yyyy'),
      },
    }
  }

  /**
   * Gera relatório de banco de horas
   */
  static async gerarBancoHoras(
    municipioId: number,
    mes: number,
    ano: number,
    funcionarioId?: number,
    lotacaoId?: number
  ): Promise<{
    funcionarios: BancoHorasFuncionario[]
    resumo: ResumoBancoHoras
    periodo: { mes: number; ano: number; mesNome: string }
  }> {
    const dataInicio = DateTime.local(ano, mes, 1).startOf('month')
    const dataFim = dataInicio.endOf('month')
    const mesNome = dataInicio.setLocale('pt-BR').toFormat('MMMM/yyyy')

    // Busca funcionários
    let queryFunc = `
      SELECT f.id, f.matricula, f.nome, f.cpf,
             c.nome as cargo_nome,
             l.nome as lotacao_nome,
             j.carga_horaria_diaria,
             j.nome as jornada_nome
      FROM funcionarios f
      LEFT JOIN cargos c ON c.id = f.cargo_id
      LEFT JOIN lotacoes l ON l.id = f.lotacao_id
      LEFT JOIN jornadas j ON j.id = f.jornada_id
      WHERE f.ativo = true
    `
    const params: any[] = []

    if (funcionarioId) {
      params.push(funcionarioId)
      queryFunc += ` AND f.id = $${params.length}`
    }
    if (lotacaoId) {
      params.push(lotacaoId)
      queryFunc += ` AND f.lotacao_id = $${params.length}`
    }
    queryFunc += ` ORDER BY f.nome`

    const funcionariosResult = await DatabaseManagerService.queryMunicipio(municipioId, queryFunc, params)

    // Busca feriados
    const feriadosQuery = `SELECT data FROM feriados WHERE data >= $1 AND data <= $2 AND ativo = true`
    const feriadosResult = await DatabaseManagerService.queryMunicipio(municipioId, feriadosQuery, [
      dataInicio.toJSDate(),
      dataFim.toJSDate(),
    ])
    const feriados = new Set(feriadosResult.rows.map((r: any) => DateTime.fromJSDate(r.data).toISODate()))

    // Calcula dias úteis
    let diasUteis = 0
    let dataAtual = dataInicio
    while (dataAtual <= dataFim) {
      const ehFimDeSemana = dataAtual.weekday === 6 || dataAtual.weekday === 7
      const ehFeriado = feriados.has(dataAtual.toISODate()!)
      if (!ehFimDeSemana && !ehFeriado) diasUteis++
      dataAtual = dataAtual.plus({ days: 1 })
    }

    const funcionarios: BancoHorasFuncionario[] = []
    let totalCredito = 0
    let totalDebito = 0

    for (const func of funcionariosResult.rows) {
      const cargaHorariaDiaria = func.carga_horaria_diaria || 480 // minutos
      const horasPrevistas = (diasUteis * cargaHorariaDiaria) / 60

      // Busca registros de ponto
      const pontosQuery = `
        SELECT DATE(data_hora) as data,
               array_agg(data_hora ORDER BY data_hora) as marcacoes
        FROM registros_ponto
        WHERE funcionario_id = $1
          AND data_hora >= $2
          AND data_hora <= $3
        GROUP BY DATE(data_hora)
      `
      const pontosResult = await DatabaseManagerService.queryMunicipio(municipioId, pontosQuery, [
        func.id,
        dataInicio.toJSDate(),
        dataFim.toJSDate(),
      ])

      let horasTrabalhadas = 0
      for (const dia of pontosResult.rows) {
        const marcacoes = dia.marcacoes as Date[]
        for (let i = 0; i < marcacoes.length - 1; i += 2) {
          const entrada = DateTime.fromJSDate(marcacoes[i])
          const saida = marcacoes[i + 1] ? DateTime.fromJSDate(marcacoes[i + 1]) : entrada
          horasTrabalhadas += saida.diff(entrada, 'minutes').minutes / 60
        }
      }

      // Busca saldo anterior (acumulado até o mês anterior)
      const mesAnterior = dataInicio.minus({ months: 1 })
      const saldoAnteriorQuery = `
        SELECT COALESCE(SUM(
          CASE
            WHEN tipo_operacao = 'CREDITO' THEN minutos
            WHEN tipo_operacao IN ('DEBITO', 'COMPENSACAO', 'PAGAMENTO') THEN -ABS(minutos)
            ELSE 0
          END
        ), 0) / 60.0 as saldo_horas
        FROM banco_horas
        WHERE funcionario_id = $1
          AND data < $2
      `
      const [saldoAnteriorResult] = await DatabaseManagerService.queryMunicipio(
        municipioId,
        saldoAnteriorQuery,
        [func.id, dataInicio.toJSDate()]
      )
      const saldoAnterior = saldoAnteriorResult?.saldo_horas || 0

      const saldoMes = horasTrabalhadas - horasPrevistas
      const saldoAtual = saldoAnterior + saldoMes

      if (saldoMes > 0) totalCredito += saldoMes
      else totalDebito += Math.abs(saldoMes)

      funcionarios.push({
        id: func.id,
        matricula: func.matricula,
        nome: func.nome,
        cargo: func.cargo_nome || '-',
        lotacao: func.lotacao_nome || '-',
        jornada: func.jornada_nome || '-',
        horasPrevistas: Math.round(horasPrevistas * 100) / 100,
        horasTrabalhadas: Math.round(horasTrabalhadas * 100) / 100,
        saldoAnterior: Math.round(saldoAnterior * 100) / 100,
        saldoMes: Math.round(saldoMes * 100) / 100,
        saldoAtual: Math.round(saldoAtual * 100) / 100,
      })
    }

    return {
      funcionarios,
      resumo: {
        totalFuncionarios: funcionarios.length,
        totalCredito: Math.round(totalCredito * 100) / 100,
        totalDebito: Math.round(totalDebito * 100) / 100,
        saldoGeral: Math.round((totalCredito - totalDebito) * 100) / 100,
      },
      periodo: { mes, ano, mesNome },
    }
  }

  /**
   * Gera relatório de lista de funcionários em Excel
   */
  static async gerarFuncionariosExcel(
    municipioId: number,
    lotacaoId?: number,
    ativo?: boolean
  ): Promise<FuncionarioExport[]> {
    let query = `
      SELECT f.id, f.matricula, f.nome, f.cpf, f.pis, f.data_admissao, f.ativo,
             c.nome as cargo_nome,
             l.nome as lotacao_nome,
             s.nome as secretaria_nome,
             tv.nome as tipo_vinculo_nome,
             j.nome as jornada_nome
      FROM funcionarios f
      LEFT JOIN cargos c ON c.id = f.cargo_id
      LEFT JOIN lotacoes l ON l.id = f.lotacao_id
      LEFT JOIN secretarias s ON s.id = l.secretaria_id
      LEFT JOIN tipos_vinculo tv ON tv.id = f.tipo_vinculo_id
      LEFT JOIN jornadas j ON j.id = f.jornada_id
      WHERE 1=1
    `
    const params: any[] = []

    if (lotacaoId) {
      params.push(lotacaoId)
      query += ` AND f.lotacao_id = $${params.length}`
    }
    if (ativo !== undefined) {
      params.push(ativo)
      query += ` AND f.ativo = $${params.length}`
    }
    query += ` ORDER BY f.nome`

    const result = await DatabaseManagerService.queryMunicipio(municipioId, query, params)

    return result.rows.map((row: any) => ({
      matricula: row.matricula || '',
      nome: row.nome || '',
      cpf: row.cpf || '',
      pis: row.pis || '',
      cargo: row.cargo_nome || '-',
      lotacao: row.lotacao_nome || '-',
      secretaria: row.secretaria_nome || '-',
      tipoVinculo: row.tipo_vinculo_nome || '-',
      jornada: row.jornada_nome || '-',
      dataAdmissao: row.data_admissao ? DateTime.fromJSDate(row.data_admissao).toFormat('dd/MM/yyyy') : '-',
      ativo: row.ativo ? 'Sim' : 'Não',
    }))
  }
}

// Interfaces auxiliares
interface FrequenciaFuncionario {
  id: number
  matricula: string
  nome: string
  cpf: string
  cargo: string
  lotacao: string
  diasUteis: number
  presencas: number
  faltas: number
  abonos: number
  atrasos: number
  horasTrabalhadas: number
  horasExtras: number
  percentualPresenca: number
}

interface ResumoFrequencia {
  totalFuncionarios: number
  diasUteis: number
  totalPresencas: number
  totalFaltas: number
  totalAtrasos: number
  totalHorasTrabalhadas: number
  totalHorasExtras: number
  mediaPresenca: number
}

interface HorasExtrasRegistro {
  funcionarioId: number
  matricula: string
  nome: string
  cargo: string
  lotacao: string
  jornada: string
  horasExtras50: number
  horasExtras100: number
  totalHorasExtras: number
  diasComExtra: { data: string; horas: number; tipo: string }[]
}

interface ResumoHorasExtras {
  totalFuncionarios: number
  totalHorasExtras50: number
  totalHorasExtras100: number
  totalGeralHorasExtras: number
}

interface OcorrenciaRelatorio {
  id: number
  funcionarioId: number
  matricula: string
  funcionarioNome: string
  cpf: string
  lotacao: string
  tipoId: number
  tipoNome: string
  abona: boolean
  dataInicio: string
  dataFim: string
  dias: number
  observacao: string
}

interface ResumoOcorrencias {
  totalOcorrencias: number
  totalDias: number
  totalAbonadas: number
  totalNaoAbonadas: number
}

interface BancoHorasFuncionario {
  id: number
  matricula: string
  nome: string
  cargo: string
  lotacao: string
  jornada: string
  horasPrevistas: number
  horasTrabalhadas: number
  saldoAnterior: number
  saldoMes: number
  saldoAtual: number
}

interface ResumoBancoHoras {
  totalFuncionarios: number
  totalCredito: number
  totalDebito: number
  saldoGeral: number
}

interface FuncionarioExport {
  matricula: string
  nome: string
  cpf: string
  pis: string
  cargo: string
  lotacao: string
  secretaria: string
  tipoVinculo: string
  jornada: string
  dataAdmissao: string
  ativo: string
}
