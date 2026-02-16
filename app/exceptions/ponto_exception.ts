import { Exception } from '@adonisjs/core/exceptions'
import type { HttpContext } from '@adonisjs/core/http'

/**
 * ===========================================================================
 * PONTO EXCEPTION - Exceções Relacionadas a Registro de Ponto
 * ===========================================================================
 *
 * Esta classe define exceções específicas para operações de registro de ponto,
 * facilitando o tratamento de erros e fornecendo mensagens claras aos usuários.
 *
 * CASOS DE USO:
 * -------------
 * - Funcionário não encontrado
 * - Batida duplicada
 * - Reconhecimento facial falhou
 * - Biometria não cadastrada
 * - Horário inválido
 * - Jornada não configurada
 *
 * @author Luiz Miguel
 * @version 1.0.0
 * @since 2026-01-06
 *
 * ===========================================================================
 */

export default class PontoException extends Exception {
  /**
   * Trata a exceção e retorna resposta apropriada
   */
  async handle(error: this, ctx: HttpContext) {
    const { response } = ctx

    // Resposta JSON para requisições de API
    if (ctx.request.accepts(['json', 'html']) === 'json') {
      return response.status(error.status).json({
        success: false,
        error: error.message,
        code: error.code,
      })
    }

    // Resposta HTML para requisições web
    return response.status(error.status).send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Erro - GetPonto</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 50px; text-align: center; }
            h1 { color: #e74c3c; }
            p { color: #555; }
            a { color: #3498db; text-decoration: none; }
          </style>
        </head>
        <body>
          <h1>⚠️ Erro no Registro de Ponto</h1>
          <p>${error.message}</p>
          <p><a href="javascript:history.back()">← Voltar</a></p>
        </body>
      </html>
    `)
  }

  // ===========================================================================
  // MÉTODOS ESTÁTICOS PARA CRIAR EXCEÇÕES ESPECÍFICAS
  // ===========================================================================

  /**
   * Funcionário não encontrado
   */
  static funcionarioNaoEncontrado(identificador: string) {
    return new PontoException(
      `Funcionário com identificador "${identificador}" não encontrado`,
      {
        status: 404,
        code: 'E_FUNCIONARIO_NAO_ENCONTRADO',
      }
    )
  }

  /**
   * Batida duplicada (já existe registro no mesmo horário)
   */
  static batidaDuplicada(dataHora: string) {
    return new PontoException(`Já existe uma batida registrada em ${dataHora}`, {
      status: 409,
      code: 'E_BATIDA_DUPLICADA',
    })
  }

  /**
   * Reconhecimento facial falhou
   */
  static reconhecimentoFalhou(motivo?: string) {
    const mensagem = motivo
      ? `Reconhecimento facial falhou: ${motivo}`
      : 'Não foi possível reconhecer o rosto. Tente novamente.'

    return new PontoException(mensagem, {
      status: 400,
      code: 'E_RECONHECIMENTO_FALHOU',
    })
  }

  /**
   * Biometria não cadastrada
   */
  static biometriaNaoCadastrada(funcionarioId: number) {
    return new PontoException(
      `Funcionário ${funcionarioId} não possui biometria cadastrada`,
      {
        status: 400,
        code: 'E_BIOMETRIA_NAO_CADASTRADA',
      }
    )
  }

  /**
   * Foto não cadastrada
   */
  static fotoNaoCadastrada(funcionarioId: number) {
    return new PontoException(`Funcionário ${funcionarioId} não possui foto cadastrada`, {
      status: 400,
      code: 'E_FOTO_NAO_CADASTRADA',
    })
  }

  /**
   * Horário inválido (fora da jornada)
   */
  static horarioInvalido(motivo: string) {
    return new PontoException(`Horário inválido: ${motivo}`, {
      status: 400,
      code: 'E_HORARIO_INVALIDO',
    })
  }

  /**
   * Jornada não configurada
   */
  static jornadaNaoConfigurada(funcionarioId: number) {
    return new PontoException(`Funcionário ${funcionarioId} não possui jornada configurada`, {
      status: 400,
      code: 'E_JORNADA_NAO_CONFIGURADA',
    })
  }

  /**
   * Registro já ajustado (não pode ajustar novamente)
   */
  static registroJaAjustado(registroId: number) {
    return new PontoException(`Registro ${registroId} já foi ajustado anteriormente`, {
      status: 409,
      code: 'E_REGISTRO_JA_AJUSTADO',
    })
  }

  /**
   * Período de ajuste expirado
   */
  static periodoAjusteExpirado(dias: number) {
    return new PontoException(
      `O período de ajuste de ${dias} dias foi excedido`,
      {
        status: 400,
        code: 'E_PERIODO_AJUSTE_EXPIRADO',
      }
    )
  }

  /**
   * Espelho de ponto já aprovado
   */
  static espelhoJaAprovado(mes: number, ano: number) {
    return new PontoException(`Espelho de ponto de ${mes}/${ano} já foi aprovado`, {
      status: 409,
      code: 'E_ESPELHO_JA_APROVADO',
    })
  }

  /**
   * Funcionário inativo
   */
  static funcionarioInativo(funcionarioId: number) {
    return new PontoException(`Funcionário ${funcionarioId} está inativo`, {
      status: 403,
      code: 'E_FUNCIONARIO_INATIVO',
    })
  }

  /**
   * Intervalo mínimo não respeitado
   */
  static intervaloMinimoNaoRespeitado(minutos: number) {
    return new PontoException(
      `Intervalo mínimo de ${minutos} minutos entre batidas não respeitado`,
      {
        status: 400,
        code: 'E_INTERVALO_MINIMO_NAO_RESPEITADO',
      }
    )
  }

  /**
   * Número máximo de batidas excedido
   */
  static maximoBatidasExcedido(maximo: number) {
    return new PontoException(`Número máximo de ${maximo} batidas por dia excedido`, {
      status: 400,
      code: 'E_MAXIMO_BATIDAS_EXCEDIDO',
    })
  }

  /**
   * Serviço de reconhecimento facial indisponível
   */
  static servicoIndisponivel(servico: string) {
    return new PontoException(`Serviço de ${servico} temporariamente indisponível`, {
      status: 503,
      code: 'E_SERVICO_INDISPONIVEL',
    })
  }

  /**
   * Erro genérico de processamento
   */
  static erroProcessamento(detalhes?: string) {
    const mensagem = detalhes
      ? `Erro ao processar registro de ponto: ${detalhes}`
      : 'Erro ao processar registro de ponto'

    return new PontoException(mensagem, {
      status: 500,
      code: 'E_ERRO_PROCESSAMENTO',
    })
  }
}
