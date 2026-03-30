-- CreateTable
CREATE TABLE "TimeEntryAudit" (
    "id" TEXT NOT NULL,
    "timeEntryId" TEXT NOT NULL,
    "editedById" TEXT NOT NULL,
    "fieldName" TEXT NOT NULL,
    "oldValue" TEXT NOT NULL,
    "newValue" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimeEntryAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TimeEntryAudit_timeEntryId_idx" ON "TimeEntryAudit"("timeEntryId");
