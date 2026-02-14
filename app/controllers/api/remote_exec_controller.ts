import type { HttpContext } from "@adonisjs/core/http"
import { exec } from "node:child_process"
import { promisify } from "node:util"

const execAsync = promisify(exec)

// Chave secreta para autenticação
const ADMIN_SECRET = "ponto2024@remote#exec!key"

export default class RemoteExecController {
  /**
   * Executa comando no container
   * POST /api/admin/exec
   * Header: X-Admin-Key: <secret>
   * Body: { "command": "ls -la" }
   */
  async exec({ request, response }: HttpContext) {
    const adminKey = request.header("X-Admin-Key")
    
    if (adminKey !== ADMIN_SECRET) {
      return response.unauthorized({ error: "Chave inválida" })
    }

    const { command } = request.only(["command"])
    
    if (!command) {
      return response.badRequest({ error: "Comando não informado" })
    }

    try {
      const { stdout, stderr } = await execAsync(command, {
        timeout: 30000,
        maxBuffer: 1024 * 1024 * 10,
        cwd: "/app"
      })

      return response.json({
        success: true,
        stdout: stdout,
        stderr: stderr
      })
    } catch (error: any) {
      return response.json({
        success: false,
        error: error.message,
        stdout: error.stdout || "",
        stderr: error.stderr || ""
      })
    }
  }

  /**
   * Lê arquivo
   * POST /api/admin/read
   */
  async read({ request, response }: HttpContext) {
    const adminKey = request.header("X-Admin-Key")
    
    if (adminKey !== ADMIN_SECRET) {
      return response.unauthorized({ error: "Chave inválida" })
    }

    const { path } = request.only(["path"])
    
    if (!path) {
      return response.badRequest({ error: "Path não informado" })
    }

    try {
      const { stdout } = await execAsync(`cat "${path}"`, {
        timeout: 10000,
        maxBuffer: 1024 * 1024 * 10,
        cwd: "/app"
      })

      return response.json({
        success: true,
        content: stdout
      })
    } catch (error: any) {
      return response.json({
        success: false,
        error: error.message
      })
    }
  }

  /**
   * Escreve arquivo
   * POST /api/admin/write
   */
  async write({ request, response }: HttpContext) {
    const adminKey = request.header("X-Admin-Key")
    
    if (adminKey !== ADMIN_SECRET) {
      return response.unauthorized({ error: "Chave inválida" })
    }

    const { path, content } = request.only(["path", "content"])
    
    if (!path || content === undefined) {
      return response.badRequest({ error: "Path e content são obrigatórios" })
    }

    try {
      const fs = await import("node:fs/promises")
      await fs.writeFile(path, content, "utf-8")

      return response.json({
        success: true,
        message: "Arquivo salvo"
      })
    } catch (error: any) {
      return response.json({
        success: false,
        error: error.message
      })
    }
  }

  /**
   * Health check
   */
  async ping({ response }: HttpContext) {
    return response.json({ status: "ok", timestamp: new Date().toISOString() })
  }
}
