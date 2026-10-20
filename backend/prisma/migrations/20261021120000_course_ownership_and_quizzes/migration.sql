
-- AlterTable
ALTER TABLE `Course` ADD COLUMN `createdById` VARCHAR(191) NULL,
    ADD COLUMN `description` VARCHAR(1000) NULL;

-- CreateTable
CREATE TABLE `Quiz` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `courseId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `status` ENUM('READY', 'FAILED') NOT NULL DEFAULT 'READY',
    `difficulty` VARCHAR(8) NOT NULL,
    `questionTypes` VARCHAR(64) NOT NULL,
    `requestedCount` INTEGER NOT NULL,
    `questionCount` INTEGER NOT NULL,
    `generator` VARCHAR(64) NOT NULL,
    `llmUsed` BOOLEAN NOT NULL DEFAULT false,
    `warnings` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Quiz_userId_courseId_createdAt_idx`(`userId`, `courseId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `QuizDocument` (
    `quizId` VARCHAR(191) NOT NULL,
    `documentId` VARCHAR(191) NOT NULL,

    INDEX `QuizDocument_documentId_idx`(`documentId`),
    PRIMARY KEY (`quizId`, `documentId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `QuizQuestion` (
    `id` VARCHAR(191) NOT NULL,
    `quizId` VARCHAR(191) NOT NULL,
    `ordinal` INTEGER NOT NULL,
    `type` VARCHAR(16) NOT NULL,
    `prompt` TEXT NOT NULL,
    `options` TEXT NOT NULL,
    `correctIndex` INTEGER NOT NULL,
    `explanation` TEXT NOT NULL,
    `topic` VARCHAR(300) NOT NULL,
    `difficulty` VARCHAR(8) NOT NULL,
    `sourceDocumentId` VARCHAR(191) NOT NULL,
    `sourceChunkId` VARCHAR(191) NOT NULL,
    `sourcePageStart` INTEGER NULL,
    `sourcePageEnd` INTEGER NULL,
    `sourceQuote` TEXT NULL,

    INDEX `QuizQuestion_sourceDocumentId_idx`(`sourceDocumentId`),
    UNIQUE INDEX `QuizQuestion_quizId_ordinal_key`(`quizId`, `ordinal`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `QuizAttempt` (
    `id` VARCHAR(191) NOT NULL,
    `quizId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `status` ENUM('IN_PROGRESS', 'SUBMITTED') NOT NULL DEFAULT 'IN_PROGRESS',
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `submittedAt` DATETIME(3) NULL,
    `totalCount` INTEGER NOT NULL DEFAULT 0,
    `correctCount` INTEGER NOT NULL DEFAULT 0,
    `scorePct` INTEGER NULL,

    INDEX `QuizAttempt_userId_status_submittedAt_idx`(`userId`, `status`, `submittedAt`),
    INDEX `QuizAttempt_quizId_idx`(`quizId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `QuizAttemptAnswer` (
    `attemptId` VARCHAR(191) NOT NULL,
    `questionId` VARCHAR(191) NOT NULL,
    `selectedIndex` INTEGER NULL,
    `isCorrect` BOOLEAN NULL,
    `answeredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `QuizAttemptAnswer_questionId_idx`(`questionId`),
    PRIMARY KEY (`attemptId`, `questionId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `Course_createdById_idx` ON `Course`(`createdById`);

-- AddForeignKey
ALTER TABLE `Course` ADD CONSTRAINT `Course_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Quiz` ADD CONSTRAINT `Quiz_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Quiz` ADD CONSTRAINT `Quiz_courseId_fkey` FOREIGN KEY (`courseId`) REFERENCES `Course`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `QuizDocument` ADD CONSTRAINT `QuizDocument_quizId_fkey` FOREIGN KEY (`quizId`) REFERENCES `Quiz`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `QuizQuestion` ADD CONSTRAINT `QuizQuestion_quizId_fkey` FOREIGN KEY (`quizId`) REFERENCES `Quiz`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `QuizAttempt` ADD CONSTRAINT `QuizAttempt_quizId_fkey` FOREIGN KEY (`quizId`) REFERENCES `Quiz`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `QuizAttempt` ADD CONSTRAINT `QuizAttempt_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `QuizAttemptAnswer` ADD CONSTRAINT `QuizAttemptAnswer_attemptId_fkey` FOREIGN KEY (`attemptId`) REFERENCES `QuizAttempt`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `QuizAttemptAnswer` ADD CONSTRAINT `QuizAttemptAnswer_questionId_fkey` FOREIGN KEY (`questionId`) REFERENCES `QuizQuestion`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

