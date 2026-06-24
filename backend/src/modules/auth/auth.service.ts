import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { CredentialVaultService } from "../../common/crypto/credential-vault.service";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AccountAccessTokenService } from "../accounts/account-access-token.service";
import { StudentIdentityService } from "../accounts/student-identity.service";
import { ProviderRegistryService } from "../providers/provider-registry.service";
import { DataTarget } from "../providers/provider.types";
import { CloudCredentialSyncService } from "../sync/cloud-credential-sync.service";
import { CourseSyncService } from "../sync/course-sync.service";
import { verifyFrontendCloudImportProof } from "../sync/frontend-cloud-import-proof";
import {
  LoginCacheResult,
  LoginSubmitRequest,
  LoginSubmitResponse,
} from "./auth.types";

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly studentIdentity: StudentIdentityService,
    private readonly providers: ProviderRegistryService,
    private readonly credentialVault: CredentialVaultService,
    private readonly courseSync: CourseSyncService,
    private readonly cloudSync: CloudCredentialSyncService,
    private readonly accountAccessTokens: AccountAccessTokenService,
  ) {}

  async bindWechatOpenid(accountId: string, openid: string) {
    const cleanOpenid = this.normalizeOpenid(openid);

    if (!cleanOpenid) {
      throw new BadRequestException("openid is required");
    }

    await this.prisma.studentAccount.update({
      where: { id: accountId },
      data: { wechatOpenid: cleanOpenid },
    });

    return { success: true };
  }

  async submitLogin(
    schoolId: string,
    input: LoginSubmitRequest,
  ): Promise<LoginSubmitResponse> {
    const existingSchool = await this.prisma.school.findUnique({
      where: { id: schoolId },
    });

    if (!existingSchool) {
      throw new NotFoundException("School not found");
    }

    this.assertSchoolAvailable(existingSchool);

    if (!input.contextId) {
      throw new BadRequestException("contextId is required");
    }

    const providerId = existingSchool.providerId ?? schoolId;
    const loginMode = existingSchool.loginMode ?? "direct_password";
    const credentialSaveMode = this.getCredentialSaveMode(providerId, input);
    const hasCredentials = Boolean(input.username && input.password);
    const frontendCloudCacheResults = this.getVerifiedFrontendCloudCacheResults(
      existingSchool.id,
      providerId,
      input,
    );

    if (credentialSaveMode === "password_vault" && !hasCredentials) {
      throw new BadRequestException(
        "verified username and password are required when saving credentials",
      );
    }
    const backendImportTargets = this.getBackendImportTargets({
      providerId,
      schoolConfig: existingSchool.config,
      dataAccess: existingSchool.dataAccess,
      capabilities: existingSchool.capabilities,
    });
    const shouldRunBackendImport = hasCredentials && backendImportTargets.length > 0;
    const shouldBindStudentNoBeforeImport = Boolean(input.accountId);

    const authStatePatch =
      credentialSaveMode === "password_vault" && input.username && input.password
        ? {
            credentialVault: {
              username: this.credentialVault.encrypt(input.username),
              password: this.credentialVault.encrypt(input.password),
              savedAt: new Date().toISOString(),
              providerId,
            },
          }
        : undefined;
    const authState = this.toJson({
      contextId: input.contextId,
      loginMode,
      frontendFirst: true,
      frontendCloudImport: frontendCloudCacheResults.length > 0,
      backendCredentialImport: shouldRunBackendImport,
      cloudVerified: frontendCloudCacheResults.length > 0,
      cloudVerifiedAt: frontendCloudCacheResults.length
        ? new Date().toISOString()
        : undefined,
      cloudWarnings: input.cloudWarnings,
      ...(authStatePatch || {}),
    });
    let account = input.accountId
      ? await this.updateExistingAccountAfterLogin({
          accountId: input.accountId,
          schoolId,
          providerId,
          authState,
          credentialSaveMode,
        })
      : await this.studentIdentity.findOrCreateAccount({
          schoolId,
          providerId,
          studentNo: shouldBindStudentNoBeforeImport ? input.username : undefined,
          data: {
            status: "need_login",
            authState,
            cacheState: {},
            sessionReusable: false,
            sessionRefreshable: false,
            credentialSaveMode,
            lastLoginAt: new Date(),
            lastAuthErrorCode: null,
            lastAuthErrorAt: null,
          },
        });

    if (frontendCloudCacheResults.length) {
      const verifiedIdentity = this.getVerifiedIdentityFromCacheResults(
        frontendCloudCacheResults,
        input.username,
      );

      if (verifiedIdentity.studentNo) {
        account = await this.studentIdentity.bindStudentIdentity({
          accountId: account.id,
          schoolId,
          providerId,
          studentNo: verifiedIdentity.studentNo,
          displayName: verifiedIdentity.displayName,
          authState,
          mergeExisting: true,
        });
      }

      return this.writeCloudLoginCaches({
        accountId: account.id,
        cacheResults: frontendCloudCacheResults,
        credentialSaveMode,
        authStatePatch: {
          ...this.asRecord(account.authState),
          ...this.asRecord(authState),
          cloudVerified: true,
          cloudVerifiedAt: new Date().toISOString(),
          frontendCloudImport: true,
          cloudWarnings: input.cloudWarnings,
        },
      });
    }

    if (input.verifiedByCloud || (input.cacheResults && input.cacheResults.length)) {
      throw new BadRequestException(
        "CLIENT_CACHE_RESULTS_UNTRUSTED: cloud cache results require a valid cloudProof",
      );
    }

    if (shouldRunBackendImport) {
      const cloudResult = await this.cloudSync.syncByCredentials({
        schoolId,
        providerId,
        targets: backendImportTargets,
        username: input.username || "",
        password: input.password || "",
        config: existingSchool.config,
      });
      const verifiedIdentity = this.getVerifiedIdentityFromCacheResults(
        cloudResult.cacheResults,
        input.username,
      );

      if (verifiedIdentity.studentNo) {
        account = await this.studentIdentity.bindStudentIdentity({
          accountId: account.id,
          schoolId,
          providerId,
          studentNo: verifiedIdentity.studentNo,
          displayName: verifiedIdentity.displayName,
          authState,
          mergeExisting: true,
        });
      }

      const authStatePatch = {
        ...this.asRecord(account.authState),
        ...this.asRecord(authState),
        cloudVerified: true,
        cloudVerifiedAt: new Date().toISOString(),
        cloudWarnings: cloudResult.warnings,
      };
      return this.writeCloudLoginCaches({
        accountId: account.id,
        cacheResults: cloudResult.cacheResults,
        credentialSaveMode,
        authStatePatch,
      });
    }

    const accountAccessToken = await this.accountAccessTokens.issueToken(
      account.id,
      "login",
    );

    return {
      accountId: account.id,
      accountAccessToken: accountAccessToken.token,
      accountAccessTokenExpiresAt: accountAccessToken.expiresAt,
      status: "need_webview_fetch",
      sessionReusable: false,
      requiredFetchTargets: this.getRequiredFetchTargets(
        existingSchool.capabilities,
      ),
    };
  }

  async importSession(
    schoolId: string,
    input: { contextId?: string; accountId?: string; session?: unknown },
  ) {
    const school = await this.prisma.school.findUnique({
      where: { id: schoolId },
    });

    if (!school) {
      throw new NotFoundException("School not found");
    }

    this.assertSchoolAvailable(school);

    const account = input.accountId
      ? await this.prisma.studentAccount.findUnique({
          where: { id: input.accountId },
        })
      : await this.createWebviewAccount(
          schoolId,
          school.providerId ?? schoolId,
          input.contextId,
        );

    if (!account) {
      throw new NotFoundException("Student account not found");
    }

    await this.prisma.studentAccount.update({
      where: { id: account.id },
      data: {
        status: "need_login",
        authState: {
          contextId: input.contextId,
          loginMode: school.loginMode ?? "cas_webview",
          sessionImportAttempted: true,
        },
        lastAuthErrorCode: "SESSION_IMPORT_FAILED",
        lastAuthErrorAt: new Date(),
      },
    });

    return {
      status: "need_webview_client_fetch",
      accountId: account.id,
      ...(await this.getIssuedAccessTokenPayload(account.id)),
      requiredFetchTargets: ["course"],
      message:
        "Session import is not available for this provider. Fetch data inside WebView and upload raw-data.",
    };
  }

  private async createWebviewAccount(
    schoolId: string,
    providerId: string,
    contextId?: string,
  ) {
    return this.studentIdentity.findOrCreateAccount({
      schoolId,
      providerId,
      data: {
        status: "need_login",
        authState: {
          contextId,
          loginMode: "cas_webview",
        },
        cacheState: {},
        sessionReusable: false,
        sessionRefreshable: false,
        credentialSaveMode: "none",
        lastLoginAt: new Date(),
      },
    });
  }

  private async updateExistingAccountAfterLogin(input: {
    accountId: string;
    schoolId: string;
    providerId: string;
    authState: Prisma.InputJsonValue;
    credentialSaveMode: "none" | "password_vault";
  }) {
    const account = await this.prisma.studentAccount.findUnique({
      where: { id: input.accountId },
    });

    if (!account || account.schoolId !== input.schoolId) {
      throw new NotFoundException("Student account not found");
    }

    return this.prisma.studentAccount.update({
      where: { id: account.id },
      data: {
        providerId: input.providerId,
        authState: input.authState,
        credentialSaveMode: input.credentialSaveMode,
        lastLoginAt: new Date(),
        lastAuthErrorCode: null,
        lastAuthErrorAt: null,
      },
    });
  }

  private getVerifiedIdentityFromCacheResults(
    cacheResults: Array<{ target: DataTarget; cacheData: Record<string, unknown> }>,
    fallbackStudentNo?: string,
  ) {
    const profile = cacheResults.find((item) => item.target === "profile")?.cacheData;

    return {
      studentNo:
        this.studentIdentity.extractStudentNo(profile) ||
        this.studentIdentity.extractStudentNo(cacheResults[0]?.cacheData) ||
        fallbackStudentNo,
      displayName:
        this.studentIdentity.extractDisplayName(profile) ||
        this.studentIdentity.extractDisplayName(cacheResults[0]?.cacheData),
    };
  }

  private getCredentialSaveMode(
    providerId: string,
    input: LoginSubmitRequest,
  ): "none" | "password_vault" {
    if (input.credentialSaveMode !== "password_vault") {
      return "none";
    }

    const provider = this.providers.getProvider(providerId);

    if (!provider.meta.credentialSave?.passwordVaultAllowed) {
      throw new BadRequestException(
        "CREDENTIAL_SAVE_UNSUPPORTED: this school does not support saved credentials",
      );
    }

    return "password_vault";
  }

  private getVerifiedFrontendCloudCacheResults(
    schoolId: string,
    providerId: string,
    input: LoginSubmitRequest,
  ): LoginCacheResult[] {
    if (!input.verifiedByCloud && !input.cloudProof && !input.cacheResults?.length) {
      return [];
    }

    if (!input.verifiedByCloud || !input.cacheResults?.length || !input.cloudProof) {
      throw new BadRequestException(
        "CLIENT_CACHE_RESULTS_UNTRUSTED: cloud cache results require a valid cloudProof",
      );
    }

    return verifyFrontendCloudImportProof({
      proof: input.cloudProof,
      cacheResults: input.cacheResults,
      schoolId,
      providerId,
      contextId: input.contextId,
    });
  }

  private async writeCloudLoginCaches(input: {
    accountId: string;
    cacheResults: LoginCacheResult[];
    credentialSaveMode: "none" | "password_vault";
    authStatePatch: Record<string, unknown>;
  }): Promise<LoginSubmitResponse> {
    const writtenCaches = [];

    for (const cacheResult of input.cacheResults) {
      const cache = await this.courseSync.writeCloudCacheResult({
        accountId: input.accountId,
        target: cacheResult.target,
        cacheData: cacheResult.cacheData,
        credentialSaveMode: input.credentialSaveMode,
        authStatePatch: input.authStatePatch,
      });
      writtenCaches.push({ input: cacheResult, cache });
    }

    const primary =
      writtenCaches.find((item) => item.input.target === "course") ??
      writtenCaches[0];
    const savedTargets = writtenCaches.map((item) => item.input.target);
    const cacheResults = (await this.courseSync.getLatestCacheResults(input.accountId))
      .filter((item) => savedTargets.includes(item.target));
    const accountAccessToken = await this.accountAccessTokens.issueToken(
      input.accountId,
      "login",
    );

    return {
      accountId: input.accountId,
      accountAccessToken: accountAccessToken.token,
      accountAccessTokenExpiresAt: accountAccessToken.expiresAt,
      status: "cached",
      sessionReusable: false,
      requiredFetchTargets: [],
      cacheId: primary?.cache.cacheId,
      parsedCount: primary?.input.parsedCount ?? primary?.cache.parsedCount,
      savedTargets,
      ...(cacheResults.length ? { cacheResults } : {}),
    };
  }

  private normalizeOpenid(value: unknown) {
    return typeof value === "string" && value.trim() ? value.trim() : "";
  }

  private getRequiredFetchTargets(capabilities: unknown): DataTarget[] {
    const source =
      capabilities && typeof capabilities === "object" && !Array.isArray(capabilities)
        ? (capabilities as Partial<Record<DataTarget, unknown>>)
        : {};

    if (source.course) {
      return ["course"];
    }

    for (const target of ["profile", "score", "exam"] as DataTarget[]) {
      if (source[target]) {
        return [target];
      }
    }

    return ["course"];
  }

  private assertSchoolAvailable(school: { enabled: boolean; status: string }) {
    if (!school.enabled || school.status !== "enabled") {
      throw new NotFoundException("School not available");
    }
  }

  private toJson(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
  }

  private asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private getBackendImportTargets(input: {
    providerId: string;
    schoolConfig: unknown;
    dataAccess: unknown;
    capabilities: unknown;
  }): DataTarget[] {
    const provider = (() => {
      try {
        return this.providers.getProvider(input.providerId);
      } catch {
        return null;
      }
    })();

    if (
      !provider?.meta.credentialSave ||
      provider.meta.credentialSave.autoSync !== "password_login"
    ) {
      return [];
    }

    if (!process.env.CSCHEDULE_WORKER_SECRET) {
      return [];
    }

    const capabilities = this.asRecord(input.capabilities);
    const candidates = ["course", "profile", "score", "exam"] as DataTarget[];
    const targets = candidates.filter((target) => {
      return (
        Boolean(capabilities[target]) &&
        this.asDataAccessTarget(input.dataAccess, target).includes("cloud_worker")
      );
    });

    if (!targets.includes("course")) {
      return [];
    }

    const supportedTargets: DataTarget[] = [];

    for (const target of targets) {
      const sharedTargets = [...supportedTargets, target];

      if (this.cloudSync.getSharedCloudFunction(input.schoolConfig, sharedTargets)) {
        supportedTargets.push(target);
      }
    }

    return supportedTargets;
  }

  private asDataAccessTarget(value: unknown, target: DataTarget) {
    const source = this.asRecord(value);
    const access = source[target];

    return Array.isArray(access)
      ? access.filter((item): item is string => typeof item === "string")
      : [];
  }

  private async getIssuedAccessTokenPayload(accountId: string) {
    const accountAccessToken = await this.accountAccessTokens.issueToken(
      accountId,
      "session-import",
    );

    return {
      accountAccessToken: accountAccessToken.token,
      accountAccessTokenExpiresAt: accountAccessToken.expiresAt,
    };
  }
}
