import { test } from '@japa/runner'
import { CalculoPontoService } from '#services/calculo_ponto_service'
import { DateTime } from 'luxon'

test.group('CalculoPontoService', () => {
  /**
   * Teste: Deve calcular horas trabalhadas corretamente (jornada normal)
   */
  test('deve calcular horas trabalhadas corretamente', async ({ assert }) => {
    const registros = [
      DateTime.fromISO('2026-01-06T08:00:00'),
      DateTime.fromISO('2026-01-06T12:00:00'),
      DateTime.fromISO('2026-01-06T13:00:00'),
      DateTime.fromISO('2026-01-06T17:00:00'),
    ]

    const horasTrabalhadas = CalculoPontoService.calcularHorasTrabalhadas(registros)

    // 4h (manhã) + 4h (tarde) = 8h = 480 minutos
    assert.equal(horasTrabalhadas, 480)
  })

  /**
   * Teste: Deve calcular atraso corretamente
   */
  test('deve calcular atraso corretamente', async ({ assert }) => {
    const horaEntrada = DateTime.fromISO('2026-01-06T08:15:00') // 15 min de atraso
    const horaPrevistoEntrada = DateTime.fromISO('2026-01-06T08:00:00')
    const tolerancia = 10 // 10 minutos de tolerância

    const atraso = CalculoPontoService.calcularAtraso(
      horaEntrada,
      horaPrevistoEntrada,
      tolerancia
    )

    // 15 min de atraso - 10 min de tolerância = 5 min
    assert.equal(atraso, 5)
  })

  /**
   * Teste: Não deve considerar atraso dentro da tolerância
   */
  test('não deve considerar atraso dentro da tolerância', async ({ assert }) => {
    const horaEntrada = DateTime.fromISO('2026-01-06T08:08:00') // 8 min de atraso
    const horaPrevistoEntrada = DateTime.fromISO('2026-01-06T08:00:00')
    const tolerancia = 10 // 10 minutos de tolerância

    const atraso = CalculoPontoService.calcularAtraso(
      horaEntrada,
      horaPrevistoEntrada,
      tolerancia
    )

    assert.equal(atraso, 0)
  })

  /**
   * Teste: Deve calcular hora extra corretamente
   */
  test('deve calcular hora extra corretamente', async ({ assert }) => {
    const horasTrabalhadas = 540 // 9 horas = 540 minutos
    const horasPrevistas = 480 // 8 horas = 480 minutos

    const horaExtra = CalculoPontoService.calcularHoraExtra(horasTrabalhadas, horasPrevistas)

    // 540 - 480 = 60 minutos (1 hora extra)
    assert.equal(horaExtra, 60)
  })

  /**
   * Teste: Deve calcular hora faltante corretamente
   */
  test('deve calcular hora faltante corretamente', async ({ assert }) => {
    const horasTrabalhadas = 420 // 7 horas = 420 minutos
    const horasPrevistas = 480 // 8 horas = 480 minutos

    const horaFaltante = CalculoPontoService.calcularHoraFaltante(
      horasTrabalhadas,
      horasPrevistas
    )

    // 480 - 420 = 60 minutos faltantes
    assert.equal(horaFaltante, 60)
  })

  /**
   * Teste: Deve identificar falta (sem registros)
   */
  test('deve identificar falta quando não há registros', async ({ assert }) => {
    const registros: DateTime[] = []
    const ehFolga = false
    const ehFeriado = false

    const ehFalta = CalculoPontoService.identificarFalta(registros, ehFolga, ehFeriado)

    assert.isTrue(ehFalta)
  })

  /**
   * Teste: Não deve identificar falta em folga
   */
  test('não deve identificar falta em folga', async ({ assert }) => {
    const registros: DateTime[] = []
    const ehFolga = true
    const ehFeriado = false

    const ehFalta = CalculoPontoService.identificarFalta(registros, ehFolga, ehFeriado)

    assert.isFalse(ehFalta)
  })

  /**
   * Teste: Não deve identificar falta em feriado
   */
  test('não deve identificar falta em feriado', async ({ assert }) => {
    const registros: DateTime[] = []
    const ehFolga = false
    const ehFeriado = true

    const ehFalta = CalculoPontoService.identificarFalta(registros, ehFolga, ehFeriado)

    assert.isFalse(ehFalta)
  })

  /**
   * Teste: Deve converter minutos para formato HH:MM
   */
  test('deve converter minutos para formato HH:MM', async ({ assert }) => {
    assert.equal(CalculoPontoService.minutosParaHHMM(60), '01:00')
    assert.equal(CalculoPontoService.minutosParaHHMM(90), '01:30')
    assert.equal(CalculoPontoService.minutosParaHHMM(480), '08:00')
    assert.equal(CalculoPontoService.minutosParaHHMM(0), '00:00')
  })

  /**
   * Teste: Deve agrupar registros por dia
   */
  test('deve agrupar registros por dia', async ({ assert }) => {
    const registros = [
      {
        id: 1,
        funcionario_id: 1,
        data_hora: '2026-01-06T08:00:00',
        tipo: 'ENTRADA',
        sentido: null,
        origem: 'BIOMETRIA',
      },
      {
        id: 2,
        funcionario_id: 1,
        data_hora: '2026-01-06T17:00:00',
        tipo: 'SAIDA',
        sentido: null,
        origem: 'BIOMETRIA',
      },
      {
        id: 3,
        funcionario_id: 1,
        data_hora: '2026-01-07T08:00:00',
        tipo: 'ENTRADA',
        sentido: null,
        origem: 'BIOMETRIA',
      },
    ]

    const agrupados = CalculoPontoService.agruparRegistrosPorDia(registros)

    assert.equal(Object.keys(agrupados).length, 2)
    assert.equal(agrupados['2026-01-06'].length, 2)
    assert.equal(agrupados['2026-01-07'].length, 1)
  })

  /**
   * Teste: Deve identificar dia da semana corretamente
   */
  test('deve identificar dia da semana corretamente', async ({ assert }) => {
    // 06/01/2026 é uma terça-feira (dia 2)
    const data = DateTime.fromISO('2026-01-06')
    const diaSemana = CalculoPontoService.getDiaSemana(data)

    assert.equal(diaSemana, 2)
  })

  /**
   * Teste: Deve validar se é dia útil
   */
  test('deve validar se é dia útil', async ({ assert }) => {
    // Segunda-feira
    const segunda = DateTime.fromISO('2026-01-05')
    assert.isTrue(CalculoPontoService.isDiaUtil(segunda, false))

    // Sábado
    const sabado = DateTime.fromISO('2026-01-10')
    assert.isFalse(CalculoPontoService.isDiaUtil(sabado, false))

    // Domingo
    const domingo = DateTime.fromISO('2026-01-11')
    assert.isFalse(CalculoPontoService.isDiaUtil(domingo, false))

    // Feriado
    const feriado = DateTime.fromISO('2026-01-01')
    assert.isFalse(CalculoPontoService.isDiaUtil(feriado, true))
  })
})
