import { BadRequestException } from '@nestjs/common'
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

import { LoginCacheResult, LoginCloudProof } from '../auth/auth.types'
import { DataTarget } from '../providers/provider.types'

const CLIENT_IMPORT_TOKEN_TTL_MS = 10 * 60 * 1000
const CLOUD_PROOF_MAX_CLOCK_SKEW_MS = 60 * 1000
const FRONTEND_IMPORT_SOURCE = 'frontend_cloud_import'

interface ClientImportTokenPayload {
  version: 1
  source: typeof FRONTEND_IMPORT_SOURCE
  schoolId: string
  providerId: string
  contextId: string
  targets: DataTarget[]
  expiresAt: string
}

export function canIssueFrontendCloudImportToken() {
  return Boolean(getWorkerSecret())
}

export function createFrontendCloudImportToken(input: {
  schoolId: string
  providerId: string
  contextId: string
  targets: DataTarget[]
}) {
  const secret = getRequiredWorkerSecret()
  const expiresAt = new Date(Date.now() + CLIENT_IMPORT_TOKEN_TTL_MS).toISOString()
  const payload: ClientImportTokenPayload = {
    version: 1,
    source: FRONTEND_IMPORT_SOURCE,
    schoolId: input.schoolId,
    providerId: input.providerId,
    contextId: input.contextId,
    targets: normalizeTargets(input.targets),
    expiresAt,
  }
  const encodedPayload = Buffer.from(stableStringify(payload)).toString('base64url')
  const signature = hmacHex(secret, encodedPayload)

  return {
    token: `${encodedPayload}.${signature}`,
    expiresAt,
  }
}

export function verifyFrontendCloudImportProof(input: {
  proof: LoginCloudProof | undefined
  cacheResults: LoginCacheResult[]
  schoolId: string
  providerId: string
  contextId: string
}) {
  const secret = getRequiredWorkerSecret()
  const proof = input.proof

  if (!proof || typeof proof !== 'object') {
    throw new BadRequestException('CLOUD_IMPORT_PROOF_REQUIRED')
  }

  const normalizedResults = normalizeCacheResultsForProof(input.cacheResults)

  if (normalizedResults.length === 0) {
    throw new BadRequestException('CLOUD_IMPORT_CACHE_RESULTS_REQUIRED')
  }

  if (
    proof.version !== 1 ||
    proof.source !== FRONTEND_IMPORT_SOURCE ||
    proof.schoolId !== input.schoolId ||
    proof.providerId !== input.providerId ||
    proof.contextId !== input.contextId
  ) {
    throw new BadRequestException('CLOUD_IMPORT_PROOF_INVALID')
  }

  const expiresAtMs = Date.parse(proof.expiresAt || '')

  if (
    !Number.isFinite(expiresAtMs) ||
    expiresAtMs + CLOUD_PROOF_MAX_CLOCK_SKEW_MS <= Date.now()
  ) {
    throw new BadRequestException('CLOUD_IMPORT_PROOF_EXPIRED')
  }

  const resultHash = hashCacheResults(normalizedResults)

  if (proof.resultHash !== resultHash) {
    throw new BadRequestException('CLOUD_IMPORT_RESULT_MISMATCH')
  }

  const payload = {
    version: proof.version,
    source: proof.source,
    schoolId: proof.schoolId,
    providerId: proof.providerId,
    contextId: proof.contextId,
    targets: normalizeTargets(proof.targets),
    resultHash: proof.resultHash,
    issuedAt: proof.issuedAt,
    expiresAt: proof.expiresAt,
  }
  const expectedSignature = hmacHex(secret, stableStringify(payload))

  if (!safeEqualHex(proof.signature, expectedSignature)) {
    throw new BadRequestException('CLOUD_IMPORT_PROOF_INVALID')
  }

  return normalizedResults.map((item) => ({
    ...item,
    cacheData: withCacheResultMeta(item),
  }))
}

function normalizeCacheResultsForProof(cacheResults: LoginCacheResult[]) {
  return (Array.isArray(cacheResults) ? cacheResults : []).flatMap((item) => {
    if (
      !(
        item &&
        ['course', 'score', 'exam', 'profile'].includes(item.target) &&
        item.cacheData &&
        typeof item.cacheData === 'object' &&
        !Array.isArray(item.cacheData)
      )
    ) {
      return []
    }

    return [
      {
        target: item.target,
        ...(typeof item.termId === 'string' && item.termId
          ? { termId: item.termId }
          : {}),
        cacheData: item.cacheData,
        ...(typeof item.parsedCount === 'number'
          ? { parsedCount: item.parsedCount }
          : {}),
        ...(typeof item.sourceHash === 'string' && item.sourceHash
          ? { sourceHash: item.sourceHash }
          : {}),
        ...(typeof item.syncedAt === 'string' && item.syncedAt
          ? { syncedAt: item.syncedAt }
          : {}),
        ...(Array.isArray(item.warnings) ? { warnings: item.warnings } : {}),
      },
    ]
  })
}

function hashCacheResults(cacheResults: LoginCacheResult[]) {
  return createHash('sha256')
    .update(stableStringify(cacheResults))
    .digest('hex')
}

function withCacheResultMeta(
  cacheResult: LoginCacheResult,
): Record<string, unknown> {
  return {
    ...cacheResult.cacheData,
    ...(cacheResult.termId ? { termId: cacheResult.termId } : {}),
    ...(cacheResult.sourceHash ? { sourceHash: cacheResult.sourceHash } : {}),
    ...(cacheResult.syncedAt ? { syncedAt: cacheResult.syncedAt } : {}),
  }
}

function normalizeTargets(targets: DataTarget[]) {
  return [...new Set(
    (Array.isArray(targets) ? targets : []).filter((target): target is DataTarget =>
      ['course', 'score', 'exam', 'profile'].includes(target),
    ),
  )]
}

function getRequiredWorkerSecret() {
  const secret = getWorkerSecret()

  if (!secret) {
    throw new BadRequestException('CLOUD_IMPORT_SECRET_NOT_CONFIGURED')
  }

  return secret
}

function getWorkerSecret() {
  return String(process.env.CSCHEDULE_WORKER_SECRET || '').trim()
}

function hmacHex(secret: string, value: string) {
  return createHmac('sha256', secret).update(value).digest('hex')
}

function safeEqualHex(left: unknown, right: string) {
  if (typeof left !== 'string' || !/^[0-9a-f]+$/i.test(left)) {
    return false
  }

  const leftBuffer = Buffer.from(left, 'hex')
  const rightBuffer = Buffer.from(right, 'hex')

  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  )
}

function stableStringify(value: unknown) {
  return JSON.stringify(normalizeForJson(value))
}

function normalizeForJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeForJson)
  }

  if (!value || typeof value !== 'object') {
    return value
  }

  return Object.keys(value as Record<string, unknown>)
    .sort()
    .reduce<Record<string, unknown>>((result, key) => {
      const nextValue = (value as Record<string, unknown>)[key]

      if (nextValue !== undefined) {
        result[key] = normalizeForJson(nextValue)
      }

      return result
    }, {})
}
