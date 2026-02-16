import { Exception } from '@adonisjs/core/exceptions'
import type { HttpContext } from '@adonisjs/core/http'

/**
 * ===========================================================================
 * BIOMETRIA EXCEPTION - Exceções Relacionadas a Biometria
 * ===========================================================================
 *
 * Esta classe define exceções específicas para operações de biometria
 * (digital e reconhecimento facial).
 *
 * CASOS DE USO:
 * -------------
 * - Captura de digital falhou
 * - Digital não reconhecida
 * - Qualidade da digital insuficiente
 * - Foto inválida
 * - Rosto não detectado
 * - Múltiplos rostos detectados
 *
 * @author Luiz Miguel
 * @version 1.0.0
 * @since 2026-01-06
 *
 * ===========================================================================
 */

export default class BiometriaException extends Exception {
  /**
   * Trata a exceção e retorna resposta apropriada
   */
  async handle(error: this, ctx: HttpContext) {
    const { response } = ctx

    return response.status(error.status).json({
      success: false,
      error: error.message,
      code: error.code,
    })
  }

  // ===========================================================================
  // EXCEÇÕES DE BIOMETRIA DIGITAL
  // ===========================================================================

  /**
   * Captura de digital falhou
   */
  static capturaFalhou(motivo?: string) {
    const mensagem = motivo
      ? `Falha na captura da digital: ${motivo}`
      : 'Falha na captura da digital. Tente novamente.'

    return new BiometriaException(mensagem, {
      status: 400,
      code: 'E_CAPTURA_DIGITAL_FALHOU',
    })
  }

  /**
   * Digital não reconhecida
   */
  static digitalNaoReconhecida() {
    return new BiometriaException('Digital não reconhecida. Tente novamente ou use outro dedo.', {
      status: 401,
      code: 'E_DIGITAL_NAO_RECONHECIDA',
    })
  }

  /**
   * Qualidade da digital insuficiente
   */
  static qualidadeInsuficiente(score: number) {
    return new BiometriaException(
      `Qualidade da digital insuficiente (${score}%). Limpe o dedo e tente novamente.`,
      {
        status: 400,
        code: 'E_QUALIDADE_INSUFICIENTE',
      }
    )
  }

  /**
   * Leitor de digital não conectado
   */
  static leitorNaoConectado() {
    return new BiometriaException('Leitor de digital não conectado ou não disponível', {
      status: 503,
      code: 'E_LEITOR_NAO_CONECTADO',
    })
  }

  /**
   * Timeout na captura de digital
   */
  static timeoutCaptura() {
    return new BiometriaException('Tempo esgotado para captura da digital', {
      status: 408,
      code: 'E_TIMEOUT_CAPTURA',
    })
  }

  /**
   * Digital já cadastrada
   */
  static digitalJaCadastrada(dedo: string) {
    return new BiometriaException(`Digital do dedo ${dedo} já está cadastrada`, {
      status: 409,
      code: 'E_DIGITAL_JA_CADASTRADA',
    })
  }

  // ===========================================================================
  // EXCEÇÕES DE RECONHECIMENTO FACIAL
  // ===========================================================================

  /**
   * Foto inválida (formato, tamanho, etc)
   */
  static fotoInvalida(motivo: string) {
    return new BiometriaException(`Foto inválida: ${motivo}`, {
      status: 400,
      code: 'E_FOTO_INVALIDA',
    })
  }

  /**
   * Rosto não detectado na foto
   */
  static rostoNaoDetectado() {
    return new BiometriaException('Nenhum rosto detectado na foto. Certifique-se de estar bem iluminado e olhando para a câmera.', {
      status: 400,
      code: 'E_ROSTO_NAO_DETECTADO',
    })
  }

  /**
   * Múltiplos rostos detectados
   */
  static multiplosRostos(quantidade: number) {
    return new BiometriaException(
      `${quantidade} rostos detectados. Apenas uma pessoa deve aparecer na foto.`,
      {
        status: 400,
        code: 'E_MULTIPLOS_ROSTOS',
      }
    )
  }

  /**
   * Rosto não reconhecido
   */
  static rostoNaoReconhecido() {
    return new BiometriaException('Rosto não reconhecido. Tente novamente ou cadastre sua foto.', {
      status: 401,
      code: 'E_ROSTO_NAO_RECONHECIDO',
    })
  }

  /**
   * Similaridade baixa
   */
  static similaridadeBaixa(score: number, minimo: number) {
    return new BiometriaException(
      `Similaridade muito baixa (${score.toFixed(2)}%). Mínimo requerido: ${minimo}%.`,
      {
        status: 401,
        code: 'E_SIMILARIDADE_BAIXA',
      }
    )
  }

  /**
   * Foto muito escura
   */
  static fotoEscura() {
    return new BiometriaException('Foto muito escura. Melhore a iluminação e tente novamente.', {
      status: 400,
      code: 'E_FOTO_ESCURA',
    })
  }

  /**
   * Foto desfocada
   */
  static fotoDesfocada() {
    return new BiometriaException('Foto desfocada. Mantenha a câmera estável e tente novamente.', {
      status: 400,
      code: 'E_FOTO_DESFOCADA',
    })
  }

  /**
   * Serviço DeepFace indisponível
   */
  static deepfaceIndisponivel() {
    return new BiometriaException('Serviço de reconhecimento facial temporariamente indisponível', {
      status: 503,
      code: 'E_DEEPFACE_INDISPONIVEL',
    })
  }

  // ===========================================================================
  // EXCEÇÕES DO REP CONTROL ID
  // ===========================================================================

  /**
   * Erro de comunicação com REP
   */
  static erroComunicacaoREP(detalhes?: string) {
    const mensagem = detalhes
      ? `Erro de comunicação com REP: ${detalhes}`
      : 'Erro de comunicação com REP Control iD'

    return new BiometriaException(mensagem, {
      status: 503,
      code: 'E_ERRO_COMUNICACAO_REP',
    })
  }

  /**
   * Usuário não cadastrado no REP
   */
  static usuarioNaoCadastradoREP(matricula: string) {
    return new BiometriaException(`Usuário ${matricula} não cadastrado no REP Control iD`, {
      status: 404,
      code: 'E_USUARIO_NAO_CADASTRADO_REP',
    })
  }

  /**
   * Falha ao sincronizar com REP
   */
  static falhaSincronizacaoREP(motivo?: string) {
    const mensagem = motivo
      ? `Falha na sincronização com REP: ${motivo}`
      : 'Falha na sincronização com REP Control iD'

    return new BiometriaException(mensagem, {
      status: 500,
      code: 'E_FALHA_SINCRONIZACAO_REP',
    })
  }
}
