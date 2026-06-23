import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";

import { PrismaService } from "../../common/prisma/prisma.service";
import { StudentIdentityService } from "../accounts/student-identity.service";
import { ProviderDisplayService } from "../providers/provider-display.service";
import {
  DataTarget,
  SectionTimeProfileConfig,
} from "../providers/provider.types";

interface CloudFeatureResult {
  data: unknown;
  termId?: string;
  meta?: Record<string, unknown>;
}

export interface CachedDataResult {
  target: DataTarget;
  cacheData: Record<string, unknown>;
}

@Injectable()
export class CourseSyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly studentIdentity: StudentIdentityService,
    private readonly providerDisplay: ProviderDisplayService,
  ) {}

  async writeCloudCacheResult(input: {
    accountId: string;
    target: DataTarget;
    cacheData: Record<string, unknown>;
    credentialSaveMode?: "none" | "password_vault";
    authStatePatch?: Record<string, unknown>;
  }) {
    const account = await this.prisma.studentAccount.findUnique({
      where: { id: input.accountId },
      include: { school: true },
    });

    if (!account) {
      throw new NotFoundException("Student account not found");
    }

    const termId =
      typeof input.cacheData.termId === "string"
        ? input.cacheData.termId
        : undefined;
    const syncedAt = new Date();

    if (input.target === "course") {
      const courses = Array.isArray(input.cacheData.courses)
        ? input.cacheData.courses.map((course, index) =>
            this.normalizeCourse(course, index),
          )
        : [];
      const sourceHash = this.createCloudSourceHash({
        accountId: account.id,
        providerId: account.providerId,
        target: input.target,
        termId,
        data: courses,
      });
      const cache = await this.prisma.courseCache.upsert({
        where: {
          courseCacheAccountSourceHash: {
            accountId: account.id,
            sourceHash,
          },
        },
        update: {
          termId,
          coursesJson: this.toJson(courses),
          termsJson: this.toJson(input.cacheData.terms ?? []),
          sectionTimesJson: this.toJson(input.cacheData.sectionTimes ?? []),
          syncedAt,
        },
        create: {
          accountId: account.id,
          schoolId: account.schoolId,
          providerId: account.providerId,
          termId,
          coursesJson: this.toJson(courses),
          termsJson: this.toJson(input.cacheData.terms ?? []),
          sectionTimesJson: this.toJson(input.cacheData.sectionTimes ?? []),
          sourceHash,
          syncedAt,
        },
      });

      await this.updateAccountCacheState(
        account.id,
        "course",
        {
          termId,
          syncedAt,
          count: courses.length,
          credentialSaveMode: input.credentialSaveMode,
          authStatePatch: input.authStatePatch,
        },
      );

      return { cacheId: cache.id, parsedCount: courses.length, syncedAt };
    }

    const featureData = input.cacheData.data ?? null;
    const cache = await this.writeFeatureCache({
      account,
      target: input.target as Exclude<DataTarget, "course">,
      result: {
        termId,
        data: featureData,
        meta: this.asRecord(input.cacheData.meta),
      },
      syncedAt,
    });

    await this.updateAccountCacheState(
      account.id,
      input.target,
      {
        termId,
        syncedAt,
        credentialSaveMode: input.credentialSaveMode,
        authStatePatch: {
          ...input.authStatePatch,
          ...(input.target === "profile" ? { profile: featureData } : {}),
        },
      },
    );

    return { cacheId: cache.id, parsedCount: this.countFeatureItems(featureData), syncedAt };
  }

  async getLatestCacheResults(accountId: string): Promise<CachedDataResult[]> {
    const account = await this.prisma.studentAccount.findUnique({
      where: { id: accountId },
      select: {
        id: true,
        schoolId: true,
        providerId: true,
        status: true,
        sessionReusable: true,
        sessionRefreshable: true,
        sessionExpireAt: true,
        school: {
          select: {
            config: true,
          },
        },
      },
    });

    if (!account) {
      return [];
    }

    const [courseCache, featureCaches] = await Promise.all([
      this.prisma.courseCache.findFirst({
        where: { accountId },
        orderBy: { syncedAt: "desc" },
      }),
      this.prisma.featureCache.findMany({
        where: { accountId, target: { in: ["profile", "score", "exam"] } },
        orderBy: [{ target: "asc" }, { syncedAt: "desc" }],
      }),
    ]);
    const latestFeatureCacheByTarget = new Map<
      DataTarget,
      (typeof featureCaches)[number]
    >();

    for (const cache of featureCaches) {
      if (!latestFeatureCacheByTarget.has(cache.target)) {
        latestFeatureCacheByTarget.set(cache.target, cache);
      }
    }

    const cacheResults = [
      {
        target: "course" as DataTarget,
        cacheData: this.getLatestCacheData(account, "course", courseCache),
      },
      ...(["profile", "score", "exam"] as DataTarget[]).map((target) => ({
        target,
        cacheData: this.getLatestCacheData(
          account,
          target,
          latestFeatureCacheByTarget.get(target),
        ),
      })),
    ];
    const results: CachedDataResult[] = [];

    for (const result of cacheResults) {
      if (result.cacheData) {
        results.push({
          target: result.target,
          cacheData: result.cacheData,
        });
      }
    }

    return results;
  }

  private getLatestCacheData(
    account: {
      id: string;
      schoolId: string;
      providerId: string;
      status: string;
      sessionReusable: boolean;
      sessionRefreshable: boolean;
      sessionExpireAt: Date | null;
      school: { config: Prisma.JsonValue };
    },
    target: DataTarget,
    cache?: {
      termId: string | null;
      coursesJson?: unknown;
      termsJson?: unknown;
      sectionTimesJson?: unknown;
      dataJson?: unknown;
      metaJson?: unknown;
      sourceHash: string;
      syncedAt: Date;
    } | null,
  ): Record<string, unknown> | null {
    if (!cache) {
      return null;
    }

    const session = {
      sessionReusable: account.sessionReusable,
      sessionRefreshable: account.sessionRefreshable,
      sessionExpireAt: account.sessionExpireAt?.toISOString(),
      accountStatus: account.status,
    };

    if (target === "course") {
      const cacheSectionTimes = this.asArray(cache.sectionTimesJson);
      const configuredSectionTimes = this.providerDisplay.getSectionTimes(
        account.school.config,
        account.providerId,
      );
      const sectionTimeProfiles = this.providerDisplay.getSectionTimeProfiles(
        account.school.config,
        account.providerId,
      );

      return {
        accountId: account.id,
        schoolId: account.schoolId,
        providerId: account.providerId,
        termId: cache.termId ?? undefined,
        courses: this.withProfileTimes(
          this.asArray(cache.coursesJson),
          sectionTimeProfiles,
        ),
        terms: this.asArray(cache.termsJson),
        termStarts: this.getTermStarts(account.school.config),
        sectionTimes: cacheSectionTimes.length
          ? cacheSectionTimes
          : configuredSectionTimes,
        ...(sectionTimeProfiles.length ? { sectionTimeProfiles } : {}),
        sourceHash: cache.sourceHash,
        syncedAt: cache.syncedAt.toISOString(),
        session,
      };
    }

    return {
      accountId: account.id,
      schoolId: account.schoolId,
      providerId: account.providerId,
      target,
      termId: cache.termId ?? undefined,
      data: cache.dataJson,
      meta: cache.metaJson,
      sourceHash: cache.sourceHash,
      syncedAt: cache.syncedAt.toISOString(),
      session,
    };
  }

  private async writeFeatureCache(input: {
    account: {
      id: string;
      schoolId: string;
      providerId: string;
    };
    target: Exclude<DataTarget, "course">;
    result: CloudFeatureResult;
    syncedAt: Date;
  }) {
    const sourceHash = createHash("sha256")
      .update(
        JSON.stringify({
          accountId: input.account.id,
          providerId: input.account.providerId,
          target: input.target,
          termId: input.result.termId,
          data: input.result.data,
        }),
      )
      .digest("hex");
    const data = {
      termId: input.result.termId,
      dataJson: this.toJson(input.result.data),
      metaJson: this.toJson(input.result.meta ?? { source: "cloud_worker" }),
      syncedAt: input.syncedAt,
    };

    return this.prisma.featureCache.upsert({
      where: {
        featureCacheAccountTargetSourceHash: {
          accountId: input.account.id,
          target: input.target,
          sourceHash,
        },
      },
      update: data,
      create: {
        accountId: input.account.id,
        schoolId: input.account.schoolId,
        providerId: input.account.providerId,
        target: input.target,
        sourceHash,
        ...data,
      },
    });
  }

  private async updateAccountCacheState(
    accountId: string,
    target: DataTarget,
    state: {
      termId?: string;
      syncedAt: Date;
      count?: number;
      credentialSaveMode?: "none" | "password_vault";
      authStatePatch?: Record<string, unknown>;
    },
  ) {
    const account = await this.prisma.studentAccount.findUnique({
      where: { id: accountId },
    });

    if (!account) {
      throw new NotFoundException("Student account not found");
    }

    const profile = target === "profile" ? this.asRecord(state.authStatePatch?.profile) : {};
    const displayName =
      typeof profile.name === "string" && profile.name.trim()
        ? profile.name.trim()
        : undefined;

    await this.prisma.studentAccount.update({
      where: { id: accountId },
      data: {
        status: "cached_only",
        ...(displayName ? { displayName } : {}),
        ...(state.authStatePatch
          ? {
              authState: this.toJson({
                ...this.asRecord(account.authState),
                ...state.authStatePatch,
                syncedBy: "cloud_worker",
                syncedAt: state.syncedAt.toISOString(),
              }),
            }
          : {}),
        cacheState: this.toJson({
          ...this.asRecord(account.cacheState),
          [target]: {
            status: "cached",
            termId: state.termId,
            syncedAt: state.syncedAt.toISOString(),
            ...(state.count !== undefined ? { count: state.count } : {}),
          },
        }),
        ...(state.credentialSaveMode
          ? { credentialSaveMode: state.credentialSaveMode }
          : {}),
        lastCachedAt: state.syncedAt,
        lastAuthErrorCode: null,
        lastAuthErrorAt: null,
      },
    });
  }

  private createCloudSourceHash(input: {
    accountId: string;
    providerId: string;
    target: DataTarget;
    termId?: string;
    data: unknown;
  }) {
    return createHash("sha256")
      .update(JSON.stringify(input))
      .digest("hex");
  }

  private countFeatureItems(data: unknown) {
    if (Array.isArray(data)) {
      return data.length;
    }

    const record = this.asRecord(data);

    if (Array.isArray(record.semesters)) {
      return record.semesters.reduce((count, semester) => {
        const grades = this.asRecord(semester).grades;
        return count + (Array.isArray(grades) ? grades.length : 0);
      }, 0);
    }

    return Object.keys(record).length;
  }

  private normalizeCourse(value: unknown, index: number) {
    const course = this.asRecord(value);
    const sections = this.normalizeSections(course);
    const startSection = Number(course.startSection ?? sections[0] ?? 0);
    const endSection = Number(
      course.endSection ?? sections[sections.length - 1] ?? startSection,
    );

    return {
      id: course.id || `course-${index + 1}`,
      name: course.name || "未命名课程",
      teacher: course.teacher,
      location: course.location ?? course.classroom,
      classroom: course.classroom ?? course.location,
      building: this.asOptionalString(course.building),
      sectionTimeProfileId: this.asOptionalString(course.sectionTimeProfileId ?? course.timeProfileId),
      startTime: this.asOptionalString(course.startTime),
      endTime: this.asOptionalString(course.endTime),
      time: this.asOptionalString(course.time),
      weekday: Number(course.weekday || 0),
      sections,
      startSection,
      endSection,
      weeks: Array.isArray(course.weeks) ? course.weeks : [],
      rawWeeks: course.rawWeeks,
      campus: course.campus,
      remark: course.remark,
      source: course.source,
    };
  }

  private withProfileTimes(
    courses: unknown[],
    profiles: SectionTimeProfileConfig[],
  ) {
    if (!profiles.length) {
      return courses;
    }

    return courses.map((course) => {
      const record = this.asRecord(course);

      if (this.asOptionalString(record.startTime) && this.asOptionalString(record.endTime)) {
        return course;
      }

      const profile = this.matchSectionTimeProfile(record, profiles);

      if (!profile) {
        return course;
      }

      const startSection = this.getCourseStartSection(record);
      const endSection = this.getCourseEndSection(record, startSection);
      const startTime = profile.sectionTimes.find((item) => item.section === startSection)?.start;
      const endTime = profile.sectionTimes.find((item) => item.section === endSection)?.end;

      if (!startTime || !endTime) {
        return course;
      }

      return {
        ...record,
        building: this.extractCourseBuilding(record.building ?? record.location ?? record.classroom),
        sectionTimeProfileId: profile.id,
        startTime,
        endTime,
      };
    });
  }

  private matchSectionTimeProfile(
    course: Record<string, unknown>,
    profiles: SectionTimeProfileConfig[],
  ) {
    const room = [course.building, course.location, course.classroom]
      .map((value) => String(value || ""))
      .join("")
      .replace(/\s+/g, "")
      .toLocaleLowerCase();

    if (!room) {
      return undefined;
    }

    return profiles.find((profile) =>
      profile.buildingKeywords.some((keyword) => {
        const normalizedKeyword = keyword.replace(/\s+/g, "").toLocaleLowerCase();
        return normalizedKeyword && room.includes(normalizedKeyword);
      }),
    );
  }

  private getCourseStartSection(course: Record<string, unknown>) {
    const sections = Array.isArray(course.sections)
      ? course.sections.map(Number).filter((section) => Number.isFinite(section) && section > 0)
      : [];

    return Number(course.startSection ?? sections[0] ?? 0);
  }

  private getCourseEndSection(course: Record<string, unknown>, startSection: number) {
    const sections = Array.isArray(course.sections)
      ? course.sections.map(Number).filter((section) => Number.isFinite(section) && section > 0)
      : [];

    return Number(course.endSection ?? sections[sections.length - 1] ?? startSection);
  }

  private extractCourseBuilding(value: unknown) {
    const text = String(value || "").trim().replace(/\s+/g, "");
    const numberedTeachingBuilding = text.match(/(教学楼[一二三四五六七八九十\d]+)/);

    if (numberedTeachingBuilding) {
      return numberedTeachingBuilding[1];
    }

    const match = text.match(/(.+?(?:教学楼|实验楼|实训楼|楼|馆|中心|校区|院区))/);

    if (match) {
      return match[1];
    }

    const prefix = text.match(/^([A-Za-z\u4e00-\u9fa5]+)[-_\d]/);
    return prefix ? prefix[1] : text;
  }

  private getTermStarts(config: unknown) {
    const termStarts = this.asRecord(config).termStarts;
    const record = this.asRecord(termStarts);
    const result: Record<string, string> = {};

    for (const [termId, date] of Object.entries(record)) {
      if (typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
        result[termId] = date;
      }
    }

    return result;
  }

  private asArray(value: unknown) {
    return Array.isArray(value) ? value : [];
  }

  private normalizeSections(course: Record<string, unknown>) {
    if (Array.isArray(course.sections) && course.sections.length > 0) {
      return course.sections
        .map((section) => Number(section))
        .filter((section) => Number.isFinite(section) && section > 0);
    }

    const start = Number(course.startSection);
    const end = Number(course.endSection ?? start);

    if (!Number.isFinite(start) || start <= 0) {
      return [];
    }

    return Array.from(
      { length: Math.max((Number.isFinite(end) ? end : start) - start + 1, 1) },
      (_, index) => start + index,
    );
  }

  private asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private asOptionalString(value: unknown) {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  }

  private toJson(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
  }
}
