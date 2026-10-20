-- AlterTable (F3, spec §4.1): Setting.updatedBy — internal actor id, never exposed in SettingsView
ALTER TABLE "Setting" ADD COLUMN "updatedBy" TEXT;

-- DropIndex (F4, spec §4.4): token unique globally, not per-user (register reassigns userId)
DROP INDEX "DeviceToken_userId_token_key";

-- CreateIndex
CREATE UNIQUE INDEX "DeviceToken_token_key" ON "DeviceToken"("token");
