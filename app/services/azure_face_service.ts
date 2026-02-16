/*
|--------------------------------------------------------------------------
| Azure Face API Service
|--------------------------------------------------------------------------
|
| Serviço para reconhecimento facial usando Azure Face API.
| Tier F0 (gratuito): 30.000 transações/mês permanentemente.
|
| Configuração no Azure Portal:
| 1. Criar recurso "Face" no Azure Cognitive Services
| 2. Copiar Endpoint e Key1 para o .env
|
*/

const AZURE_FACE_ENDPOINT = process.env.AZURE_FACE_ENDPOINT || ''
const AZURE_FACE_KEY = process.env.AZURE_FACE_KEY || ''
const PERSON_GROUP_ID = 'ponto-eletronico-funcionarios'

interface AzureError {
  error?: {
    code: string
    message: string
  }
}

interface DetectedFace {
  faceId: string
  faceRectangle: {
    top: number
    left: number
    width: number
    height: number
  }
}

interface IdentifyResult {
  faceId: string
  candidates: {
    personId: string
    confidence: number
  }[]
}

interface Person {
  personId: string
  persistedFaceIds: string[]
  name: string
  userData?: string
}

class AzureFaceService {
  private baseUrl: string
  private headers: Record<string, string>

  constructor() {
    this.baseUrl = AZURE_FACE_ENDPOINT.replace(/\/$/, '')
    this.headers = {
      'Ocp-Apim-Subscription-Key': AZURE_FACE_KEY,
      'Content-Type': 'application/json',
    }
  }

  /**
   * Verifica se o serviço está configurado
   */
  isConfigured(): boolean {
    return !!(AZURE_FACE_ENDPOINT && AZURE_FACE_KEY)
  }

  /**
   * Cria o Person Group se não existir
   */
  async ensurePersonGroupExists(): Promise<boolean> {
    if (!this.isConfigured()) {
      console.log('[AzureFace] Serviço não configurado')
      return false
    }

    try {
      // Tenta obter o grupo
      const getResponse = await fetch(
        `${this.baseUrl}/face/v1.0/persongroups/${PERSON_GROUP_ID}`,
        { headers: this.headers }
      )

      if (getResponse.ok) {
        console.log('[AzureFace] Person Group já existe')
        return true
      }

      // Cria o grupo
      const createResponse = await fetch(
        `${this.baseUrl}/face/v1.0/persongroups/${PERSON_GROUP_ID}`,
        {
          method: 'PUT',
          headers: this.headers,
          body: JSON.stringify({
            name: 'Funcionários - Ponto Eletrônico',
            recognitionModel: 'recognition_04',
          }),
        }
      )

      if (createResponse.ok || createResponse.status === 200) {
        console.log('[AzureFace] Person Group criado com sucesso')
        return true
      }

      const error = (await createResponse.json()) as AzureError
      console.error('[AzureFace] Erro ao criar Person Group:', error)
      return false
    } catch (err) {
      console.error('[AzureFace] Erro ao verificar Person Group:', err)
      return false
    }
  }

  /**
   * Cria uma Person no grupo
   */
  async createPerson(
    name: string,
    userData?: string
  ): Promise<{ personId: string } | null> {
    try {
      const response = await fetch(
        `${this.baseUrl}/face/v1.0/persongroups/${PERSON_GROUP_ID}/persons`,
        {
          method: 'POST',
          headers: this.headers,
          body: JSON.stringify({ name, userData }),
        }
      )

      if (response.ok) {
        const data = (await response.json()) as { personId: string }
        console.log(`[AzureFace] Person criada: ${name} -> ${data.personId}`)
        return data
      }

      const error = (await response.json()) as AzureError
      console.error('[AzureFace] Erro ao criar Person:', error)
      return null
    } catch (err) {
      console.error('[AzureFace] Erro ao criar Person:', err)
      return null
    }
  }

