-- CreateTable
CREATE TABLE `GeneratedExam` (
    `id` VARCHAR(191) NOT NULL,
    `courseId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `styleId` VARCHAR(191) NULL,
    `title` VARCHAR(160) NOT NULL,
    `status` VARCHAR(16) NOT NULL,
    `requested` INTEGER NOT NULL,
    `topics` JSON NOT NULL,
    `items` JSON NOT NULL,
    `failures` JSON NOT NULL,
    `note` VARCHAR(300) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `finishedAt` DATETIME(3) NULL,

    INDEX `GeneratedExam_courseId_userId_createdAt_idx`(`courseId`, `userId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `GeneratedExam` ADD CONSTRAINT `GeneratedExam_courseId_fkey` FOREIGN KEY (`courseId`) REFERENCES `Course`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GeneratedExam` ADD CONSTRAINT `GeneratedExam_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GeneratedExam` ADD CONSTRAINT `GeneratedExam_styleId_fkey` FOREIGN KEY (`styleId`) REFERENCES `ExamStyle`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

