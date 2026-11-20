-- AlterTable
ALTER TABLE `Course` ADD COLUMN `category` VARCHAR(80) NULL,
    ADD COLUMN `deletionError` VARCHAR(300) NULL,
    ADD COLUMN `lifecycle` VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    ADD COLUMN `ownerId` VARCHAR(191) NULL;

-- Some legacy local databases already have description VARCHAR(1000).
-- Preserve it and widen; fresh databases get the same final column.
SET @description_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Course' AND COLUMN_NAME = 'description');
SET @description_sql = IF(@description_exists > 0, 'ALTER TABLE `Course` MODIFY COLUMN `description` VARCHAR(2000) NULL', 'ALTER TABLE `Course` ADD COLUMN `description` VARCHAR(2000) NULL');
PREPARE description_statement FROM @description_sql;
EXECUTE description_statement;
DEALLOCATE PREPARE description_statement;

-- AlterTable
ALTER TABLE `CourseMembership` ADD COLUMN `archivedAt` DATETIME(3) NULL;

-- CreateTable
CREATE TABLE `LearningConversation` (
    `id` VARCHAR(191) NOT NULL,
    `courseId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(160) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `LearningConversation_userId_courseId_updatedAt_idx`(`userId`, `courseId`, `updatedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LearningMessage` (
    `id` VARCHAR(191) NOT NULL,
    `conversationId` VARCHAR(191) NOT NULL,
    `role` VARCHAR(12) NOT NULL,
    `content` LONGTEXT NOT NULL,
    `payload` JSON NULL,
    `redacted` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `LearningMessage_conversationId_createdAt_idx`(`conversationId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LearningMessageSource` (
    `messageId` VARCHAR(191) NOT NULL,
    `materialId` VARCHAR(100) NOT NULL,
    `version` VARCHAR(64) NOT NULL,

    INDEX `LearningMessageSource_materialId_idx`(`materialId`),
    PRIMARY KEY (`messageId`, `materialId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LearningActivity` (
    `userId` VARCHAR(191) NOT NULL,
    `courseId` VARCHAR(191) NOT NULL,
    `materialId` VARCHAR(100) NULL,
    `segmentId` VARCHAR(64) NULL,
    `topic` VARCHAR(160) NULL,
    `events` INTEGER NOT NULL DEFAULT 0,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`userId`, `courseId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LearningQuiz` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `courseId` VARCHAR(191) NOT NULL,
    `topic` VARCHAR(200) NOT NULL,
    `kind` VARCHAR(24) NOT NULL,
    `materialId` VARCHAR(100) NOT NULL,
    `segmentId` VARCHAR(64) NOT NULL,
    `version` VARCHAR(64) NOT NULL,
    `data` JSON NOT NULL,
    `redacted` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `LearningQuiz_userId_courseId_createdAt_idx`(`userId`, `courseId`, `createdAt`),
    INDEX `LearningQuiz_materialId_idx`(`materialId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LearningQuizAttempt` (
    `id` VARCHAR(191) NOT NULL,
    `quizId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `response` VARCHAR(2000) NOT NULL,
    `outcome` VARCHAR(32) NOT NULL,
    `feedback` JSON NOT NULL,
    `score` DOUBLE NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `LearningQuizAttempt_userId_createdAt_idx`(`userId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Course` ADD CONSTRAINT `Course_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LearningConversation` ADD CONSTRAINT `LearningConversation_courseId_fkey` FOREIGN KEY (`courseId`) REFERENCES `Course`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LearningConversation` ADD CONSTRAINT `LearningConversation_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LearningMessage` ADD CONSTRAINT `LearningMessage_conversationId_fkey` FOREIGN KEY (`conversationId`) REFERENCES `LearningConversation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LearningMessageSource` ADD CONSTRAINT `LearningMessageSource_messageId_fkey` FOREIGN KEY (`messageId`) REFERENCES `LearningMessage`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LearningActivity` ADD CONSTRAINT `LearningActivity_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LearningActivity` ADD CONSTRAINT `LearningActivity_courseId_fkey` FOREIGN KEY (`courseId`) REFERENCES `Course`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LearningQuiz` ADD CONSTRAINT `LearningQuiz_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LearningQuiz` ADD CONSTRAINT `LearningQuiz_courseId_fkey` FOREIGN KEY (`courseId`) REFERENCES `Course`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LearningQuizAttempt` ADD CONSTRAINT `LearningQuizAttempt_quizId_fkey` FOREIGN KEY (`quizId`) REFERENCES `LearningQuiz`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LearningQuizAttempt` ADD CONSTRAINT `LearningQuizAttempt_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
