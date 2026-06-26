import { Module } from "@nestjs/common";

import { CredentialVaultService } from "../../common/crypto/credential-vault.service";
import { AccountsModule } from "../accounts/accounts.module";
import { ProvidersModule } from "../providers/providers.module";
import { RemindersModule } from "../reminders/reminders.module";
import { CloudCredentialSyncModule } from "../sync/cloud-credential-sync.module";
import { SyncModule } from "../sync/sync.module";
import { OpenidAbuseTokenService } from "../../common/security/openid-abuse-token.service";
import { AccountWechatController, AuthController, SessionImportController, WechatSessionController } from "./auth.controller";
import { AuthService } from "./auth.service";

@Module({
  imports: [AccountsModule, ProvidersModule, SyncModule, CloudCredentialSyncModule, RemindersModule],
  controllers: [AuthController, SessionImportController, AccountWechatController, WechatSessionController],
  providers: [AuthService, CredentialVaultService, OpenidAbuseTokenService],
  exports: [AuthService],
})
export class AuthModule {}
