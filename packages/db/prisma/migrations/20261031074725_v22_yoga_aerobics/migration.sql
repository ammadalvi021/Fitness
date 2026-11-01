-- AlterTable
ALTER TABLE "Profile" ADD COLUMN     "workoutTypes" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "WorkoutSession" ADD COLUMN     "caloriesEstimateKcal" DOUBLE PRECISION,
ADD COLUMN     "durationSeconds" INTEGER,
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'strength',
ADD COLUMN     "sourceSlug" TEXT;

-- CreateTable
CREATE TABLE "YogaPose" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sanskritName" TEXT,
    "description" TEXT NOT NULL,
    "instructions" JSONB NOT NULL,
    "breathing" TEXT,
    "modifications" TEXT,
    "cautions" TEXT,
    "difficulty" TEXT NOT NULL,
    "defaultHoldSeconds" INTEGER NOT NULL,
    "bilateral" BOOLEAN NOT NULL DEFAULT false,
    "focusAreas" TEXT[],
    "mediaType" TEXT NOT NULL DEFAULT 'none',
    "mediaUrl" TEXT,
    "posterUrl" TEXT,
    "mediaStatus" TEXT NOT NULL DEFAULT 'placeholder',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "YogaPose_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "YogaSequence" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "safetyNotes" TEXT,
    "metValue" DOUBLE PRECISION NOT NULL,
    "mediaType" TEXT NOT NULL DEFAULT 'none',
    "mediaUrl" TEXT,
    "posterUrl" TEXT,
    "mediaStatus" TEXT NOT NULL DEFAULT 'placeholder',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "YogaSequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "YogaSequencePose" (
    "id" TEXT NOT NULL,
    "sequenceId" TEXT NOT NULL,
    "poseId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "holdSeconds" INTEGER NOT NULL,
    "side" TEXT NOT NULL DEFAULT 'both',
    "transitionSeconds" INTEGER NOT NULL DEFAULT 5,
    "cue" TEXT,

    CONSTRAINT "YogaSequencePose_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AerobicRoutine" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "intensity" TEXT NOT NULL,
    "metValue" DOUBLE PRECISION NOT NULL,
    "description" TEXT NOT NULL,
    "safetyNotes" TEXT,
    "mediaType" TEXT NOT NULL DEFAULT 'none',
    "mediaUrl" TEXT,
    "posterUrl" TEXT,
    "mediaStatus" TEXT NOT NULL DEFAULT 'placeholder',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AerobicRoutine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoutineStep" (
    "id" TEXT NOT NULL,
    "routineId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "phase" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "durationSeconds" INTEGER NOT NULL,
    "cue" TEXT,
    "lowImpactAlternative" TEXT,

    CONSTRAINT "RoutineStep_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "YogaPose_slug_key" ON "YogaPose"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "YogaSequence_slug_key" ON "YogaSequence"("slug");

-- CreateIndex
CREATE INDEX "YogaSequencePose_sequenceId_idx" ON "YogaSequencePose"("sequenceId");

-- CreateIndex
CREATE INDEX "YogaSequencePose_poseId_idx" ON "YogaSequencePose"("poseId");

-- CreateIndex
CREATE UNIQUE INDEX "YogaSequencePose_sequenceId_order_key" ON "YogaSequencePose"("sequenceId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "AerobicRoutine_slug_key" ON "AerobicRoutine"("slug");

-- CreateIndex
CREATE INDEX "RoutineStep_routineId_idx" ON "RoutineStep"("routineId");

-- CreateIndex
CREATE UNIQUE INDEX "RoutineStep_routineId_order_key" ON "RoutineStep"("routineId", "order");

-- AddForeignKey
ALTER TABLE "YogaSequencePose" ADD CONSTRAINT "YogaSequencePose_sequenceId_fkey" FOREIGN KEY ("sequenceId") REFERENCES "YogaSequence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "YogaSequencePose" ADD CONSTRAINT "YogaSequencePose_poseId_fkey" FOREIGN KEY ("poseId") REFERENCES "YogaPose"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutineStep" ADD CONSTRAINT "RoutineStep_routineId_fkey" FOREIGN KEY ("routineId") REFERENCES "AerobicRoutine"("id") ON DELETE CASCADE ON UPDATE CASCADE;
