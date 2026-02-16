/**
 * Serviço de Cálculos Trabalhistas
 * 
 * Calcula horas extras, adicional noturno e integra com banco de horas
 */

interface ConfiguracaoCalculo {
    percentualHE50: number     // Ex: 50 (50%)
    percentualHE100: number    // Ex: 100 (100%)
    percentualNoturno: number  // Ex: 20 (20%)
    horaNoturnaInicio: string  // Ex: "22:00"
    horaNoturnaFim: string     // Ex: "05:00"
    toleranciaMinutos: number  // Ex: 5 minutos
}

interface ResultadoCalculo {
    horasTrabalhadasMinutos: number
    horasFaltantesMinutos: number
    horasExtras50Minutos: number
    horasExtras100Minutos: number
    horasNoturasMinutos: number
    saldoBancoHorasMinutos: number
    detalhes: string[]
}

interface RegistroPonto {
    entrada1?: string
    saida1?: string
    entrada2?: string
    saida2?: string
    entrada3?: string
    saida3?: string
}

interface JornadaDia {
    jornadaMinutos: number
    isFeriado: boolean
    isDomingo: boolean
    isSabado: boolean
    isDescanso: boolean
}

/**
 * Calcula a diferença em minutos entre dois horários
 */
function calcularDiferencaMinutos(inicio: string, fim: string): number {
    const [h1, m1] = inicio.split(':').map(Number)
    const [h2, m2] = fim.split(':').map(Number)

    let minutos1 = h1 * 60 + m1
    let minutos2 = h2 * 60 + m2

    // Se fim é menor que início, passou da meia-noite
    if (minutos2 < minutos1) {
        minutos2 += 24 * 60
    }

    return minutos2 - minutos1
}

/**
 * Verifica se um horário está dentro do período noturno
 */
function isHorarioNoturno(horario: string, config: ConfiguracaoCalculo): boolean {
    const [h, m] = horario.split(':').map(Number)
    const minutos = h * 60 + m

    const [hInicio, mInicio] = config.horaNoturnaInicio.split(':').map(Number)
    const [hFim, mFim] = config.horaNoturnaFim.split(':').map(Number)

    const inicioNoturno = hInicio * 60 + mInicio
    const fimNoturno = hFim * 60 + mFim

    // Período noturno que cruza meia-noite (22:00 - 05:00)
    if (inicioNoturno > fimNoturno) {
        return minutos >= inicioNoturno || minutos <= fimNoturno
    }

    return minutos >= inicioNoturno && minutos <= fimNoturno
}

/**
 * Calcula minutos trabalhados em período noturno
 */
function calcularMinutosNoturnos(inicio: string, fim: string, config: ConfiguracaoCalculo): number {
    const [hInicio, mInicio] = config.horaNoturnaInicio.split(':').map(Number)
    const [hFim, mFim] = config.horaNoturnaFim.split(':').map(Number)

    const inicioNoturno = hInicio * 60 + mInicio  // 22:00 = 1320
    const fimNoturno = hFim * 60 + mFim          // 05:00 = 300

    const [h1, m1] = inicio.split(':').map(Number)
    const [h2, m2] = fim.split(':').map(Number)

    let minutosTrabInicio = h1 * 60 + m1
    let minutosTrabFim = h2 * 60 + m2

    if (minutosTrabFim < minutosTrabInicio) {
        minutosTrabFim += 24 * 60
    }

    let minutosNoturnos = 0

    // Calcula interseção com período noturno
    // O período noturno vai de 22:00 (1320) até 05:00 do dia seguinte (300 + 1440 = 1740)
    const noturnoInicio1 = inicioNoturno  // 22:00 = 1320
    const noturnoFim1 = 24 * 60           // 24:00 = 1440
    const noturnoInicio2 = 0               // 00:00. = 0
    const noturnoFim2 = fimNoturno        // 05:00 = 300

    // Interseção com 22:00-00:00
    const interInicio1 = Math.max(minutosTrabInicio, noturnoInicio1)
    const interFim1 = Math.min(minutosTrabFim, noturnoFim1)
    if (interFim1 > interInicio1) {
        minutosNoturnos += interFim1 - interInicio1
    }

    // Interseção com 00:00-05:00 (ajustado para horário normalizado)
    if (minutosTrabFim > 24 * 60) {
        const minutosTrabFimAjustado = minutosTrabFim - 24 * 60
        const interInicio2 = Math.max(0, noturnoInicio2)
        const interFim2 = Math.min(minutosTrabFimAjustado, noturnoFim2)
        if (interFim2 > interInicio2) {
            minutosNoturnos += interFim2 - interInicio2
        }
    }

    return minutosNoturnos
}

