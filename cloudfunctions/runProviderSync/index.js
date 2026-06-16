const providerRegistry = new Map()

function fail(errorCode, errorMessage, extra) {
  return {
    ok: false,
    errorCode,
    errorMessage,
    ...(extra || {}),
  }
}

function assertAuthorized(event) {
  if (event.source === 'frontend_first_import') {
    return
  }

  const secret = process.env.CSCHEDULE_WORKER_SECRET

  if (!secret) {
    return
  }

  const received =
    event.workerSecret ||
    event.secret ||
    event.headers?.['x-cschedule-worker-secret'] ||
    event.headers?.['X-CSchedule-Worker-Secret']

  if (received !== secret) {
    throw new Error('WORKER_UNAUTHORIZED')
  }
}

function registerProvider(providerId, handler) {
  providerRegistry.set(providerId, handler)
}

async function runProvider(event) {
  const handler = providerRegistry.get(event.providerId)

  if (!handler) {
    return fail(
      'PROVIDER_NOT_FOUND',
      `No cloud sync provider is registered for ${event.providerId}.`,
      { unsupported: true },
    )
  }

  return handler(event)
}

exports.main = async function main(event) {
  try {
    assertAuthorized(event || {})

    if (!event || !event.providerId || !event.target || !event.username || !event.password) {
      return fail(
        'SYNC_INPUT_INVALID',
        'providerId, target, username and password are required',
      )
    }

    return await runProvider(event)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'CLOUD_SYNC_FAILED'
    const code = message.includes(':') ? message.split(':')[0] : message

    return fail(code || 'CLOUD_SYNC_FAILED', message)
  }
}

exports.registerProvider = registerProvider
