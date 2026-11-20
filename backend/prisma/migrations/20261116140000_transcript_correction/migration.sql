-- CreateTable
CREATE TABLE `TranscriptCorrection` (
    `id` VARCHAR(191) NOT NULL,
    `videoId` VARCHAR(191) NOT NULL,
    `chunkIndex` INTEGER NOT NULL,
    `originalSha` CHAR(64) NOT NULL,
    `text` TEXT NOT NULL,
    `history` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `TranscriptCorrection_videoId_chunkIndex_key`(`videoId`, `chunkIndex`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `TranscriptCorrection` ADD CONSTRAINT `TranscriptCorrection_videoId_fkey` FOREIGN KEY (`videoId`) REFERENCES `Video`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

