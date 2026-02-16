/*
|--------------------------------------------------------------------------
| Serviço de Comunicação com REP Control iD
|--------------------------------------------------------------------------
|
| API REST do Control iD para:
| - Buscar registros de ponto (AFD)
| - Cadastrar funcionários
| - Sincronizar biometrias
|
*/

interface RegistroPonto {
  id: number
  time: number
  event: number
  user_id: number
  portal_id?: number
}

interface Usuario {
  id: number
  name: string
  registration?: string
  pis?: string
}

export class ControlIdService {
  private baseUrl: string
  private session: string | null = null
  
  constructor(ip: string, porta: number = 80) {
    this.baseUrl = `http://${ip}:${porta}`
  }
  
  /**
   * Login no REP
   */
  async login(usuario: string = 'admin', senha: string = 'admin'): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/login.fcgi`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login: usuario, password: senha })
      })
      
      const data = await response.json()
      
      if (data.session) {
        this.session = data.session
        console.log(`[ControlID] ✅ Login OK - Session: ${this.session}`)
        return true
      }
      
      console.log('[ControlID] ❌ Login falhou')
      return false
    } catch (error: any) {
      console.error('[ControlID] Erro no login:', error.message)
      return false
    }
  }
  
  /**
   * Buscar registros de ponto (AFD)
   */
  async buscarRegistros(aPartirDe?: Date): Promise<RegistroPonto[]> {
    if (!this.session) {
      const ok = await this.login()
      if (!ok) return []
    }
    
    try {
      const params: any = {
        session: this.session
      }
      
      // Filtro por data inicial
      if (aPartirDe) {
        params.initial_time = Math.floor(aPartirDe.getTime() / 1000)
      }
      
      const response = await fetch(`${this.baseUrl}/get_afd.fcgi?${new URLSearchParams(params)}`)
      const text = await response.text()
      
      // AFD vem em formato texto, uma linha por registro
      // Formato: NSR|TIPO|DATA|HORA|PIS
      const registros: RegistroPonto[] = []
      const linhas = text.trim().split('\n')
      
      for (const linha of linhas) {
        if (!linha.trim()) continue
        // Parse do AFD - ajustar conforme formato real
        try {
          const json = JSON.parse(linha)
          registros.push(json)
        } catch {
          // Formato texto legado
          console.log('[ControlID] Linha AFD:', linha)
        }
      }
      
      console.log(`[ControlID] ${registros.length} registros encontrados`)
      return registros
    } catch (error: any) {
      console.error('[ControlID] Erro ao buscar registros:', error.message)
      return []
    }
  }
  
  /**
   * Buscar logs de acesso (access_logs)
   */
  async buscarLogs(limite: number = 100): Promise<any[]> {
    if (!this.session) {
      const ok = await this.login()
      if (!ok) return []
    }
    
    try {
      const response = await fetch(`${this.baseUrl}/access_logs.fcgi?session=${this.session}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          limit: limite,
          order: 'desc'
        })
      })
      
      const data = await response.json()
      console.log(`[ControlID] ${data.access_logs?.length || 0} logs encontrados`)
      return data.access_logs || []
    } catch (error: any) {
      console.error('[ControlID] Erro ao buscar logs:', error.message)
      return []
    }
  }
  
  /**
   * Buscar usuários cadastrados no REP
   */
  async buscarUsuarios(): Promise<Usuario[]> {
    if (!this.session) {
      const ok = await this.login()
      if (!ok) return []
    }
    
    try {
      const response = await fetch(`${this.baseUrl}/users.fcgi?session=${this.session}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      })
      
      const data = await response.json()
      console.log(`[ControlID] ${data.users?.length || 0} usuários no REP`)
      return data.users || []
    } catch (error: any) {
      console.error('[ControlID] Erro ao buscar usuários:', error.message)
      return []
    }
  }
  
  /**
   * Cadastrar usuário no REP
   */
  async cadastrarUsuario(usuario: Usuario): Promise<boolean> {
    if (!this.session) {
      const ok = await this.login()
      if (!ok) return false
    }
    
    try {
      const response = await fetch(`${this.baseUrl}/users.fcgi?session=${this.session}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          users: [usuario]
        })
      })
      
      const data = await response.json()
      return data.users?.length > 0
    } catch (error: any) {
      console.error('[ControlID] Erro ao cadastrar usuário:', error.message)
      return false
    }
  }
  
  /**
   * Informações do dispositivo
   */
  async info(): Promise<any> {
    try {
      const response = await fetch(`${this.baseUrl}/system_information.fcgi`)
      return await response.json()
    } catch (error: any) {
      console.error('[ControlID] Erro ao buscar info:', error.message)
      return null
    }
  }
  
  /**
   * Logout
   */
  async logout(): Promise<void> {
    if (this.session) {
      try {
        await fetch(`${this.baseUrl}/logout.fcgi?session=${this.session}`)
      } catch {}
      this.session = null
    }
  }
}

export default ControlIdService
