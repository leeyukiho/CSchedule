import { Module } from "@nestjs/common";

import { CredentialVaultService } from "../../common/crypto/credential-vault.service";
import { AccountsModule } from "../accounts/accounts.module";
import { ProvidersModule } from "../providers/providers.module";
import { CloudCredentialSyncModule } from "../sync/cloud-credential-sync.module";
import { SyncModule } from "../sync/sync.module";
import { AccountWechatController, AuthController, SessionImportController } from "./auth.controller";
import { AuthService } from "./auth.service";

@Module({
  imports: [AccountsModule, ProvidersModule, SyncModule, CloudCredentialSyncModule],
  controllers: [AuthController, SessionImportController, AccountWechatController],
  providers: [AuthService, CredentialVaultService],
  exports: [AuthService],
})
export class AuthModule {}