/**
 * Calcula o total de horas trabalhadas no dia
 */
function calcularMinutosTrabalhados(registros: RegistroPonto): number {
    let total = 0

    if (registros.entrada1 && registros.saida1) {
        total += calcularDiferencaMinutos(registros.entrada1, registros.saida1)
    }

    if (registros.entrada2 && registros.saida2) {
        total += calcularDiferencaMinutos(registros.entrada2, registros.saida2)
    }

    if (registros.entrada3 && registros.saida3) {
        total += calcularDiferencaMinutos(registros.entrada3, registros.saida3)
    }

    return total
}

/**
 * Calcula horas extras, adicional noturno e saldo do banco de horas
 */
export function calcularDia(
    registros: RegistroPonto,
    jornada: JornadaDia,
    config: ConfiguracaoCalculo
): ResultadoCalculo {
    const resultado: ResultadoCalculo = {
        horasTrabalhadasMinutos: 0,
        horasFaltantesMinutos: 0,
        horasExtras50Minutos: 0,
        horasExtras100Minutos: 0,
        horasNoturasMinutos: 0,
        saldoBancoHorasMinutos: 0,
        detalhes: []
    }

    // Calcula minutos trabalhados
    resultado.horasTrabalhadasMinutos = calcularMinutosTrabalhados(registros)

    // Se é dia de descanso/feriado, tudo é hora extra 100%
    if (jornada.isDescanso || jornada.isFeriado || jornada.isDomingo) {
        resultado.horasExtras100Minutos = resultado.horasTrabalhadasMinutos
        resultado.saldoBancoHorasMinutos = resultado.horasTrabalhadasMinutos
        resultado.detalhes.push(`Trabalho em dia de descanso/feriado: ${resultado.horasTrabalhadasMinutos}min = HE 100%`)
    } else {
        // Dia normal de trabalho
        const jornadaEsperada = jornada.jornadaMinutos
        const diferenca = resultado.horasTrabalhadasMinutos - jornadaEsperada

        if (diferenca > config.toleranciaMinutos) {
            // Hora extra (após tolerância)
            resultado.horasExtras50Minutos = diferenca
            resultado.saldoBancoHorasMinutos = diferenca
            resultado.detalhes.push(`Hora extra 50%: ${diferenca}min`)
        } else if (diferenca < -config.toleranciaMinutos) {
            // Falta de horas
            resultado.horasFaltantesMinutos = Math.abs(diferenca)
            resultado.saldoBancoHorasMinutos = diferenca // negativo
            resultado.detalhes.push(`Horas faltantes: ${resultado.horasFaltantesMinutos}min`)
        } else {
            resultado.detalhes.push('Jornada cumprida normalmente')
        }
    }

    // Calcula adicional noturno
    if (registros.entrada1 && registros.saida1) {
        const noturnos1 = calcularMinutosNoturnos(registros.entrada1, registros.saida1, config)
        resultado.horasNoturasMinutos += noturnos1
    }

    if (registros.entrada2 && registros.saida2) {
        const noturnos2 = calcularMinutosNoturnos(registros.entrada2, registros.saida2, config)
        resultado.horasNoturasMinutos += noturnos2
    }

    if (resultado.horasNoturasMinutos > 0) {
        resultado.detalhes.push(`Adicional noturno: ${resultado.horasNoturasMinutos}min`)
    }

    return resultado
}

/**
 * Converte minutos para formato hh:mm
 */
export function minutosParaHoras(minutos: number): string {
    const horas = Math.floor(Math.abs(minutos) / 60)
    const mins = Math.abs(minutos) % 60
    const sinal = minutos < 0 ? '-' : ''
    return `${sinal}${horas.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`
}

/**
 * Calcula valor monetário da hora extra
 */
export function calcularValorHoraExtra(
    minutosHE50: number,
    minutosHE100: number,
    valorHoraNormal: number,
    config: ConfiguracaoCalculo
): { valorHE50: number; valorHE100: number; total: number } {
    const valorMinuto = valorHoraNormal / 60
    const valorHE50 = (minutosHE50 * valorMinuto * (1 + config.percentualHE50 / 100))
    const valorHE100 = (minutosHE100 * valorMinuto * (1 + config.percentualHE100 / 100))

    return {
        valorHE50,
        valorHE100,
        total: valorHE50 + valorHE100
    }
}

/**
 * Calcula valor do adicional noturno
 */
export function calcularValorAdicionalNoturno(
    minutosNoturnos: number,
    valorHoraNormal: number,
    config: ConfiguracaoCalculo
): number {
    const valorMinuto = valorHoraNormal / 60
    return minutosNoturnos * valorMinuto * (config.percentualNoturno / 100)
}
