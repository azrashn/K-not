-- CreateTable
CREATE TABLE `User` (
    `id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(254) NOT NULL,
    `displayName` VARCHAR(120) NOT NULL,
    `passwordHash` VARCHAR(255) NOT NULL,
    `role` ENUM('USER', 'ADMIN') NOT NULL DEFAULT 'USER',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `User_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Course` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(32) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `instructorName` VARCHAR(200) NULL,
    `term` VARCHAR(32) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Course_code_term_key`(`code`, `term`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CourseMembership` (
    `userId` VARCHAR(191) NOT NULL,
    `courseId` VARCHAR(191) NOT NULL,
    `role` ENUM('STUDENT', 'INSTRUCTOR') NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `CourseMembership_courseId_idx`(`courseId`),
    PRIMARY KEY (`userId`, `courseId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Document` (
    `id` VARCHAR(191) NOT NULL,
    `courseId` VARCHAR(191) NOT NULL,
    `ownerId` VARCHAR(191) NOT NULL,
    `visibility` ENUM('PRIVATE', 'COURSE') NOT NULL DEFAULT 'PRIVATE',
    `documentType` VARCHAR(16) NOT NULL,
    `title` VARCHAR(300) NOT NULL,
    `originalFilename` VARCHAR(255) NOT NULL,
    `mimeType` VARCHAR(100) NOT NULL,
    `sizeBytes` INTEGER NOT NULL,
    `contentSha256` CHAR(64) NOT NULL,
    `activeContentHash` CHAR(64) NULL,
    `storageKey` VARCHAR(255) NOT NULL,
    `pageCount` INTEGER NULL,
    `chunkCount` INTEGER NULL,
    `status` ENUM('UPLOADED', 'EXTRACTING', 'CHUNKING', 'EMBEDDING', 'INDEXING', 'READY', 'FAILED', 'DELETING') NOT NULL DEFAULT 'UPLOADED',
    `failedStage` ENUM('UPLOADED', 'EXTRACTING', 'CHUNKING', 'EMBEDDING', 'INDEXING', 'READY', 'FAILED', 'DELETING') NULL,
    `errorCode` VARCHAR(64) NULL,
    `errorMessage` VARCHAR(500) NULL,
    `errorRetryable` BOOLEAN NULL,
    `activeJobId` VARCHAR(191) NULL,
    `indexingVersion` VARCHAR(64) NULL,
    `indexVersionId` VARCHAR(191) NULL,
    `readyAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,
    `purgedAt` DATETIME(3) NULL,

    UNIQUE INDEX `Document_activeJobId_key`(`activeJobId`),
    INDEX `Document_courseId_status_deletedAt_idx`(`courseId`, `status`, `deletedAt`),
    INDEX `Document_ownerId_idx`(`ownerId`),
    INDEX `Document_deletedAt_purgedAt_idx`(`deletedAt`, `purgedAt`),
    UNIQUE INDEX `Document_courseId_ownerId_activeContentHash_key`(`courseId`, `ownerId`, `activeContentHash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DocumentProcessingJob` (
    `id` VARCHAR(191) NOT NULL,
    `documentId` VARCHAR(191) NOT NULL,
    `indexVersionId` VARCHAR(191) NOT NULL,
    `kind` ENUM('INITIAL', 'RETRY', 'REINDEX', 'MIGRATION') NOT NULL,
    `status` ENUM('QUEUED', 'DISPATCHED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED') NOT NULL DEFAULT 'QUEUED',
    `stage` ENUM('UPLOADED', 'EXTRACTING', 'CHUNKING', 'EMBEDDING', 'INDEXING', 'READY', 'FAILED', 'DELETING') NULL,
    `attempt` INTEGER NOT NULL DEFAULT 1,
    `indexingVersion` VARCHAR(64) NOT NULL,
    `lastEventSeq` INTEGER NOT NULL DEFAULT 0,
    `workerId` VARCHAR(64) NULL,
    `nextAttemptAt` DATETIME(3) NULL,
    `dispatchedAt` DATETIME(3) NULL,
    `startedAt` DATETIME(3) NULL,
    `heartbeatAt` DATETIME(3) NULL,
    `finishedAt` DATETIME(3) NULL,
    `pageCount` INTEGER NULL,
    `chunkCount` INTEGER NULL,
    `errorCode` VARCHAR(64) NULL,
    `errorMessage` VARCHAR(500) NULL,
    `retryable` BOOLEAN NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `DocumentProcessingJob_status_heartbeatAt_idx`(`status`, `heartbeatAt`),
    INDEX `DocumentProcessingJob_status_nextAttemptAt_idx`(`status`, `nextAttemptAt`),
    INDEX `DocumentProcessingJob_documentId_createdAt_idx`(`documentId`, `createdAt`),
    INDEX `DocumentProcessingJob_indexVersionId_status_idx`(`indexVersionId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `IndexVersion` (
    `id` VARCHAR(191) NOT NULL,
    `collectionName` VARCHAR(63) NOT NULL,
    `embeddingBackend` VARCHAR(64) NOT NULL,
    `embeddingModel` VARCHAR(255) NOT NULL,
    `embeddingRevision` VARCHAR(64) NULL,
    `embeddingDimension` INTEGER NOT NULL,
    `queryPrefix` VARCHAR(64) NOT NULL DEFAULT '',
    `documentPrefix` VARCHAR(64) NOT NULL DEFAULT '',
    `normalize` BOOLEAN NOT NULL DEFAULT true,
    `distance` VARCHAR(16) NOT NULL DEFAULT 'cosine',
    `embeddingFingerprint` VARCHAR(80) NOT NULL,
    `chunkerVersion` VARCHAR(64) NOT NULL,
    `status` ENUM('BUILDING', 'ACTIVE', 'RETIRED') NOT NULL DEFAULT 'BUILDING',
    `activatedAt` DATETIME(3) NULL,
    `retiredAt` DATETIME(3) NULL,
    `droppedAt` DATETIME(3) NULL,

    UNIQUE INDEX `IndexVersion_collectionName_key`(`collectionName`),
    UNIQUE INDEX `IndexVersion_embeddingFingerprint_key`(`embeddingFingerprint`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `CourseMembership` ADD CONSTRAINT `CourseMembership_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CourseMembership` ADD CONSTRAINT `CourseMembership_courseId_fkey` FOREIGN KEY (`courseId`) REFERENCES `Course`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Document` ADD CONSTRAINT `Document_courseId_fkey` FOREIGN KEY (`courseId`) REFERENCES `Course`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Document` ADD CONSTRAINT `Document_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Document` ADD CONSTRAINT `Document_indexVersionId_fkey` FOREIGN KEY (`indexVersionId`) REFERENCES `IndexVersion`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DocumentProcessingJob` ADD CONSTRAINT `DocumentProcessingJob_documentId_fkey` FOREIGN KEY (`documentId`) REFERENCES `Document`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DocumentProcessingJob` ADD CONSTRAINT `DocumentProcessingJob_indexVersionId_fkey` FOREIGN KEY (`indexVersionId`) REFERENCES `IndexVersion`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
