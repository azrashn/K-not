ALTER TABLE `Video` ADD COLUMN `durationMs` INTEGER NULL;

CREATE TABLE `VideoProgress` (
    `videoId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `positionMs` INTEGER NOT NULL DEFAULT 0,
    `intervals` JSON NOT NULL,
    `revision` INTEGER NOT NULL DEFAULT 0,
    `updatedAt` DATETIME(3) NOT NULL,
    PRIMARY KEY (`videoId`, `userId`),
    INDEX `VideoProgress_userId_idx` (`userId`),
    CONSTRAINT `VideoProgress_videoId_fkey` FOREIGN KEY (`videoId`) REFERENCES `Video` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `VideoProgress_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