  /**
   * Adiciona face a uma Person a partir de URL
   */
  async addFaceFromUrl(
    personId: string,
    imageUrl: string
  ): Promise<{ persistedFaceId: string } | null> {
    try {
      const response = await fetch(
        `${this.baseUrl}/face/v1.0/persongroups/${PERSON_GROUP_ID}/persons/${personId}/persistedFaces?detectionModel=detection_03`,
        {
          method: 'POST',
          headers: this.headers,
          body: JSON.stringify({ url: imageUrl }),
        }
      )

      if (response.ok) {
        const data = (await response.json()) as { persistedFaceId: string }
        console.log(`[AzureFace] Face adicionada: ${data.persistedFaceId}`)
        return data
      }

      const error = (await response.json()) as AzureError
      console.error('[AzureFace] Erro ao adicionar face:', error)
      return null
    } catch (err) {
      console.error('[AzureFace] Erro ao adicionar face:', err)
      return null
    }
  }

  /**
   * Adiciona face a uma Person a partir de base64
   */
  async addFaceFromBase64(
    personId: string,
    base64Image: string
  ): Promise<{ persistedFaceId: string } | null> {
    try {
      // Remove o prefixo data:image/...;base64, se existir
      const base64Data = base64Image.replace(/^data:image\/\w+;base64,/, '')
      const imageBuffer = Buffer.from(base64Data, 'base64')

      const response = await fetch(
        `${this.baseUrl}/face/v1.0/persongroups/${PERSON_GROUP_ID}/persons/${personId}/persistedFaces?detectionModel=detection_03`,
        {
          method: 'POST',
          headers: {
            'Ocp-Apim-Subscription-Key': AZURE_FACE_KEY,
            'Content-Type': 'application/octet-stream',
          },
          body: imageBuffer,
        }
      )

      if (response.ok) {
        const data = (await response.json()) as { persistedFaceId: string }
        console.log(`[AzureFace] Face adicionada: ${data.persistedFaceId}`)
        return data
      }

      const error = (await response.json()) as AzureError
      console.error('[AzureFace] Erro ao adicionar face (base64):', error)
      return null
    } catch (err) {
      console.error('[AzureFace] Erro ao adicionar face (base64):', err)
      return null
    }
  }

  /**
   * Treina o Person Group (necessário após adicionar faces)
   */
  async trainPersonGroup(): Promise<boolean> {
    try {
      const response = await fetch(
        `${this.baseUrl}/face/v1.0/persongroups/${PERSON_GROUP_ID}/train`,
        {
          method: 'POST',
          headers: this.headers,
        }
      )

      if (response.ok || response.status === 202) {
        console.log('[AzureFace] Treinamento iniciado')
        return true
      }

      const error = (await response.json()) as AzureError
      console.error('[AzureFace] Erro ao iniciar treinamento:', error)
      return false
    } catch (err) {
      console.error('[AzureFace] Erro ao iniciar treinamento:', err)
      return false
    }
  }

  /**
   * Verifica status do treinamento
   */
  async getTrainingStatus(): Promise<{
    status: string
    message?: string
  } | null> {
    try {
      const response = await fetch(
        `${this.baseUrl}/face/v1.0/persongroups/${PERSON_GROUP_ID}/training`,
        { headers: this.headers }
      )

      if (response.ok) {
        return (await response.json()) as { status: string; message?: string }
      }

      return null
    } catch (err) {
      console.error('[AzureFace] Erro ao verificar treinamento:', err)
      return null
    }
  }

  /**
   * Detecta faces em uma imagem (base64)
   */
  async detectFaces(base64Image: string): Promise<DetectedFace[]> {
    try {
      const base64Data = base64Image.replace(/^data:image\/\w+;base64,/, '')
      const imageBuffer = Buffer.from(base64Data, 'base64')

      const response = await fetch(
        `${this.baseUrl}/face/v1.0/detect?returnFaceId=true&detectionModel=detection_03&recognitionModel=recognition_04`,
        {
          method: 'POST',
          headers: {
            'Ocp-Apim-Subscription-Key': AZURE_FACE_KEY,
            'Content-Type': 'application/octet-stream',
          },
          body: imageBuffer,
        }
      )

      if (response.ok) {
        return (await response.json()) as DetectedFace[]
      }

      const error = (await response.json()) as AzureError
      console.error('[AzureFace] Erro ao detectar faces:', error)
      return []
    } catch (err) {
      console.error('[AzureFace] Erro ao detectar faces:', err)
      return []
    }
  }

