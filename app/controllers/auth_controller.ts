import type { HttpContext } from '@adonisjs/core/http'
import User from '#models/user'
import Municipio from '#models/municipio'
import TwoFactorService from '#services/two_factor_service'
import { DateTime } from 'luxon'

export default class AuthController {
  async showLogin({ view, auth, response }: HttpContext) {
    if (await auth.check()) {
      return response.redirect().toRoute('selecionar-municipio')
    }
    return view.render('pages/auth/login')
  }

  async login({ request, response, auth, session }: HttpContext) {
    const { login, senha } = request.only(['login', 'senha'])

    try {
      const user = await User.verifyCredentials(login, senha)

      if (!user.ativo) {
        session.flash('error', 'Usuario inativo. Entre em contato com o administrador.')
        return response.redirect().back()
      }

      const has2FA = await TwoFactorService.is2FAAtivo(user.id)

      if (has2FA) {
        const trustedDeviceToken = request.cookie('trusted_device')

        if (trustedDeviceToken) {
          const isDeviceTrusted = await TwoFactorService.verificarDispositivoConfiavel(
            user.id,
            trustedDeviceToken
          )

          if (isDeviceTrusted) {
            await auth.use('web').login(user)
            user.ultimoLogin = DateTime.now()
            await user.save()

            if (user.municipioId) {
              session.put('municipioId', user.municipioId)
              return response.redirect().toRoute('dashboard')
            }

            return response.redirect().toRoute('selecionar-municipio')
          }
        }

        session.put('pending_2fa_user_id', user.id)
        session.put('pending_2fa_login', login)

        const sendResult = await TwoFactorService.enviarCodigo(user.id)

        if (!sendResult.success) {
          session.flash('error', sendResult.error || 'Falha ao enviar codigo 2FA')
          return response.redirect().back()
        }

        session.flash('info', sendResult.message || 'Codigo enviado')
        return response.redirect().toRoute('verificar-codigo')
      }

      await auth.use('web').login(user)
      user.ultimoLogin = DateTime.now()
      await user.save()

      if (user.municipioId) {
        session.put('municipioId', user.municipioId)
        return response.redirect().toRoute('dashboard')
      }

      return response.redirect().toRoute('selecionar-municipio')
    } catch (error) {
      console.error('Erro no login:', error)
      session.flash('error', 'Usuario ou senha invalidos')
      return response.redirect().back()
    }
  }

  async showVerificarCodigo({ view, session, response }: HttpContext) {
    const pendingUserId = session.get('pending_2fa_user_id')

    if (!pendingUserId) {
      return response.redirect().toRoute('login')
    }

    return view.render('pages/auth/verificar-codigo')
  }

  async verificarCodigo({ request, response, auth, session }: HttpContext) {
    const { codigo, confiar_dispositivo } = request.only(['codigo', 'confiar_dispositivo'])
    const ip = request.ip()
    const userAgent = request.header('user-agent') || ''

    const pendingUserId = session.get('pending_2fa_user_id')

    if (!pendingUserId) {
      session.flash('error', 'Sessao expirada. Faca login novamente.')
      return response.redirect().toRoute('login')
    }

    const verifyResult = await TwoFactorService.verificarCodigo(pendingUserId, codigo)

    if (!verifyResult.success) {
      session.flash('error', verifyResult.error || 'Codigo invalido')
      return response.redirect().back()
    }

    const user = await User.find(pendingUserId)

    if (!user) {
      session.flash('error', 'Usuario nao encontrado')
      return response.redirect().toRoute('login')
    }

    session.forget('pending_2fa_user_id')
    session.forget('pending_2fa_login')

    await auth.use('web').login(user)
    user.ultimoLogin = DateTime.now()
    await user.save()

    if (confiar_dispositivo) {
      const trustResult = await TwoFactorService.confiarDispositivo(pendingUserId, ip, userAgent)
      if (trustResult.success && trustResult.tokenDispositivo) {
        response.cookie('trusted_device', trustResult.tokenDispositivo, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          maxAge: 30 * 24 * 60 * 60 * 1000,
          sameSite: 'lax',
          path: '/',
        })
      }
    }

    session.flash('success', 'Login realizado com sucesso!')

    if (user.municipioId) {
      session.put('municipioId', user.municipioId)
      return response.redirect().toRoute('dashboard')
    }

    return response.redirect().toRoute('selecionar-municipio')
  }

  async reenviarCodigo({ response, session }: HttpContext) {
    const pendingUserId = session.get('pending_2fa_user_id')

    if (!pendingUserId) {
      session.flash('error', 'Sessao expirada. Faca login novamente.')
      return response.redirect().toRoute('login')
    }

    const sendResult = await TwoFactorService.enviarCodigo(pendingUserId)

    if (sendResult.success) {
      session.flash('success', sendResult.message || 'Codigo reenviado')
    } else {
      session.flash('error', sendResult.error || 'Falha ao reenviar codigo')
    }

    return response.redirect().back()
  }

  async showSelecionarMunicipio({ view, auth, response, tenant }: HttpContext) {
    if (!(await auth.check())) {
      return response.redirect().toRoute('login')
    }

    if (auth.user?.municipioId && !tenant.isSuperAdmin) {
      return response.redirect().toRoute('dashboard')
    }

    const municipios = await Municipio.query()
      .where('ativo', true)
      .where('status', true)
      .orderBy('nome', 'asc')

    return view.render('pages/auth/selecionar-municipio', { municipios })
  }

  async selecionarMunicipio({ request, response, session, auth }: HttpContext) {
    const municipioId = request.input('municipio_id')

    if (!municipioId) {
      session.flash('error', 'Selecione um municipio')
      return response.redirect().back()
    }

    const municipio = await Municipio.query()
      .where('id', municipioId)
      .where('ativo', true)
      .first()

    if (!municipio) {
      session.flash('error', 'Municipio nao encontrado ou inativo')
      return response.redirect().back()
    }

    session.put('municipioId', municipio.id)

    if (auth.user) {
      auth.user.ultimoMunicipioAcessado = municipio.id
      await auth.user.save()
    }

    return response.redirect().toRoute('dashboard')
  }

  async logout({ auth, response, session }: HttpContext) {
    await auth.use('web').logout()
    session.forget('municipioId')
    return response.redirect().toRoute('login')
  }

  async trocarMunicipio({ response, session }: HttpContext) {
    session.forget('municipioId')
    return response.redirect().toRoute('selecionar-municipio')
  }
}
