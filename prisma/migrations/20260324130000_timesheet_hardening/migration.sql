-- CreateTable
CREATE TABLE "public"."BotState" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BotState_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "public"."DailySummaryRun" (
    "summaryDate" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailySummaryRun_pkey" PRIMARY KEY ("summaryDate")
);

-- Prevent more than one OPEN entry per employee
CREATE UNIQUE INDEX "TimeEntry_one_open_per_employee_idx"
ON "public"."TimeEntry" ("employeeId")
WHERE "status" = 'OPEN';