  /**
   * Identifica faces contra o Person Group
   */
  async identifyFaces(
    faceIds: string[],
    maxCandidates: number = 1,
    confidenceThreshold: number = 0.6
  ): Promise<IdentifyResult[]> {
    try {
      const response = await fetch(`${this.baseUrl}/face/v1.0/identify`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({
          personGroupId: PERSON_GROUP_ID,
          faceIds,
          maxNumOfCandidatesReturned: maxCandidates,
          confidenceThreshold,
        }),
      })

      if (response.ok) {
        return (await response.json()) as IdentifyResult[]
      }

      const error = (await response.json()) as AzureError
      console.error('[AzureFace] Erro ao identificar faces:', error)
      return []
    } catch (err) {
      console.error('[AzureFace] Erro ao identificar faces:', err)
      return []
    }
  }

  /**
   * Busca informações de uma Person
   */
  async getPerson(personId: string): Promise<Person | null> {
    try {
      const response = await fetch(
        `${this.baseUrl}/face/v1.0/persongroups/${PERSON_GROUP_ID}/persons/${personId}`,
        { headers: this.headers }
      )

      if (response.ok) {
        return (await response.json()) as Person
      }

      return null
    } catch (err) {
      console.error('[AzureFace] Erro ao buscar Person:', err)
      return null
    }
  }

  /**
   * Lista todas as Persons do grupo
   */
  async listPersons(): Promise<Person[]> {
    try {
      const response = await fetch(
        `${this.baseUrl}/face/v1.0/persongroups/${PERSON_GROUP_ID}/persons`,
        { headers: this.headers }
      )

      if (response.ok) {
        return (await response.json()) as Person[]
      }

      return []
    } catch (err) {
      console.error('[AzureFace] Erro ao listar Persons:', err)
      return []
    }
  }

  /**
   * Remove uma Person
   */
  async deletePerson(personId: string): Promise<boolean> {
    try {
      const response = await fetch(
        `${this.baseUrl}/face/v1.0/persongroups/${PERSON_GROUP_ID}/persons/${personId}`,
        {
          method: 'DELETE',
          headers: this.headers,
        }
      )

      return response.ok || response.status === 200
    } catch (err) {
      console.error('[AzureFace] Erro ao deletar Person:', err)
      return false
    }
  }

  /**
   * Método completo: Detecta e identifica face em uma única chamada
   */
  async recognizeFace(base64Image: string): Promise<{
    success: boolean
    personId?: string
    personName?: string
    confidence?: number
    userData?: string
    error?: string
  }> {
    // 1. Detectar faces na imagem
    const faces = await this.detectFaces(base64Image)

    if (faces.length === 0) {
      return { success: false, error: 'Nenhuma face detectada' }
    }

    if (faces.length > 1) {
      return { success: false, error: 'Múltiplas faces detectadas' }
    }

    // 2. Identificar a face
    const faceId = faces[0].faceId
    const results = await this.identifyFaces([faceId])

    if (results.length === 0 || results[0].candidates.length === 0) {
      return { success: false, error: 'Face não reconhecida' }
    }

    const candidate = results[0].candidates[0]

    // 3. Buscar dados da Person
    const person = await this.getPerson(candidate.personId)

    if (!person) {
      return { success: false, error: 'Pessoa não encontrada' }
    }

    return {
      success: true,
      personId: candidate.personId,
      personName: person.name,
      confidence: candidate.confidence,
      userData: person.userData,
    }
  }
}

export const azureFaceService = new AzureFaceService()
export default azureFaceService
