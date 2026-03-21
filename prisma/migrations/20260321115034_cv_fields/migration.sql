/*
  Warnings:

  - You are about to drop the column `department` on the `HireRequest` table. All the data in the column will be lost.
  - You are about to drop the column `notes` on the `HireRequest` table. All the data in the column will be lost.
  - You are about to drop the column `position` on the `HireRequest` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "public"."HireRequest" DROP COLUMN "department",
DROP COLUMN "notes",
DROP COLUMN "position",
ADD COLUMN     "cnp" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "idCardUrl" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "phone" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "referredBy" TEXT NOT NULL DEFAULT '';
